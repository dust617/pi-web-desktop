# session_context.md

> 权威计划见 PROJECT_PLAN.md。本文件仅为上下文快照。

## 当前目标

检查项目内 mobile 版本的实际进度和问题；以代码、构建、测试和当前运行状态为准，核对文档宣称。

## 当前检查状态

- 已读取根目录及 `mobile/` 连续性文档。
- `npm run build`、Gate 0B fixture 27/27、当前本地 BFF 只读契约 13 项均通过；安装包包含当前 MobileBridge/PWA 文件。
- 当前公网入口未完成：权威 NS 仍为 dnsowl，`mobile.tt56677.top` 为 NXDOMAIN；本机 62809/62810 正常监听，cloudflared 进程在运行。
- P0：未鉴权 `/mobile/auth/pairing-code` 经 Tunnel 同样可达，等于公开登录码。
- P0：Electron 集成创建 MobileBridge 时未配置公网 allowed origin，公网 POST 会被 403；standalone 才配置域名。
- P1：项目卡片把 JSON 字符串嵌入双引号 `onclick`，HTML 属性被截断，项目→会话导航失效。
- P1：请求体超限时销毁 socket，客户端收到连接重置而非约定的 413 JSON。
- 当前存在多个重复 watchdog/setup Bash 实例，传播后可能并发重启 Tunnel；移动端相关源码和配置仍大面积未提交。
- 文档阶段状态已落后于实现，尚无可复现的“40/40”测试脚本。

## 下一步

按 P0→P1 修复并补自动化回归；清理重复 watchdog 前先核对目标 PID，避免影响现有 cloudflared/BFF/pi-web。

## 交接报告

- 自包含审查报告：`MOBILE_AUDIT_REPORT.md`。
- 可直接发送给后续开发者或修复 Agent，报告中未记录配对码、Cookie、Token 或 Tunnel credential。

## 关键决策（已锁定）

- **内置锁定 pi-web 版本**（resources/pi-web/），不依赖全局 npm 安装。
- 上游更新：手动下载 -> 隔离测试 -> 替换 resources/pi-web/ -> 重新打包。不自动更新。
- 用**系统 node.exe** 启动 pi-web（不用 Electron 自身可执行文件）。
- 服务只绑定 127.0.0.1，动态端口，HTTP 2xx 就绪检查（30 秒超时）。
- 退出时 taskkill /T /F /PID 清理完整进程树，验证端口释放。
- 拖拽用 webUtils.getPathForFile(file)（Electron 官方推荐方式）。
- useDragDrop.ts 一行补丁已含在锁定版本中，不受上游更新影响。
- IPC 校验 sender frame URL，外链只允许 https:。
- 移动端当前采用 loopback MobileBridge + PWA + Cloudflare Tunnel 路线，Tailscale 旧决策已过时。

## 不做

- 不接入 Qoder。
- 不把外部文件自动复制进项目。
- 不用 Electron 可执行文件运行 pi-web。
- 不自动更新 pi-web。
