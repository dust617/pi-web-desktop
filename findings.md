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
