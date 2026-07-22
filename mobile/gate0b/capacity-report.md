# 容量与历史预算报告（Gate 0B）

> 测量时间：2026-07-22 03:48 UTC+8
> 环境：pi-web 0.7.16，127.0.0.1:62809，Windows，Node.js
> 方法：只读 GET 请求 + 只读文件统计；未读取/输出任何会话正文

---

## 1. Session 文件统计（~/.pi/agent/sessions/）

| 指标 | 值 |
|---|---|
| .jsonl 文件总数 | 31 |
| 最小 | 1,491 B |
| p50 | 364,687 B（~356 KB） |
| p90 | 1,448,487 B（~1.4 MB） |
| p95 | 1,899,301 B（~1.8 MB） |
| 最大 | 9,346,539 B（~8.9 MB） |
| 均值 | 767,017 B（~749 KB） |
| 总计 | 23,777,512 B（~22.7 MB） |

**注意：** 文件大小 ≠ API 响应大小。API 返回的是压缩后的 context window，不是全量 JSONL。

---

## 2. API 响应大小实测

| 端点 | 响应大小 | 耗时 | 备注 |
|---|---|---|---|
| `GET /api/sessions`（19个session） | 9,123 B | 0.185s | 含首次冷启动 |
| `GET /api/sessions/{id}`（2 msgs） | 2,403 B | 0.014s | 最小 session |
| `GET /api/sessions/{id}`（27 msgs） | 41,159 B | 0.015s | 中等 session |
| `GET /api/sessions/{id}`（30 msgs context） | 85,514 B | 0.021s | 745 total entries，context 压缩后30条 |
| `GET /api/sessions/{id}`（168 msgs，运行中） | 474,106 B | 0.041s | 当前运行 session |
| `GET /api/models?cwd=...`（14个模型） | 3,449 B | 0.103s | 含60秒服务端缓存 |

---

## 3. 关键发现：messageCount 语义差异

**Session 列表的 `messageCount` ≠ Session 详情的 `context.messages.length`**

- Session 列表 `messageCount`：session 文件中的**总条目数**（含已压缩条目）
- Session 详情 `info.messageCount`：当前 **context window 中的消息数**（压缩后）
- 实测：一个 `messageCount=745` 的 session，API 只返回 30 条 context messages（85KB）

**结论：** pi-web 已有内置压缩（compaction），API 响应大小由 context window 决定，不由总历史决定。

---

## 4. Context 消息结构

实测 context.messages 中的 role 分布（30条样本）：
- `user`: 5
- `assistant`: 15
- `toolResult`: 9
- `custom`: 1

Content block 类型：
- `text`: 21
- `thinking`: 15（`deferThinking=1` 时仍存在但内容可能延迟）
- `toolCall`: 9
- `raw_string`: 1

---

## 5. get_state 响应结构（live-read-only-observed）

```json
{
  "running": true,
  "state": {
    "sessionId": "string",
    "sessionFile": "string (绝对路径)",
    "isStreaming": true,
    "isPromptRunning": true,
    "isCompacting": false,
    "autoCompactionEnabled": true,
    "autoRetryEnabled": true,
    "model": { "id": "string", "provider": "string" },
    "messageCount": 0,
    "pendingMessageCount": 0,
    "queuedMessages": { "steering": [], "followUp": [] },
    "contextUsage": {
      "percent": 78.03,
      "contextWindow": 128000,
      "tokens": 99873
    },
    "systemPrompt": "string (完整系统提示)",
    "thinkingLevel": "high",
    "extensionStatuses": [{ "key": "mcp", "text": "MCP: 0/4 servers" }],
    "extensionWidgets": []
  }
}
```

**移动端注意：**
- `state.systemPrompt` 包含完整系统提示，**不应转发给移动端**（敏感/体积大）
- `state.sessionFile` 包含绝对路径，**不应转发给移动端**
- 移动端只需要：`running`, `isStreaming`, `isPromptRunning`, `model`, `thinkingLevel`, `contextUsage`

---

## 6. 8MiB 历史上限评估

| 场景 | 响应大小 | 是否超限 |
|---|---|---|
| 小 session（2 msgs） | 2.4 KB | 否 |
| 中 session（27 msgs） | 41 KB | 否 |
| 大 session（30 msgs context，745 total） | 85 KB | 否 |
| 运行中 session（168 msgs） | 474 KB | 否 |
| 理论最大（context window 满载） | ~2-5 MB（估算） | 可能接近 |

**结论：** 由于 pi-web 内置 compaction，实际 API 响应远小于 session 文件大小。8MiB 上限对当前数据是安全的，但需要监控 context window 满载时的极端情况。

**建议：** 保持 8MiB 初始上限；如果未来 context window 增大（如 1M token），需要重新评估。

---

## 7. 模型列表缓存

- 服务端有 60 秒内存缓存（`__piModelsCacheState`）
- 最多缓存 32 个不同 cwd 的模型列表
- 切换模型后，模型列表可能需要等待缓存过期才能反映变化
- **移动端影响：** 切换模型后，模型列表可能短暂显示旧值；以 `get_state` 的 `model` 字段为权威来源

---

## 8. 内存预算建议

| 操作 | 建议限制 |
|---|---|
| 单次历史响应 | 8 MiB（硬限，流式计数 abort） |
| 全局并发历史请求 | 1（single-flight） |
| 同 session 并发请求 | 1（single-flight） |
| 模型列表缓存（BFF侧） | 60秒 TTL，与上游一致 |
| SSE 连接数（BFF侧） | 每 session 最多 1 个活跃 SSE |
