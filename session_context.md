# session_context.md

> 权威计划见 PROJECT_PLAN.md。本文件仅为上下文快照。

## 目标

优先交付稳定、独立的 Pi Web Windows 桌面版；移动端在桌面版稳定后才开始。

## 关键决策（已锁定）

- **内置锁定 pi-web 版本**（resources/pi-web/），不依赖全局 npm 安装。
- 上游更新：手动下载 -> 隔离测试 -> 替换 resources/pi-web/ -> 重新打包。不自动更新。
- 用**系统 node.exe** 启动 pi-web（不用 Electron 自身可执行文件）。
- 服务只绑定 127.0.0.1，动态端口，HTTP 2xx 就绪检查（30 秒超时）。
- 退出时 taskkill /T /F /PID 清理完整进程树，验证端口释放。
- 拖拽用 webUtils.getPathForFile(file)（Electron 官方推荐方式）。
- useDragDrop.ts 一行补丁已含在锁定版本中，不受上游更新影响。
- IPC 校验 sender frame URL，外链只允许 https:。
- Android 后续用 Tailscale 私有网络，不在本计划内。

## 不做

- 不接入 Qoder。
- 不把外部文件自动复制进项目。
- 不用 Electron 可执行文件运行 pi-web。
- 不自动更新 pi-web。
