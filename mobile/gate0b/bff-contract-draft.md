# MobileBridge BFF 契约草案（Gate 0B）

> 版本：v0.1-draft
> 状态：草案，待 Gate 0B 完成后确认

---

## 1. 稳定 API 表面

```
POST /mobile/auth/login
POST /mobile/auth/logout
POST /mobile/auth/revoke-all
GET  /mobile/api/v1/health
GET  /mobile/api/v1/projects
GET  /mobile/api/v1/projects/:projectId/sessions
GET  /mobile/api/v1/sessions/:sessionId/history
GET  /mobile/api/v1/sessions/:sessionId/state
GET  /mobile/api/v1/sessions/:sessionId/events   (SSE)
POST /mobile/api/v1/sessions/:sessionId/messages
POST /mobile/api/v1/sessions/:sessionId/abort
GET  /mobile/api/v1/sessions/:sessionId/models
POST /mobile/api/v1/sessions/:sessionId/model
```

---

## 2. DTO 定义

### ProjectDTO
```json
{
  "projectId": "string (cwd 的 hash 或 normalized path)",
  "name": "string (文件夹名)",
  "cwd": "string",
  "sessionCount": 0,
  "lastModified": "ISO8601"
}
```

### SessionSummaryDTO
```json
{
  "sessionId": "string",
  "projectId": "string",
  "name": "string | null",
  "preview": "string",
  "messageCount": 0,
  "created": "ISO8601",
  "modified": "ISO8601",
  "running": false
}
```

### HistoryDTO
```json
{
  "sessionId": "string",
  "messages": [
    {
      "role": "user | assistant | toolResult | custom",
      "content": [
        { "type": "text", "text": "string" },
        { "type": "toolCall", "id": "string", "name": "string", "input": {} },
        { "type": "thinking", "text": "string (可选，deferThinking时省略)" }
      ]
    }
  ],
  "model": { "provider": "string", "modelId": "string" },
  "thinkingLevel": "string",
  "truncated": false,
  "totalMessageCount": 0
}
```

### StateDTO（移动端精简版，不含 systemPrompt/sessionFile）
```json
{
  "running": false,
  "isStreaming": false,
  "isPromptRunning": false,
  "isCompacting": false,
  "model": { "id": "string", "provider": "string" },
  "thinkingLevel": "string",
  "contextUsage": { "percent": 0, "contextWindow": 0, "tokens": 0 }
}
```

### ModelListDTO
```json
{
  "models": [
    { "id": "string", "name": "string", "provider": "string" }
  ],
  "defaultModel": { "provider": "string", "modelId": "string" } | null,
  "thinkingLevels": { "provider:modelId": ["off", "low", "medium", "high"] }
}
```

---

## 3. 错误码

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 请求体格式错误 |
| 401 | `UNAUTHORIZED` | 未登录或 Cookie 无效 |
| 403 | `FORBIDDEN` | Origin 不匹配 |
| 404 | `SESSION_NOT_FOUND` | session 不存在 |
| 404 | `PROJECT_NOT_FOUND` | project 不存在 |
| 409 | `SESSION_BUSY` | 运行中，操作被拒绝（如运行中切模型） |
| 413 | `HISTORY_TOO_LARGE` | 历史超过 8MiB 硬限 |
| 429 | `RATE_LIMITED` | 登录限速 |
| 502 | `UPSTREAM_UNAVAILABLE` | pi-web 不可达 |
| 503 | `BRIDGE_STARTING` | bridge 启动中 |

错误响应格式：
```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "...", "retryable": false } }
```

---

## 4. SSE 事件转发规则

BFF 转发上游 SSE，添加自己的心跳（20秒）：

```
data: {"type":"connected","sessionId":"..."}

data: {"type":"agent_start",...}

data: {"type":"message_update",...}

:

```

**断线恢复语义：**
- 客户端断线后重连，BFF 重新建立上游 SSE
- 客户端应重新拉取 `GET /mobile/api/v1/sessions/:id/state` 获取权威快照
- 不承诺断线期间逐 token 无损；以快照最终一致为准

---

## 5. 字段过滤规则（BFF → 移动端）

以下字段**不得**转发给移动端：
- `state.systemPrompt`（完整系统提示，敏感/体积大）
- `state.sessionFile`（绝对路径）
- `state.queuedMessages`（内部队列）
- `filePath`（session 文件绝对路径）
- `info.path`（同上）

---

## 6. 请求体限制

| 端点 | 最大 body |
|---|---|
| `POST /mobile/auth/login` | 1 KB |
| `POST /mobile/api/v1/sessions/:id/messages` | 64 KB |
| `POST /mobile/api/v1/sessions/:id/model` | 1 KB |
| 其他 POST | 4 KB |
