# MobileBridge BFF 实现指南（Gate 0B 产出）

> 基于 Gate 0B 静态分析和只读探针的确认事实，供 Stage 1 实现参考。

---

## 1. 架构概览

```
Android PWA (HTTPS via Cloudflare/SakuraFrp)
    ↓
Electron MobileBridge (loopback-only, 127.0.0.1:PORT)
    ↓
pi-web Next.js (127.0.0.1:62809, 动态端口)
```

**关键约束：**
- MobileBridge 必须从 `PiWebRuntime.info.port` 动态读取 pi-web 端口，不得缓存
- MobileBridge 只绑定 `127.0.0.1`，不暴露到局域网
- 所有动态响应 `Cache-Control: no-store`；SSE 额外 `no-transform`

---

## 2. 端口发现

```typescript
// src/pi-web-runtime.ts 已有
class PiWebRuntime {
  get info(): RuntimeInfo | null  // {port, url, pid}
}

// MobileBridge 每次请求时读取
function getPiWebPort(): number {
  const info = runtime.info;
  if (!info) throw new BridgeError('BRIDGE_STARTING', 503);
  return info.port;
}
```

---

## 3. 上游请求封装

```typescript
async function piWebGet(path: string, opts?: {timeout?: number}): Promise<Response> {
  const port = getPiWebPort();
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts?.timeout ?? 10000),
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new UpstreamError(res.status, await res.text());
  return res;
}

// 严格禁止 POST/PATCH/DELETE 到 pi-web（除明确授权的 mutation 端点）
async function piWebPost(path: string, body: unknown): Promise<Response> {
  const port = getPiWebPort();
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return res;
}
```

---

## 4. 端点映射表

| BFF 端点 | 上游端点 | 方法 | 备注 |
|---|---|---|---|
| `GET /mobile/api/v1/health` | `GET /api/home` | GET | 返回 `{ok: true, piWebPort}` |
| `GET /mobile/api/v1/projects` | `GET /api/sessions` | GET | 按 `projectRoot` 分组 |
| `GET /mobile/api/v1/projects/:id/sessions` | `GET /api/sessions` | GET | 过滤 `projectRoot === id` |
| `GET /mobile/api/v1/sessions/:id/history` | `GET /api/sessions/{id}?deferThinking=1` | GET | 只返回 `context.messages`；8MiB 硬限 |
| `GET /mobile/api/v1/sessions/:id/state` | `GET /api/sessions/{id}/state` | GET | 过滤 `systemPrompt`/`sessionFile` |
| `GET /mobile/api/v1/sessions/:id/events` | `GET /api/agent/{id}/events` | SSE | 转发 + 20秒心跳 |
| `POST /mobile/api/v1/sessions/:id/messages` | `POST /api/agent/{id}` | POST | body: `{type:"prompt", message}` |
| `POST /mobile/api/v1/sessions/:id/abort` | `POST /api/agent/{id}` | POST | body: `{type:"abort"}` |
| `GET /mobile/api/v1/sessions/:id/models` | `GET /api/models?cwd={session.cwd}` | GET | 需要先获取 session 的 cwd |
| `POST /mobile/api/v1/sessions/:id/model` | `POST /api/agent/{id}` | POST | body: `{type:"set_model", provider, modelId}` |

---

## 5. 字段过滤规则

### StateDTO 过滤（必须）
```typescript
function toStateDTO(raw: any): StateDTO {
  if (!raw.running) return { running: false };
  const s = raw.state;
  return {
    running: true,
    isStreaming: s.isStreaming,
    isPromptRunning: s.isPromptRunning,
    isCompacting: s.isCompacting,
    model: s.model,
    thinkingLevel: s.thinkingLevel,
    contextUsage: s.contextUsage,
    // 不得转发：systemPrompt, sessionFile, queuedMessages, extensionStatuses
  };
}
```

### HistoryDTO 过滤（必须）
```typescript
function toHistoryDTO(raw: any): HistoryDTO {
  return {
    sessionId: raw.sessionId,
    messages: raw.context.messages,  // 已含 role + content blocks
    model: raw.context.model,
    thinkingLevel: raw.context.thinkingLevel,
    truncated: false,
    totalMessageCount: raw.info.messageCount,
    // 不得转发：filePath, info.path, tree, leafId
  };
}
```

---

## 6. SSE 转发规则

```typescript
// BFF SSE 转发伪代码
async function handleSSE(sessionId: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const port = getPiWebPort();
  const upstream = await fetch(`http://127.0.0.1:${port}/api/agent/${sessionId}/events`);

  // 转发上游事件
  for await (const chunk of upstream.body) {
    res.write(chunk);
  }

  // BFF 自己的心跳（20秒）
  const heartbeat = setInterval(() => res.write(':\n\n'), 20000);

  // 清理
  res.on('close', () => {
    clearInterval(heartbeat);
    upstream.body?.cancel();
  });
}
```

**断线恢复语义：**
- 客户端断线后重连，BFF 重新建立上游 SSE
- 客户端应重新拉取 `GET /mobile/api/v1/sessions/:id/state` 获取权威快照
- 不承诺断线期间逐 token 无损；以快照最终一致为准

---

## 7. message_update 处理（关键）

**`message_update` 是全量替换，不是 delta。**

```typescript
// 移动端客户端处理
function handleMessageUpdate(event: MessageUpdateEvent) {
  // event.message 是完整的 message 对象
  // 替换当前流式消息，不是追加
  setCurrentStreamingMessage(event.message);
}
```

---

## 8. 8MiB 历史上限实现

```typescript
async function getHistory(sessionId: string): Promise<HistoryDTO> {
  const port = getPiWebPort();
  const url = `http://127.0.0.1:${port}/api/sessions/${sessionId}?deferThinking=1`;

  const res = await fetch(url);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const LIMIT = 8 * 1024 * 1024; // 8 MiB

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > LIMIT) {
      reader.cancel();
      throw new BridgeError('HISTORY_TOO_LARGE', 413);
    }
    chunks.push(value);
  }

  const raw = JSON.parse(new TextDecoder().decode(concat(chunks)));
  return toHistoryDTO(raw);
}
```

---

## 9. 模型切换注意事项

- `GET /api/models` 有 60 秒服务端缓存；切换模型后列表可能短暂显示旧值
- 以 `GET /api/sessions/{id}/state` 的 `model` 字段为权威来源
- 运行中切换模型的行为：`unverified-mutation`，需要 live 测试确认
- BFF 应在切换后等待 1-2 秒再返回成功，或返回 `{pending: true}` 让客户端轮询 state

---

## 10. 安全清单

- [ ] MobileBridge 只绑定 `127.0.0.1`
- [ ] 所有动态响应 `Cache-Control: no-store`
- [ ] SSE 响应 `Cache-Control: no-store, no-transform`
- [ ] Cookie: `HttpOnly; Secure; SameSite=Strict; Path=/mobile`
- [ ] 登录限速：5次/分钟/IP
- [ ] 请求体大小限制：messages 64KB，其他 4KB
- [ ] 不转发 `systemPrompt`、`sessionFile`、`queuedMessages`
- [ ] 不转发 `filePath`、`info.path`
- [ ] Origin 检查：只允许 `https://<tunnel-domain>` 和 `http://127.0.0.1:*`
- [ ] 登出/撤销时关闭所有活跃 SSE 连接
