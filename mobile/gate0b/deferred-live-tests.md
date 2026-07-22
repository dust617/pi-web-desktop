# 延期 Live 测试清单（Gate 0B 未完成项）

> 以下测试需要写操作或可能影响真实 session，本次通宵执行边界明确禁止。
> 需在用户 awake 后，在隔离测试 session 中手动执行。

---

## 1. Mutation 测试（需要隔离测试 session）

### 1.1 发送消息
```
POST /api/agent/{testSessionId}
Body: {"type": "prompt", "message": "Hello, this is a test."}
```
**验证：** 响应 `{success: true, data: {...}}`；SSE 收到 `agent_start` → `message_start` → `message_update` → `message_end` → `agent_end`

### 1.2 中止运行
```
POST /api/agent/{testSessionId}
Body: {"type": "abort"}
```
**验证：** 响应 `{success: true}`；SSE 收到中止相关事件；`get_state` 显示 `isPromptRunning: false`

### 1.3 切换模型
```
POST /api/agent/{testSessionId}
Body: {"type": "set_model", "provider": "example-provider", "modelId": "example-model"}
```
**验证：** 响应 `{success: true}`；`get_state` 的 `model` 字段更新；运行中切换是否被拒绝或排队

### 1.4 切换思考级别
```
POST /api/agent/{testSessionId}
Body: {"type": "set_thinking_level", "level": "medium"}
```
**验证：** 响应 `{success: true}`；`get_state` 的 `thinkingLevel` 字段更新

### 1.5 新建会话
```
POST /api/agent/new
Body: {"cwd": "D:\\test-project", "type": "ensure_session"}
```
**验证：** 响应 `{success: true, sessionId: "...", data: null}`；新 session 出现在 `GET /api/sessions`

---

## 2. SSE 事件格式验证

### 2.1 message_update 是 delta 还是全量
- 发送一条长消息，观察 `message_update` 事件的 `delta` 字段
- 确认是增量追加还是全量替换

### 2.2 tool_execution_start/end 完整字段
- 触发一个工具调用（如 `read` 文件）
- 记录 `tool_execution_start` 和 `tool_execution_end` 的完整字段

### 2.3 compaction 事件
- 在长 session 中触发自动压缩
- 记录 `compaction_start` 和 `compaction_end` 的完整字段

### 2.4 auto_retry 事件
- 触发自动重试（如网络错误）
- 记录 `auto_retry_start` 和 `auto_retry_end` 的完整字段

---

## 3. 边界情况

### 3.1 大 session 历史响应
- 找一个 context window 接近满载的 session
- 测量 `GET /api/sessions/{id}` 的响应大小和耗时
- 确认是否超过 8MiB

### 3.2 并发 SSE 连接
- 同时打开两个 SSE 连接到同一 session
- 确认是否都收到事件，还是只有一个活跃

### 3.3 pi-web 重启后 session 恢复
- 重启 pi-web（在用户允许时）
- 确认 session 列表和历史是否完整恢复

### 3.4 运行中 session 的 state 轮询
- 在 agent 运行时反复调用 `GET /api/sessions/{id}/state`
- 确认 `isStreaming` 和 `isPromptRunning` 的转换时机

---

## 4. 执行前提

- 用户 awake 并明确授权
- 使用专用测试 session（不在真实工作 session 中测试）
- 测试完成后清理测试 session（如需要）
- 不产生外部模型费用（使用本地/免费模型）
