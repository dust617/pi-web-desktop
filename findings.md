# findings.md

> 权威计划见 PROJECT_PLAN.md。

## 关键技术发现

- pi-web 是开源 MIT 项目（github.com/agegr/pi-web），完整 TypeScript/React 源码可用。
- pi-web CLI 支持：`--port <port>` / `-p`、`--hostname <host>` / `-H`、`--no-open`，也支持 PORT/HOSTNAME/PI_WEB_NO_OPEN 环境变量。
- pi-web bin/pi-web.js 内部用 `process.execPath` 启动 Next.js，因此必须用系统 node.exe 运行，不能用 Electron 可执行文件。
- 本机有 @agegr/pi-web@0.7.16，默认端口 30141，当前已被占用。
- Electron 拖拽取路径正确方式：preload 层 `webUtils.getPathForFile(file)`，不是主进程监听 OS 拖放。
- Windows 清理进程树：`taskkill /T /F /PID <pid>`，只 kill 直接子进程会残留 Next.js 子进程。
- useDragDrop.ts 当前只处理 image/*，非图片直接丢弃；加一行 window.__piDesktop 检测即可扩展。
- pi-web 无 native 模块依赖，打包风险低。
- 全局 pi-web + 补丁方案有根本矛盾：npm update -g 会覆盖补丁。改为内置锁定版本解决。
