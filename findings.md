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

## 2026-07-22 移动端实现审查

- 当前源码可编译；Gate 0B 合成 fixture 检查 27/27 通过；当前 62810 BFF 对真实 62809 pi-web 的只读契约检查 13 项通过。
- 两个发布 EXE 的 `app.asar` 含 `dist/mobile-bridge.js` 与 `resources/mobile/*`，且移动静态资源与当前工作区哈希一致。
- 严重鉴权缺口：`GET /mobile/auth/pairing-code` 未鉴权。loopback 绑定不能把它视为本地专用，因为 cloudflared 会把公网请求转发到同一 loopback 服务。
- 严重集成缺口：`src/main.ts` 使用 `new MobileBridge({ runtime })`，未传 `allowedOrigins`；公网同源页面的 POST Origin 会被 MobileBridge 拒绝。standalone 脚本单独硬编码了公网 Origin，两条启动路径行为不一致。
- PWA 项目卡片把 `JSON.stringify(projectId)` 直接嵌入双引号 `onclick` 属性；HTML 解析确认属性在 projectId 的双引号处截断，项目列表无法可靠进入会话列表。
- `readBody()` 超限后 `req.destroy()`；实测 2KB 登录请求得到 socket reset，而不是代码试图返回的 400/413 JSON。
- “刷新配对码”托盘项只显示现有码，没有调用 regenerate/revoke；命名与行为不一致。
- 当前公网 DNS 未完成：1.1.1.1、8.8.8.8、9.9.9.9 查询 NS 均仍为 dnsowl，`mobile.tt56677.top` NXDOMAIN；尚未完成 Gate 0A、真机、长 SSE 和网络切换验收。
- 发现多个并行 `ns-watchdog.sh` 和 `tunnel-auto-setup-v2.sh` 实例；脚本共享同一日志/状态文件，传播后还会并发 taskkill/start cloudflared，存在竞态。
- 移动端主要源码、资源、构建配置和文档均未进入当前 HEAD；fresh clone 不包含 MobileBridge，实现存在丢失与不可复现风险。

## 2026-07-23 卡住 session、流式与千问上下文

- 上一 session `019f85e6…` JSONL 共约 7.8 MiB、1413 行，逐行 JSON 校验通过；停在一次压缩条目后，不是文件损坏。
- pi-web 单会话 state 顶层 `running` 使用 `isAlive()`，而列表 `runningSessionIds` 使用 `isRunning()`；移动端必须将 active 定义为 alive 且 `isPromptRunning || isStreaming || isCompacting`。
- PWA 原先忽略 `message_end`。一次 agent run 中每次工具调用前后会产生多条 assistant/toolResult 消息；下一条 `message_update` 会替换唯一 streaming bubble，导致上一段先消失，`agent_end` 拉历史后才重新出现。
- pi-ai 的 `assistantMessageEvent` 带 `contentIndex`，文本、thinking、tool-call block 可以交错；流式 reducer 应按数组索引合并，并拒绝较短的回退快照，不能按到达顺序拼段。
- MobileBridge 与 pi-web 都发送未命名 SSE `data: {"type":"connected"}`；浏览器的 `addEventListener("connected")` 不会触发，必须在 JSON `type` 分支中做重连对账。
- `refreshHistory()` 若没有 session/load guard，会让旧请求覆盖新会话；全量 history render 还会清掉当前未落盘 streaming DOM，需保留并重绘流式快照。
- 阿里云官方 OpenCode/Kilo CLI/OpenClaw 配置对精确模型 `qwen3.8-max-preview` 给出 `contextWindow=983616`、最大输出 `131072`；无需额外长上下文参数。
- 本机 `~/.pi/agent/models.json` 原来显式写成 `128000/16384`，Pi 因而显示 128K，并按这个错误窗口提前触发压缩；已修为官方精确值。现有运行会话需重新选择模型或重启后才会拿到新 Model 对象。
- 官方来源：<https://help.aliyun.com/zh/model-studio/opencode>、<https://help.aliyun.com/zh/model-studio/kilo-cli>、<https://help.aliyun.com/zh/model-studio/openclaw>。

## 2026-07-23 移动端全链路复检（已完成）

- 当前会话真实运行模型已核对为 `openai-codex/gpt-5.6-sol`、thinking `high`；手机模型切换 POST 返回 200，pi-web state 同步显示该模型，确认不是只改下拉框。
- 初始回归通过：TypeScript、BFF 30/30、PWA 流式 reducer 8/8、HTML/SW 语法；最终修复后扩展为 BFF 32/32、PWA 12/12、SW/layout 4/4。
- 公网最终验收通过：shell/health/login/session-state/models/SSE 均正常；PWA 为 v5；Secure 7 天 cookie 正确；pairing-code 与 revoke-all HTTP 路由均 404；畸形 cookie 返回 401 而非 500。
- Tunnel watchdog 状态为 public HTTPS 200，cloudflared 单实例；近期 `context canceled`/`http2 stream closed` 与客户端主动结束 SSE/超时相符，BFF 无 fatal/runtime error。
- 公网 HTML/SW 使用 `no-store` 且 Cloudflare DYNAMIC/BYPASS；自动更新增加启动时立即 `reg.update()` 与 `updateViaCache:none`。SW 新版本预缓存若失败会拒绝安装，保留旧工作缓存。
- 输入区改为不可收缩 flex item，滚动区增加 `min-height:0`，并以 `visualViewport.height` 驱动实际可见高度；“↓ 新消息”按钮位置跟随输入区动态高度。键盘 resize/focus 也不再强制夺走用户上翻位置。
- 模型下拉框现按服务端 state 权威对账，支持包含冒号的 model ID；切换失败会恢复旧选项并给用户可见提示，桌面端/另一客户端切模型也能同步到手机。
- 修复相同 history 对账误报“新消息”、提示按钮泄漏到非聊天页面、旧 state poll 覆盖新 SSE running 状态。
- SSE 每 20 秒重新校验移动会话，过期/吊销后关闭；上游 401/404 标记 terminal，PWA 停止无意义重连。
- 旧 release 安装包经 ASAR 检查确认包含 pre-fix pairing-code 漏洞；已从当前 HEAD 重新打包，package parity 6/6，bridge/main/PWA/SW/manifest 与工作树逐字节一致。
- 剩余基础设施风险：DEV-only standalone 仍把登录状态存在项目根目录明文文件；login 限流在 cloudflared 后共享 loopback bucket；watchdog 仍按进程名全局重启 cloudflared 且不监督 BFF。这些不阻塞当前手机体验，但应在切回集成 Electron 生产路径时加固。
- SSE 当前会收到 MobileBridge 与上游各一条 connected；PWA 已 100ms debounce 对账，正确但存在低优先级冗余。

## 2026-07-23 移动端稳定性加固

- 手机确认 v5 无清缓存自动生效，输入框完整，“↓ 新消息”出现；证明 PWA 更新、visualViewport 与 smart-scroll 修复已真实落地。
- 手机→桌面模型切换已通过共享 agent state 确认真实生效；桌面→手机路径由 `model_select` SSE + `refreshState()` + v5 `syncModelSelect()` 对账。桌面 pi-web 客户端 bundle 未检索到可读的专用 `model_select` 字符串，桌面 UI 视觉同步仍需用户真机/桌面联合观察，但底层 agent 模型状态是单一真相源。
- AuthManager 持久化升级为 v2：文件只存 SHA-256 tokenHash，旧明文 `id` 自动无损迁移；temp+rename 原子写，失败可见日志。真实 `bff-sessions.json` 已迁移 19 条，零 raw id；旧手机 cookie 继续有效。
- BFF 测试增至 34/34，新增“磁盘不含原始 bearer token”和“哈希 store 跨 BFF 重启仍保持登录”。
- Tunnel watchdog 改为分层健康检查：本地 pi-web → 本地 BFF → 公网 API；只重启命令行为 `tunnel run pi-mobile` 的 cloudflared，不再全局杀进程；DEV standalone 挂掉可自愈，integrated/unknown owner 不会被误杀；连续两次公网失败（约 6 分钟）才重启。
- 当前 tunnel 故障属于外部链路：HTTP/2 实际 TLS handshake EOF，QUIC precheck 报 PASS 但真实 dial `no recent network activity`；本地 62809/62810 均健康。固定 http2 已改为 `protocol:auto` 以适应节点/代理变化，但当前节点下两种传输都不可用，代码重启无法根治。
