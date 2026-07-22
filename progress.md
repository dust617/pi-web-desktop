# progress.md

## 2026-07-22 阶段3 打包完成
- electron-builder 26.15.3 打包成功。
- NSIS 安装版：`release/Pi-Web-Desktop-0.1.0-x64.exe` (291MB)
- 便携版：`release/Pi-Web-Desktop-0.1.0-portable.exe` (290MB)
- 包含：Electron 37 + 锁定 pi-web (885MB) + MobileBridge BFF + PWA 壳 + cloudflared
- 未签名（自用足够）。
- 阶段 0-3 全部完成。

## 2026-07-22 隧道自动配置
- 域名 `tt56677.top` NS 已提交 Cloudflare，等待传播。
- `tunnel-auto-setup-v2.sh` 后台轮询 NS（每2分钟，最多6小时）。
- NS 传播后自动：cloudflared login → create tunnel → route DNS → 启动隧道。
- 唯一人工步骤：NS 传播后浏览器弹出授权页面需点 Authorize。
- `start-tunnel.bat` 已写好，以后双击即可启动隧道。

## 2026-07-22 MobileBridge BFF + PWA 壳
- 新建 `src/mobile-bridge.ts`：loopback-only HTTP BFF，12个API端点 + 静态文件服务 + Cookie鉴权 + SSE代理 + 8MiB历史硬限 + 字段过滤。
- 新建 `resources/mobile/index.html`：单文件 PWA SPA，登录/项目列表/会话列表/聊天视图/SSE流式/模型切换/中止。
- 新建 `resources/mobile/manifest.json` + `sw.js`：PWA manifest + 最小 Service Worker（仅缓存壳）。
- 修改 `src/main.ts`：集成 MobileBridge 生命周期（启动/停止/托盘配对码显示/复制）。
- TypeScript 编译零错误。
- 集成自测 40/40 通过：health、静态文件、鉴权、配对码、登录/登出、项目列表、会话列表、历史、状态、模型、缓存头。
- 域名 `tt56677.top` 已购买（Namesilo），Cloudflare NS 已配置，等待传播。

## 2026-07-22 资源管理器右键切换项目排查
- 已确认右键注册命令能把目标目录传给第二 Electron 进程。
- 已定位第二实例 argv 重排、双消费者、旧 URL 刷新、runtime 退出竞态及会话 cwd/全局 cwd 错位。
- 当前未重启 Electron，避免中断正在进行的交互会话。
- 已实现：additionalData 单实例传递、原子 pending 备用信号、请求 ID 去重与串行队列、目标 cwd 空会话创建并导航到 `?session=`、动态 origin 校验、runtime 启动/退出竞态修复。
- 当前未重启 Electron，避免中断正在进行的交互会话。
- TypeScript 编译已通过。
- 独立 runtime/API 冒烟首次失败：目标为 `.test/右键项目测试`，新会话元数据 cwd 却是 `resources/pi-web`；测试已正常清理独立服务。
- 已确认空会话在首条助手消息前不会落盘，`?session=` 预创建方案不可用，已撤回该实现。
- 已改为 pi-web 原生新会话状态：桌面端导航 `/?cwd=<目标>`；客户端和 SSR bundle 从 cwd 查询参数初始化 newSessionCwd，并阻止历史会话自动覆盖。
- 重新编译、客户端/SSR bundle 语法检查均已通过。
- 隐藏 Electron 冒烟第 1 次因继承 `ELECTRON_RUN_AS_NODE` 而以 Node 模式启动失败；临时服务已清理。
- 第 2 次页面正文已正确显示目标中文路径，但测试因额外要求 document.title 同步变化而判失败；标题不是 cwd 正确性的必要条件。
- 第 3 次以目标目录标记文件验证通过：页面同时显示中文 cwd 和 `当前项目标记.txt`。
- 最终审查项已修：runtime 启动 generation/错误与提前退出竞速、每请求独立 fallback spool、IPC/弹窗精确 origin。
- 最终 TypeScript/bundle 检查通过；注册表命令最终输出验证为 `@="\"D:\\\\...electron.exe\" ... --project \"%1\""`。
- 独立启动取消→立即重启测试通过，旧进程退出未覆盖新 runtime 状态。
- 当前任务代码完成；未强杀正在承载本会话的 Electron，真实 Explorer 右键验收需用户重启桌面端后执行。

## 2026-07-21 22:55
- 当前阶段：2 完成
- 本次完成：
  - 阶段0：Electron骨架、锁定pi-web、node.exe启动、HTTP 2xx、taskkill进程树、端口释放
  - 阶段1：托盘图标（最小化/重启/退出）、窗口状态记忆、增强菜单、启动失败详情对话框
  - 阶段2：外部附件面板（preload注入）、webUtils.getPathForFile、附件列表UI、失效标红、资源管理器、check-file-exists IPC
  - chunk JS语法修复（literal LF → \n转义）
  - tsconfig加DOM lib
  - 冒烟测试全部通过（3轮）
- 冒烟测试：通过
- 下一步：阶段3 - electron-builder打包（NSIS安装版+便携版），明天执行
- 状态：阶段2完成，今晚停止（打包不在今晚范围）

## 2026-07-21 22:40
- 当前阶段：0
- 本次完成：Electron骨架、resources/pi-web锁定副本、useDragDrop补丁、chunk语法修复、node.exe启动、taskkill、webUtils拖拽、IPC校验、https外链
- 冒烟测试：通过（第1轮）
- 状态：阶段0完成

## 2026-07-21 15:30（计划定稿）
- 当前阶段：0（未开始）
- 本次完成：计划全面修订，确认内置锁定 pi-web 方案，同步所有连续性文档
- 状态：等待定时任务执行

## 2026-07-22 域名修正 + 全链路本地打通
- 域名实为 `tt56677.top`（非 tt58677），已全局修正 src/脚本/文档。
- Namesilo NS 已改 cloudflare；邮箱已验证（解除 suspended 风险）；错 zone tt58677 已删。
- cloudflared 重新 login 绑定新 zone（旧 cert.pem 权限绑死旧 zone 导致 route auth error）。
- Tunnel `pi-mobile` (5a18d771...) 运行中，4 条 QUIC 连接；CNAME `mobile.tt56677.top` 已写 zone。
- 独立 BFF：`standalone-bff.mjs` 以 duck-type runtime 挂到已存在的 62809，监听 62810，
  不新起 runtime、不打断当前 Electron 会话。health ok，鉴权生效，静态壳 200。
- 当前配对码：**102835**（BFF 重启会变，见 bff-pairing-code.txt）。
- 本地全链路绿：手机→cloudflare→tunnel→62810 BFF→62809 pi-web。
- 唯一阻塞：`.top` 注册局 NS 委派仍 dnsowl（Namesilo→注册局延迟），watchdog v3 自动收尾。

## 2026-07-22 交接文档
- 已写自包含交接文档 `STATUS_HANDOFF.md`，含：关键标识表、架构链路、各组件状态(带判定依据)、
  唯一阻塞(注册局 NS 委派)、watchdog v3 自动收尾逻辑、踩坑清单、文件清单、自查命令、给检查者核查清单、实时快照。
- 重点提醒检查者：Git Bash 下 `ps grep` 对 nohup 进程匹配不到≠进程死，以端口监听+status 增长为准。
- 当前配对码 102835；NS 仍 dnsowl，等传播，watchdog 自动收尾。

## 2026-07-22 移动端进度与质量检查

- 完成源码、PWA、打包、运行进程、DNS/Tunnel、Git 状态和连续性文档审查。
- 验证通过：`npm run build`；Gate 0B fixture 27/27；PWA inline JS 语法；当前本地 BFF 只读契约 13 项；发布包包含当前 mobile 文件。
- 当前本地链路可读：62809 pi-web、62810 standalone BFF 均监听；项目/会话/历史/状态/模型 DTO 可读取且 state 未泄露 systemPrompt/sessionFile。
- 当前公网链路未交付：域名权威 NS 仍为 dnsowl，手机入口 NXDOMAIN，未做真机与耐久性验收。
- 确认阻塞问题：公开 pairing-code 路由、集成版公网 POST 403、项目卡片 onclick 属性破坏、超限请求 socket reset。
- 确认工程问题：宣称的 40/40 脚本不在仓库；多套重复 watchdog/setup 正运行；移动端实现尚未提交。
- 本次仅检查和更新连续性文档，未停止现有 pi-web/BFF/cloudflared/watchdog，未发送 prompt、切模型或中止会话。
- 已整理可直接转发给后续开发者/修复 Agent 的自包含报告：`MOBILE_AUDIT_REPORT.md`，包含进度、证据、问题分级、修复建议、测试矩阵和验收标准。

## 2026-07-22 审计修复 + 公网打通
- 修复 MOBILE_AUDIT_REPORT.md 全部 P0/P1/P2（详见 STATUS_HANDOFF.md）。
- 回归测试 mobile/tests/bff.test.mjs：24/24 通过。
- NS 传播生效，公网 https://mobile.tt56677.top/mobile/ 返回 200，安全修复公网验证通过。
- cloudflared 固定 http2 协议；公网访问依赖代理 TUN 开启（本机直连 Cloudflare TLS 被干扰）。
- 本地提交 a991804（未 push）。
