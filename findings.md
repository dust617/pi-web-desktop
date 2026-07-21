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

## 2026-07-21 22:10 定时任务失败根因

- 错误：`spawn pi ENOENT`，worker 子进程 27ms 内失败
- 原因：pi-subagents 装在 ~/.pi/agent/npm/，pi-coding-agent 装在全局 npm（AppData/Roaming/npm），两个目录互相不可见
- resolvePiCliScript 全部失败，fallback 到 spawn('pi')，Windows 后台进程无法解析 .cmd 文件
- 修复：设置用户环境变量 PI_SUBAGENT_PI_BINARY=C:\Users\Administrator\AppData\Roaming\npm\pi.cmd
- 重启 pi-web 后生效

## 2026-07-22 资源管理器右键项目切换排查

- Explorer 开发命令本身可正确传入 `--project "D:\\麻衣画布"`，第二进程也能写入 pending 文件。
- Electron 的 `second-instance` 参数顺序被 Chromium 重排，`--project` 后紧跟内部开关，原解析器因此取错值。
- pending 监听重启 pi-web 到新端口后调用 `reloadIgnoringCache()`，实际刷新的是旧端口；必须加载新 `info.url`。
- `second-instance` 与 pending watcher 同时消费同一请求，缺少统一入口、去重和串行化。
- `PiWebRuntime.stop()` 未等待旧子进程退出；旧进程的 exit 回调可能把新 runtime 状态清空。
- `/api/cwd/validate` 会修改 pi-web 的全局默认 cwd，但不会改写已存在会话头中的 cwd；因此可能出现界面显示旧会话目录、后续操作使用新默认目录的错位。
- pi-web 页面访问 `/` 时会从历史会话恢复目录，而不是按刚设置的全局 cwd 自动创建新会话。
- `/api/agent/new` 接受最小请求 `{ cwd, type: "ensure_session" }`，返回 `sessionId`；加载 `/?session=<id>` 可让界面明确选中目标 cwd 的新会话。
- 因此项目切换无需重启整个 pi-web 服务：在当前服务创建目标目录会话并导航到该 session 即可，同时避免端口变化和 runtime stop/start 竞态。
- **独立冒烟失败发现：** 首次调用 `/api/agent/new` 虽返回成功和 sessionId，但查询该会话头时 cwd 是 `resources/pi-web`，而非请求目录。不能只依据 HTTP 200 判断切换成功。
- 改用 `set_session_name` 强制空会话落盘后仍复现：实际是空会话文件尚未落盘，按临时路径查询时 SessionManager 用 `process.cwd()` 构造了临时头；因此后台预建 `?session=` 方案不可行。
- 正确方案是 `/?cwd=` 直接初始化 pi-web 前端已有的 newSessionCwd 状态；隐藏 Electron 已验证目标中文路径及其标记文件均出现在 Explorer。
- 最终审查补充：runtime 需要启动 generation/提前退出竞速处理；fallback 应改成每请求一个 spool 文件；popup/IPC 必须使用当前 runtime 精确 origin。
