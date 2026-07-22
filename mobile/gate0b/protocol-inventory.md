# pi-web 协议清单（Gate 0B 静态画像）

> 版本：@agegr/pi-web 0.7.16（锁定副本）
> 来源：`.next/server/app/api/` 路由 bundle + `node_modules/@earendil-works/pi-coding-agent/dist/`
> 置信度标注：`source-confirmed`（bundle源码直接确认）/ `live-read-only-observed`（只读探针验证）/ `unverified-mutation`（需写操作验证）

---

## 1. 会话列表

### `GET /api/sessions`

**置信度：source-confirmed**

响应：
```json
{
  "sessions": [
    {
      "id": "string",
      "cwd": "string",
      "projectRoot": "string",
      "name": "string",
      "preview": "string",
      "created": "ISO8601",
      "modified": "ISO8601",
      "messageCount": 0,
      "firstMessage": "string",
      "parentSessionId": "string | null"
    }
  ],
  "runningSessionIds": ["string"]
}
```

错误：`500 {error: "..."}`

**BFF映射：** `GET /mobile/api/v1/projects` + `GET /mobile/api/v1/projects/:projectId/sessions`
- 按 `projectRoot` 或 `cwd` 分组为项目
- `preview` 用于会话列表末尾预览

---

## 2. 会话详情（含历史）

### `GET /api/sessions/{id}?deferThinking=1&deferMedia=1`

**置信度：source-confirmed**

Query参数：
- `deferThinking`（可选）：延迟加载 thinking 块；实测减少约 11% 响应大小（227KB→202KB）
- `deferMedia`（可选）：延迟加载工具结果图片；当前 session 无图片时无效果

**移动端 BFF 应始终使用 `deferThinking=1`** 以减少响应大小。

响应：
```json
{
  "sessionId": "string",
  "filePath": "string",
  "info": {
    "path": "string",
    "id": "string",
    "cwd": "string",
    "name": "string",
    "created": "ISO8601",
    "modified": "ISO8601",
    "messageCount": 0,
    "firstMessage": "string",
    "parentSessionId": "string | null"
  },
  "leafId": "string",
  "tree": [
    {
      "entry": { "id": "string", "type": "string", ... },
      "children": [],
      "compressedEntryIds": ["string"]
    }
  ],
  "context": {
    "messages": [
      {
        "role": "user | assistant | system",
        "content": "string | [{type: 'text', text: '...'}, ...]"
      }
    ]
  }
}
```

错误：`404 {error: "Session not found"}` / `500 {error: "..."}`

**BFF映射：** `GET /mobile/api/v1/sessions/:sessionId/history`
- MVP只返回 `context.messages` 最近N条
- 不返回 `tree`（移动端不需要；`tree` 含压缩条目元数据，仅用于桌面端 UI 渲染）
- `context.entryIds` 与 `context.messages` 一一对应（实测确认）；移动端可忽略 `entryIds`
- 8MiB硬限：超过则返回 `HISTORY_TOO_LARGE`

**关键发现：** 无服务端分页参数；`context.messages` 是全量数组。

---

## 3. 会话状态

### `GET /api/sessions/{id}/state`

**置信度：source-confirmed**

响应（未运行）：
```json
{ "running": false }
```

响应（运行中）：
```json
{ "running": true, "state": { ... } }
```

`state` 对象结构：`unverified-mutation`（需 live 观察）

错误：`404 {error: "Session not found"}` / `500 {error: "..."}`

**BFF映射：** `GET /mobile/api/v1/sessions/:sessionId/state`

---

## 4. 会话重命名

### `PATCH /api/sessions/{id}`

**置信度：source-confirmed（unverified-mutation）**

请求体：
```json
{ "name": "string" }
```

响应：`{ "ok": true }`

错误：`400 {error: "name is required"}` / `404` / `500`

**BFF映射：** 延期（MVP不含改名）

---

## 5. 会话删除

### `DELETE /api/sessions/{id}`

**置信度：source-confirmed（unverified-mutation）**

响应：`{ "ok": true }`

错误：`404` / `500`

**BFF映射：** 不暴露（移动端不删除会话）

---

## 6. Agent 状态

### `GET /api/agent/{id}`

**置信度：source-confirmed**

响应（未运行）：
```json
{ "running": false }
```

响应（运行中）：
```json
{ "running": true, "state": { ... } }
```

内部：发送 `{type: "get_state"}` 到 agent session。

**BFF映射：** 与 `/sessions/:id/state` 合并

---

## 7. Agent 消息（mutation）

### `POST /api/agent/{id}`

**置信度：source-confirmed（unverified-mutation）**

请求体类型：

```json
// 发送消息
{ "type": "prompt", "message": "string" }

// 中止
{ "type": "abort" }

// 切换模型
{ "type": "set_model", "provider": "string", "modelId": "string" }

// 切换思考级别
{ "type": "set_thinking_level", "level": "off|minimal|low|medium|high|xhigh|max" }
```

响应：
```json
{ "success": true, "data": { ... } }
```

错误：`404 {error: "Session not found"}` / `500 {error: "..."}`

**注意：** 如果 agent 未运行，会自动启动（`OF` 函数）再发送。

**BFF映射：**
- `POST /mobile/api/v1/sessions/:sessionId/messages` → `{type: "prompt", message}`
- `POST /mobile/api/v1/sessions/:sessionId/abort` → `{type: "abort"}`
- `POST /mobile/api/v1/sessions/:sessionId/model` → `{type: "set_model", provider, modelId}`

---

## 8. Agent SSE 事件流

### `GET /api/agent/{id}/events`

**置信度：source-confirmed**

响应头：
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

首条事件：
```
data: {"type":"connected","sessionId":"..."}

```

心跳（每30秒）：
```
:

```

事件类型（source-confirmed from agent-session.js）：

| type | 说明 | 置信度 |
|---|---|---|
| `connected` | 连接建立，含 sessionId | source-confirmed |
| `agent_start` | agent 开始处理 | source-confirmed |
| `agent_end` | agent 结束 | source-confirmed |
| `message_start` | 消息开始 | source-confirmed |
| `message_update` | 消息**全量替换**（非 delta）；前端用新 message 对象替换当前流式消息 | source-confirmed + frontend-confirmed |
| `message_end` | 消息结束 | source-confirmed |
| `tool_execution_start` | 工具调用开始；字段：`{toolCallId, toolName}` | source-confirmed + frontend-confirmed |
| `tool_execution_end` | 工具调用结束；字段：`{toolCallId}` | source-confirmed + frontend-confirmed |
| `auto_retry_start` | 自动重试开始；字段：`{attempt, maxAttempts, errorMessage}` | source-confirmed + frontend-confirmed |
| `auto_retry_end` | 自动重试结束；无额外字段 | source-confirmed + frontend-confirmed |
| `compaction_start` / `auto_compaction_start` | 压缩开始 | source-confirmed + frontend-confirmed |
| `compaction_end` / `auto_compaction_end` | 压缩结束；字段：`{errorMessage?, aborted?, result?, reason?}` | source-confirmed + frontend-confirmed |
| `queue_update` | 队列更新；字段：`{steering: [...], followUp: [...]}` | source-confirmed + frontend-confirmed |
| `turn_start` | 轮次开始 | source-confirmed |
| `turn_end` | 轮次结束 | source-confirmed |
| `entry_appended` | 条目追加（内部事件，types.d.ts 未导出接口） | source-confirmed |
| `session_info_changed` | 会话名变化；字段：`{name: string \| undefined}` | source-confirmed + types-confirmed |
| `model_select` | 模型切换；字段：`{model, previousModel, source}` | source-confirmed + types-confirmed |
| `thinking_level_select` | 思考级别变化（注意：不是 `thinking_level_changed`）；字段：`{level, previousLevel}` | source-confirmed + types-confirmed |

**无 replay cursor：** 没有 `Last-Event-ID` 支持；断线后需重新拉取快照。

**`agent_end` 后快照拉取：** 前端在收到 `agent_end` 后会调用 `GET /api/agent/{id}` 获取最新 `contextUsage`。移动端 BFF 应实现相同逻辑。

**`message_update` 语义（frontend-confirmed）：** 每次 `message_update` 携带完整 message 对象，前端**替换**当前流式消息，不是追加 delta。移动端客户端应做同样处理。

**BFF映射：** `GET /mobile/api/v1/sessions/:sessionId/events`
- BFF 转发上游 SSE，添加自己的心跳（15-30秒）
- 断线后客户端重连，BFF 重新拉取 state 快照

---

## 9. 全局运行状态 SSE

### `GET /api/agent/running/events`

**置信度：source-confirmed**

首条事件（live-read-only-observed）：
```
data: {"type":"running","runningSessionIds":["019f85e6-ab77-775f-bada-7827e03b04e6"]}

```

后续更新：同上格式，`runningSessionIds` 变化时推送。

心跳：每30秒 `:\n\n`

**BFF映射：** 可用于移动端全局运行状态指示器（可选）；也可用于会话列表的 `running` 字段实时更新

---

## 10. 新建会话

### `POST /api/agent/new`

**置信度：source-confirmed（unverified-mutation）**

请求体：
```json
{
  "cwd": "string (required)",
  "type": "ensure_session",
  "provider": "string (optional)",
  "modelId": "string (optional)",
  "toolNames": ["string"] ,
  "thinkingLevel": "off|minimal|low|medium|high|xhigh|max (optional)"
}
```

响应：
```json
{ "success": true, "sessionId": "string", "data": null }
```

错误：`400 {error: "cwd is required"}` / `400 {error: "Directory does not exist: ..."}` / `500`

**注意：** `cwd` 必须是已存在的目录；`type: "ensure_session"` 只创建不发消息。

**BFF映射：** 延期（MVP不含新建会话）

---

## 11. 模型列表

### `GET /api/models?cwd={path}`

**置信度：source-confirmed**

Query参数：
- `cwd`（可选，默认 `process.cwd()`）：项目目录，影响可用模型

响应：
```json
{
  "models": {
    "provider:modelId": "Display Name"
  },
  "modelList": [
    { "id": "string", "name": "string", "provider": "string" }
  ],
  "defaultModel": {
    "provider": "string",
    "modelId": "string"
  },
  "thinkingLevels": {
    "provider:modelId": ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
  },
  "thinkingLevelMaps": {
    "provider:modelId": { ... }
  }
}
```

错误：`400 {error: "Directory does not exist: ..."}` / `400 {error: "Not a directory: ..."}`

**缓存：** 服务端有60秒内存缓存（`__piModelsCacheState`），最多32个cwd条目。

**BFF映射：** `GET /mobile/api/v1/sessions/:sessionId/models`
- BFF 从 session 的 `cwd` 调用此接口
- 返回 `modelList` + `defaultModel` + `thinkingLevels`

---

## 12. 其他端点（不映射到移动端）

| 端点 | 方法 | 说明 |
|---|---|---|
| `GET /api/home` | GET | 返回 `{home: "..."}` |
| `POST /api/cwd/validate` | POST | 验证 cwd 合法性 |
| `GET /api/sessions/{id}/context` | GET | 返回 `{context: {...}}`；比 session detail 多了每条消息的 `usage/cost/provider/model/timestamp` 元数据；移动端不需要 |
| `GET /api/sessions/{id}/export` | GET | 导出会话 |
| `GET /api/sessions/{id}/entries/{entryId}/thinking?blockIndex=N` | GET | 获取指定 thinking 块完整内容；`blockIndex` 是 0-based 整数；配合 `deferThinking=1` 使用，移动端可懒加载 thinking |
| `GET /api/file-index` | GET | 文件索引 |
| `GET /api/files/{...path}` | GET | 文件内容 |
| `GET /api/plugins` | GET | 插件列表 |
| `GET /api/skills/check` | GET | 技能检查 |
| `GET /api/models-config` | GET | 模型配置 |
| `GET /api/models-config/test` | GET | 模型配置测试 |
| `GET /api/auth/providers` | GET | 认证提供者 |
| `GET /api/auth/all-providers` | GET | 所有认证提供者 |
| `POST /api/auth/login/{provider}` | POST | 登录 |
| `POST /api/auth/logout/{provider}` | POST | 登出 |
| `GET /api/auth/api-key/{provider}` | GET | API key |

---

## 13. 关键架构发现

1. **无服务端分页：** `GET /api/sessions/{id}` 返回全量 `context.messages`，无 `limit/offset/cursor` 参数。
2. **无 SSE replay：** 事件流没有 `Last-Event-ID` 或序列号；断线后只能重新拉取快照。
3. **Agent 自动启动：** `POST /api/agent/{id}` 和 `GET /api/agent/{id}/events` 在 agent 未运行时会尝试自动启动。
4. **模型缓存：** `GET /api/models` 有60秒服务端缓存；切换模型后需等待缓存过期或重启才能看到新列表。
5. **`get_state` 响应结构：** `unverified-mutation`，需要 live 观察确认字段。
6. **`message_update` 增量格式：** `unverified-mutation`，需要 live 观察确认是 delta 还是全量替换。
7. **`runningSessionIds` 来源：** `HG()` 函数，来自内存中的 agent session 注册表。

---

## 14. 延期验证项（unverified-mutation）

以下需要写操作或 live 观察，本次 Gate 0B 不执行：

- [ ] `POST /api/agent/{id}` 发送 `prompt` 的实际响应 `data` 结构
- [ ] `POST /api/agent/{id}` 发送 `abort` 的实际响应
- [ ] `POST /api/agent/{id}` 发送 `set_model` 的实际响应和生效时机
- [ ] `POST /api/agent/{id}` 发送 `set_thinking_level` 的实际响应
- [ ] `GET /api/agent/{id}` 的 `state` 对象完整字段
- [x] `message_update` 事件是 delta 还是全量 → **全量替换**（frontend-confirmed）
- [ ] `message_start` / `message_end` 事件的完整字段
- [ ] `tool_execution_start` / `tool_execution_end` 事件的完整字段
- [ ] `POST /api/agent/new` 创建会话后 `sessionId` 格式
- [ ] 运行中切换模型是否被拒绝或排队
- [ ] 大 session（>1000条消息）的 `GET /api/sessions/{id}` 响应时间和内存
