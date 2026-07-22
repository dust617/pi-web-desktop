# Gate 0B 通宵执行总结

> 执行时间：2026-07-22 03:42 – 04:35 UTC+8（提前完成）
> 边界：`mobile/OVERNIGHT_RUN.md` 全部遵守；无 mutation、无源码修改、无 ~/.pi 触碰

---

## 完成项

| Phase | 状态 | 产出 |
|---|---|---|
| A. 安全检查 | ✅ | 进程/端口/磁盘确认 |
| B. 静态协议画像 | ✅ | `protocol-inventory.md`（14个端点，含置信度） |
| C. 只读实时探针 | ✅ | `capacity-report.md` + `read-only-probe.mjs` |
| D. 容量测量 | ✅ | `capacity-report.md`（session文件统计 + API响应实测） |
| E. Fixture/契约 | ✅ | `fixtures/`（6个合成文件）+ `bff-contract-draft.md` + `fixture-check.mjs`（27/27通过） |
| F. 实现指南 | ✅ | `bff-implementation-guide.md` |
| G. 延期清单 | ✅ | `deferred-live-tests.md` |

---

## 关键发现（影响 Stage 1 实现）

1. **`message_update` 是全量替换**，不是 delta。移动端客户端每次收到 `message_update` 应替换当前流式消息。
2. **`agent_end` 后需快照对账**：前端在 `agent_end` 后调用 `GET /api/agent/{id}` 获取最新 `contextUsage`。BFF 应实现相同逻辑。
3. **`deferThinking=1` 减少约 11% 响应大小**；BFF 应始终使用。
4. **`get_state` 含 `systemPrompt` 和 `sessionFile`**：BFF 必须过滤，不得转发给移动端。
5. **Session 列表 `messageCount` ≠ context messages 数量**：前者是总条目数（含已压缩），后者是 context window 中的消息数。
6. **8MiB 历史上限对当前数据安全**：最大实测响应 512KB（168条 context messages）；pi-web 内置 compaction 已限制响应大小。
7. **`GET /api/models` 有 60秒服务端缓存**：切换模型后列表可能短暂显示旧值；以 `get_state` 的 `model` 字段为权威来源。
8. **`thinking_level_select`**（不是 `thinking_level_changed`）：事件名需注意。
9. **`POST /api/agent/{id}` 在 agent 未运行时会自动启动 agent**：BFF 需注意此行为，避免意外启动。
10. **`GET /api/agent/running/events`** 可用于全局运行状态指示器；首条事件已 live 确认。

---

## 未验证项（需用户 awake 后 live 测试）

- `POST /api/agent/{id}` 发送 `prompt`/`abort`/`set_model` 的实际响应 `data` 结构
- 运行中切换模型是否被拒绝或排队
- `message_update` 在长消息时的频率和大小
- 大 session（context window 满载）的响应大小是否接近 8MiB
- 并发 SSE 连接行为
- pi-web 重启后 session 恢复

详见 `deferred-live-tests.md`。

---

## 下一步（用户 awake 后）

1. 审阅本总结和 `protocol-inventory.md`
2. 决定域名路径：申请 `*.dpdns.org`/`*.qzz.io`（Cloudflare Named Tunnel）或保留 `qd.je`（SakuraFrp）
3. 在隔离测试 session 中执行 `deferred-live-tests.md` 中的 mutation 测试
4. Gate 0A（域名/隧道）和 Gate 0B（live mutation）均通过后，开始 Stage 1 实现

---

## 文件清单

```
mobile/gate0b/
├── SUMMARY.md                  ← 本文件
├── protocol-inventory.md       ← 14个端点完整画像
├── capacity-report.md          ← 容量与历史上限评估
├── bff-contract-draft.md       ← BFF DTO/错误码/SSE规则
├── bff-implementation-guide.md ← Stage 1 实现参考
├── deferred-live-tests.md      ← 延期 mutation 测试清单
├── read-only-probe.mjs         ← 只读探针脚本（可重复运行）
├── fixture-check.mjs           ← 离线 fixture 验证（27/27通过）
└── fixtures/
    ├── sessions-list.json
    ├── session-detail.json
    ├── state-running.json
    ├── state-idle.json
    ├── models.json
    └── sse-stream.txt
```
