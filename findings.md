# 当前任务发现

> v0.2.0 规划研究的关键发现。详见 `archive/tasks/2026-07-26-*`。

- Node v24 的 `assert.deepEqual` 在不同大小 Buffer 比较时抛 `Array buffer allocation failed` 而非正常断言失败
- ESM 静态 import 在同进程 reload 时缓存旧 namespace，导致 `findMemoryControlRisk is not a function`
- OpenWorker 的受管 sidecar 模式可借鉴，但 Tauri/Python 技术栈、SQLite 记忆、明文 SecretStore 不适用
- pi-web 0.8.1 最低 Node 升至 22.19.0，Pi 依赖升至 0.82.1，新增 API Origin 防护
- `/api/archived-sessions` 是下游 patch，不在官方 0.8.1 中，必须保留
- [2026-07-26 修复前] staging 曾为 `buildFromSource: false` 且编译产物缺少 `archived-sessions` route；fail-closed source stage 已替代该行为。
- [2026-07-26 验证] `FrpcAdapter` 在 ManagedProcess 仍为 `starting` 时以 `isHealthy()` 检查就绪，后者要求 `running`，导致真实启动无法达成；日志监听也在 child 创建前挂载。
- [2026-07-26 修复前] 失败 Gate：`test:package`（asar 与 dist/main.js 不一致）、`test:memory`（缺 jiti runtime）、`test:pi-web`（126/129，通过外有 3 失败）。
- [2026-07-26 修复] pi-web 的 Next tracing 会扫描 Windows 用户目录中的不可读 junction；以包内隔离 HOME/USERPROFILE 执行 build 后，source build、archived-sessions 编译及 staged test 均通过。
- [2026-07-26 修复] frpc pipe 的 read chunk 不是 log line；adapter 必须缓存未完成 chunk，并在 readiness 匹配时包含该缓存。
- [2026-07-26 审计] 0.8.1 同步曾遗漏旧定制的会话归档 UI、右键复制 Session ID、普通发送失败提示、compaction 尾部保持和模型加载错误反馈；完整状态和迁移条件见 `docs/pi-web-downstream-delta.md`。
- [2026-07-26 修复] 移动端桌面发言的末条问题锚点不能以“旧问题非空”判断刷新成功；`refreshHistory()` 必须返回是否实际应用，并以 session/load generation 保护一次有限重试。
- [2026-07-26 修复] 五项旧定制遗漏已恢复并写为 `session-ui-adapters` fail-closed patch；未来上游 UI 变动会使 stage 失败，而不会静默丢失会话归档/复制及恢复 UX。

## P8 模型与压缩稳定性核查

- [2026-07-26 运行时] 当前 Pi/AI 均为 0.82.1；默认模型为 `openai-codex/gpt-5.6-sol:high`，内置元数据是 272K context / 128K max output。
- [2026-07-26 配置根因] 全局 `compaction.reserveTokens=131072` 本身是为 GPT 128K 最大输出预留，逻辑可成立；真正冲突是自定义 Qwen3.7/3.6/GLM 被错误标为 128K，使阈值 `contextWindow-reserveTokens` 小于等于零，供应会话因此在约 40K tokens 就反复自动压缩。
- [2026-07-26 官方资料] 阿里云模型页及 Pi 0.82.1 内置 `qwen-token-plan-cn` catalog 均显示：Qwen3.7 Plus/Max、Qwen3.6 Flash 为 1,000,000 context；Plus/Flash max output 65,536，GLM-5.2 为约 1M/131,072。当前自定义条目明显过时。
- [2026-07-26 历史证据] 旧 Qwen3.8 会话曾在单次输出约 132K 后连续 `stopReason=length`；另有 41 次 `Request timed out.`，均来自 Qwen3.8。当前 provider timeout 300s 会截断超长推理/输出。
- [2026-07-26 GPT 证据] GPT 故障主要不是模型元数据：多份 session 明确记录 `configuredTransport=auto` 的 WebSocket 在流开始后断开，错误为 `WebSocket error`、`terminated`、`fetch failed`；另有 ChatGPT 后端 `Service Unavailable`/`Too many concurrent requests`。请求体越大越易复现，自动重试 5 次会放大故障。
- [2026-07-26 切换边界] 从约 345K Qwen 会话切到 272K Codex 必然超出 GPT 窗口；历史记录显示先连续网络失败，再报 context exceeded，压缩后才恢复。配置不能让较小模型无损接收较大历史；跨 provider 应新建会话并从项目 Brief/检查点继续。
- [2026-07-26 安全/修复前] `models.json` 存在明文 API key；`wan2.7-image-pro` 使用专用图像生成接口，不是 Chat Completions 模型，不应出现在 Pi 对话模型列表。
- [2026-07-26 已调整] 凭据已迁移至 Pi 官方 `auth.json` 且模型文件不再含 secret pattern；移除图像模型。Qwen3.8/3.7/3.6 与 GLM-5.2 context 均校正为 1M；Qwen3.7 Plus/Max 与 Qwen3.6 Flash 依官方模型页设 max output 65,536，Qwen3.8 与 GLM-5.2 保持当前 Pi 0.82.1 Token Plan catalog 的 131,072。
- [2026-07-26 已调整] Codex 常规请求强制 SSE；HTTP/provider timeout 由 300s 提到 600s；agent retry 从 5 次降为 2 次、provider retry 保持 0；全局 reserve 131,072 保留以让 272K GPT 在约 141K 自动压缩，所有当前对话模型阈值均已转为正数（Qwen/GLM 868,928）。
- [2026-07-26 残余风险] Pi 0.82.1 的 compaction 汇总调用不显式继承全局 transport，因此 `transport=sse` 不能保证 `/compact` 不走 provider 默认 WebSocket；ChatGPT 后端服务波动/并发限制及大窗口向小窗口切换也不能仅靠配置消除。
- [2026-07-26 验证] JSON、模型注册、权限受限 auth、供应商 catalog 认证探针均通过；干净临时目录中的 Qwen3.7 Plus 与 GPT-5.6 Sol SSE 一次性 smoke 均返回预期结果。
