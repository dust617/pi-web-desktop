# 当前任务发现

> v0.2.0 规划研究的关键发现。详见 `archive/tasks/2026-07-26-*`。

- Node v24 的 `assert.deepEqual` 在不同大小 Buffer 比较时抛 `Array buffer allocation failed` 而非正常断言失败
- ESM 静态 import 在同进程 reload 时缓存旧 namespace，导致 `findMemoryControlRisk is not a function`
- OpenWorker 的受管 sidecar 模式可借鉴，但 Tauri/Python 技术栈、SQLite 记忆、明文 SecretStore 不适用
- pi-web 0.8.1 最低 Node 升至 22.19.0，Pi 依赖升至 0.82.1，新增 API Origin 防护
- `/api/archived-sessions` 是下游 patch，不在官方 0.8.1 中，必须保留
