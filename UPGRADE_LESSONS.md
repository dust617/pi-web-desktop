# pi-web 升级检查清单 & 教训记录

> 每次升级 `resources/pi-web/` 锁定版本前，逐项检查。

## 升级前必做

### 1. CLI 兼容性
- [ ] 对比新旧 `bin/pi-web-options.js`：`--port` / `-H` / `--no-open` / env 变量是否一致
- [ ] 检查 `bin/pi-web.js` 启动逻辑有无变化（spawn 参数、stdio 配置）

### 2. API 路由兼容性
- [ ] `/api/cwd/validate` 是否仍存在（0.8.0 有，但返回 500 因 yaml 依赖问题 → 已做非致命处理）
- [ ] `?cwd=` URL 参数是否被前端识别（0.8.0 新增，外壳 `getProjectUrl` 已使用）
- [ ] 新增/删除的 API 路由是否影响 mobile bridge 的代理逻辑

### 3. Mobile Bridge 网络层适配 ⚠️ 容易遗漏！
- [ ] **bindHost**：MobileBridge 是否需要支持 `0.0.0.0` 绑定（LAN/IPv6 端口转发）
- [ ] **Origin 策略**：`isAllowedOrigin()` 是否需要新增 IPv6 字面量匹配
- [ ] **隧道信任**：SSH 隧道（localhost.run / serveo / cloudflared）转发的请求 remote address 是 loopback，是否已信任
- [ ] 运行 `npm run test:mobile` 全量测试

### 4. 前端静态资源
- [ ] favicon / 图标路径是否变化
- [ ] CSS 变量 / 主题色是否变化（影响状态栏图标可见性）
- [ ] 新增的前端功能是否需要外壳 preload 适配

### 5. 依赖变化
- [ ] `package.json` dependencies 有无新增/删除/大版本跳跃
- [ ] Pi SDK 版本（`@earendil-works/pi-*`）是否跳跃（0.80→0.81 等）
- [ ] `node_modules` 能否从旧版 copy + `npm install --prefer-offline` 快速补齐

## 升级执行流程

```
1. cp -r resources/pi-web .backup/pi-web-<OLD_VER>     # 备份
2. npm pack @agegr/pi-web@<NEW_VER>                     # 下载
3. tar -xzf → .backup/pi-web-<NEW_VER>-staged/          # 解压到暂存
4. cp -r .backup/pi-web-<OLD_VER>/node_modules → staged # 复用旧依赖
5. cd staged && npm install --prefer-offline             # 补齐差异
6. node bin/pi-web.js --port 39999 --no-open             # smoke test
7. curl http://127.0.0.1:39999/                          # HTTP 200?
8. 确认无运行实例锁 → swap staged → resources/pi-web
   若有锁 → 保持 staged，靠 main.ts 自动升级逻辑下次重启切换
```

## 已踩过的坑

### 坑 1：热替换导致 resources/pi-web 目录被清空
**场景**：运行中的 pi-web 进程锁住 `resources/pi-web/`，`rm -rf` 报 "Device or resource busy"，
但 `cp -r` 的中间步骤已经把旧文件删了 → 目录变空 → 运行实例崩溃。
**教训**：**永远不要对正在被进程使用的目录做 rm + cp**。用 `cp -r src/. dst/` 覆盖式拷贝，
或者走 staged + 重启切换策略。

### 坑 2：托盘图标在深色任务栏不可见
**场景**：`icon-32.png` 是深青 π 透明底 → 深色任务栏上对比度 ≈ 0。
**教训**：托盘图标必须用**高饱和度亮色背景**（红/橙/亮青）+ **白色前景**，
且用像素采样验证前景色确实是白的，不能靠肉眼赌。

### 坑 3：createTray() 被调用多次产生多个系统托盘图标
**场景**：启动时 createTray() 调了 2 次（初始 + MobileBridge 就绪后刷新配对码），
旧 Tray 实例从未 destroy → 任务栏出现 2 个 π。
**教训**：createTray() 开头必须 `if (tray) tray.destroy()`。

### 坑 4：Mobile Bridge 网络适配遗漏
**场景**：升级 0.8.0 后，mobile bridge 的 bindHost 硬编码 127.0.0.1、
Origin 策略不认 IPv6、不信任 loopback remote → 手机连不上。
**教训**：升级时必须检查 mobile bridge 的**网络拓扑假设**是否仍然成立，
特别是绑定地址、Origin 白名单、隧道场景。跑 `npm run test:mobile`。

### 坑 5：git-bash 的 msys pid ≠ Windows pid（进程生死判断全错）
**场景**：`tunnel-watchdog.sh` 等脚本用 `$$`/`$!` 写进 pid 文件的是 **msys 内部 pid**，
而 `tasklist` / `powershell Get-Process -Id` / WMI `ProcessId=` 用的是 **Windows 真实 pid**，
两套编号不一样。拿 msys pid 去 WMI 查必然 `ABSENT`，会被误判为“进程已死”，
实际上进程活得好好的（曾因此误清锁、造成双开 watchdog）。
**教训**：判断 msys 起的进程生死，**绝不用 pid 直查 WMI/tasklist**。要么用
`cat /proc/<msyspid>/winpid` 先翻译成 Windows pid 再查；要么**按命令行内容枚举**
（`Get-CimInstance Win32_Process | Where CommandLine -match ...`，见坑 6）。
健康时 watchdog 只写 status 不写日志，别用“日志停了”推断它死了。

### 坑 6：按命令行枚举进程时，查询命令本身会“自匹配”
**场景**：用 `Where-Object { $_.CommandLine -match 'tunnel-watchdog' }` 找 watchdog，
但执行这条查询的 shell / powershell 进程的命令行里**含有字面 `tunnel-watchdog`**
（比如 `grep tunnel-watchdog.log`、`-match 'tunnel-watchdog'` 本身），于是把自己也列进去，
甚至在一个 kill 循环里**把自己 kill 掉**（命令异常退出 exit -1）。
**教训**：把查询写进 `.ps1` 文件用 `powershell -File xxx.ps1` 执行，这样进程命令行是
`-File xxx.ps1`，不含匹配词；匹配模式也尽量精确（如 `tunnel-watchdog\.sh` 而非
`tunnel-watchdog`，排除 grep/cat 日志名的 shell）。**kill 循环绝不能匹配到自身**。
同 tunnel 的多个 cloudflared 是 Cloudflare 官方支持的高可用冗余，**无害**，
不必强行清理；watchdog 下次 restart 会自动归一。

## 移动端稳定性修复（2026-07-24，详记供回溯）
- **返回项目/会话列表「加载失败」闪屏**：根因 = showProjects/showSessions 的 5s silent 后台轮询(listPoll)失败时，catch 把当前正常列表 content.innerHTML 覆盖成错误页；输出时 pi-web /api/sessions 与写当前 session 文件竞争 + 移动弱网并发，使 silent 刷新更易 5xx/超时 → 用户返回后列表好好的、几秒后被换成红字。修复：silent 失败**保留列表**（只 setStatus err，不覆盖 content）+ 非 silent 首次失败加「重试」按钮；goBack 先 viewLoadId++ 并 streamingMsg=null、isRunning=false，让 in-flight 的 chat history/state/models 请求与残留渲染立即闭嘴；handleSSEEvent 开头加 currentView 非 chat 即 return 的总闸；closeSSE cancel 残留 streamRenderFrame。后端 mobile-bridge 给 handleProjects/handleProjectSessions 加 piWebFetchRetry（仅 5xx/网络错重试 1 次，不重试 4xx/BRIDGE_STARTING）。
- **补充（用户精确文案「加载历史失败」，纠正上条）**：showChat 的 history 请求 catch 原本**无离开守卫**——in-flight history 在用户点返回后才失败时，会把「加载历史失败」错误页写到用户已返回的列表上；输出时 deferThinking history 读与 live session 写竞争更易 5xx/超时，故「返回 + 正在输出」时最易触发。修复：history catch 加 loadId/currentView/sessionId 守卫（离开 chat 即不写）+ 真留在 chat 且失败时加「重试」按钮；handleHistory 也改用 piWebFetchRetry。注：上一轮我修的是列表轮询的「加载失败」闪屏，漏了这个 history catch，本轮按精确文案补上。
- **切换会话慢（性能，非网络）**：根因 = handleHistory 把 pi-web 的 messages 原样整包转发，前端 renderMessage 的 slice 只是渲染截断，传输+手机 JSON.parse 仍是全文（toolResult 嵌整文件读/bash 输出、thinking 全文）→ 移动弱网传+解析几 MB 即卡。修复两层：①BFF 新增 slimMessages 在转发前深拷贝裁剪（thinking→200字、toolCall args→300字、toolResult→800字，保留 content 数组结构，前端渲染/extractText 不受影响；user 文本不裁；SSE 实时流不经此路径故实时思考/工具输出仍完整；桌面走 pi-web 直连不经 BFF 故不变）；②前端 showChat 把 state/models 在 history await 之前 fire（stateP/modelsP .catch(null)），三者网络并行，关键路径从 history+max(state,models) 降为 max(三者)；401 仍跳登录因 api() 先 showLogin 再 throw。另：滚动条换移动端友好——.content 加 overscroll-behavior-y:contain+touch-action:pan-y（跟手不穿透），thumb 改 8px 高对比半透明白+滑动/触摸高亮(accent)+transition 微交互，桌面 pointer:fine 下 6px 细条；旧 4px border 色在深底上几乎不可见且太细难拖。注：安卓 Chrome 用 overlay 滚动条，**静止时隐藏、滑动才淡入**，故用户“看不到滚动条”多为正常 UA 行为，非 CSS 未生效；不再为此死磕。
- **进会话停在中间段（auto-scroll 竞态）**：根因 = scrollToBottom 单 rAF 与长会话首屏 layout settle 竞态，scrollHeight 读到偏小值，随后 onContentScroll 的 isNearBottom 被一次抖动误判为 false→stickToBottom 翻 false→后续既不贴底、流式也不跟，用户被晾在中间。三层修复：①scrollGraceUntil=now+800ms 进会话宽限窗，窗内 onContentScroll 强制 stickToBottom=true 忽略误判；②ResizeObserver 观察 #chatMessages，stickToBottom 或宽限窗内任何尺寸增长都重贴底（同时根治流式/异步撞高没跟；observe 初次触发也补一次贴底）；③scrollToBottom(force) 改双 rAF+setTimeout(160) 兜底。closeSSE disconnect observer 防泄漏。
- **顶置「最后提问」锚点**：content 顶部 sticky #ctxAnchor，毛玻璃+阴影+ctxIn 淡入，显示最后一条 user 消息(extractText 截断 80 字)；refreshLastUserQuestion 在 renderMessages 后重算，updateContextAnchor 按 !stickToBottom 显隐（上翻历史时出现、贴底看最新时隐去，不挡视线）。解决翻记录时记不住当前在聊什么。
- **安卓滚动条"滑到中间反复滑都看不到"真因(纠正上上轮"overlay 静止隐藏"的误判)**:上上轮把 thumb 高亮绑在 :hover/:active,触屏无 hover、:active 需手指直接按 8px thumb(用户在内容区滑从不按它)→ thumb 永停 30% 透明灰,叠加深底+overlay 闪现→肉眼不可见;且原生 overlay 不可拖,无法翻页。修复:彻底换**自定义 DOM 滚动条**(.scroll-rail fixed 右侧 + .scroll-thumb),不依赖 UA 渲染→安卓/桌面保证可见;默认 thumb 0.58 白+暗描边(出现即清晰);滑动/内容变化时 .show 淡入、停 900ms 淡出;thumb 可 pointer 拖拽(setPointerCapture)定位、rail 可点击跳页;MutationObserver(childList+subtree+characterData, rAF 节流)跟内容/流式 token 同步、ResizeObserver 跟容器/键盘同步;隐藏 content 原生条(scrollbar-width:none + ::-webkit-scrollbar display:none)免双条。锚点放大至约两倍体量(font 12.5→15.5、padding 加厚、weight 600、两行 line-clamp:2、截断 80→140、右 margin 14 让开 rail）。二次微调（用户反馈上一版偏大）：字号 15.5→13.5、行高 1.35、padding 8/12、radius 10、shadow 收；margin 改 `0 18px 8px 12px`——左 12 与消息列左缘对齐成一条竖基准线，右 18 给自定义滚动条 rail(占右~15px)让出 3px 干净缝不压条（12/18 不对称是 rail 占位而非错位）。保留两行 line-clamp。三次微调：锚点改 3 行 line-clamp、font-weight 400(不加粗)、font 12.5、line-height 1.4、padding 10/13、radius 11——“条大字小”的刻意对比，三行内容撑高度而非空 padding；截断 140→200 填满三行。滚动条拇指再加粗至 3 倍：7→21px、min-height 44→56、radius 11，drag/active 24px 变蓝；rail width 12→26 容纳胖拇指+扩大点击跳页区；anchor 右 margin 18→26 重让加粗 rail 的缝。桌面 pointer:fine 下自定义 rail 收回细条(rail14/thumb9/drag11)，胖拇指仅触屏。
- **锚点串数据 bug（显示其他会话的最后一句）**：根因 = lastUserQuestion 是全局变量，切换会话时未清也未绑会话；showChat 重设 content.innerHTML 使内容高度骤变→浏览器钳 scrollTop 到 0 而 fire 一次 scroll→onContentScroll→updateContextAnchor 见 currentView==chat 且 lastUserQuestion 非空(残留上一会话)→把上一会话提问画到新会话顶部（长切短几乎必触发→“经常串”）。双保险修复：①showChat/goBack 开头 lastUserQuestion=lastUserQuestionOwner="" 立即清残留；②新增 lastUserQuestionOwner，refreshLastUserQuestion 末尾 =currentSessionId，updateContextAnchor 加 owner!==currentSessionId 即 hide——任何时序残留只要会话对不上绝不显示。
- **移动端“自动刷新/断了又重新进去/不稳定”根因（已修）**：整页唯一 reload 点在 init 的 SW message handler——SW 激活后广播 sw-version，页面见 version!==PWA_VERSION 即 window.location.reload()。开发期连 bump v11→v19(8 次)，SW 为 network-first+no-store，每次切回 PWA/每 5min 的 reg.update() 拉到新 SW→新 SW skipWaiting+claim+广播→旧页 reload→内存会话状态全丢→init 重走 api(/projects)→cookie 在→掉回项目列表而非当前会话=“断了重进”；且 reload 不管是否正看流式→正看字也被踢=“不稳定”。修复（最不打断）：①页面 handler 删 reload+sessionStorage 防抖，改 console.info 仅记录；②sw.js activate 删 matchAll+postMessage 广播（保留 skipWaiting+claim+清旧缓存+get-version 应答）。关键：删广播后，已开的旧页**连“最后一次” reload 都不会发生**（旧页 init 的 get-version 在加载时已对旧 SW 发过、不 mismatch，之后不再问；新 SW 又不主动广播）→旧页安静跑到下次划掉重开；重开后 network-first shell 拿新版，从此永不自动 reload。代价：更新延迟到下次冷启动（可接受，shell no-store 保证重开必新版，无需清缓存）。
- **【已修，待验收】移动端流式“蓝点闪但不出字” + 历史显示太满（PWA v21）**：
  · 现象A 流式修复：①无可见内容时显示“正在思考”脉冲指示器（不再只剩蓝点）；②thinking 块显示尾部 300 字（新字顶旧字，让用户看到“在动”）；③deferred/redacted thinking 显示“深度思考中”占位；④toolCall 兼容 `name`/`toolName` 双字段；⑤加 `?debug=1` URL 参数或 `localStorage.setItem('piDebug','1')` 可开启流式事件日志，便于后续诊断。
  · 现象B 历史折叠：①toolResult 默认折叠为一行摘要（✅/❌ + 工具名 + 首行预览，点击展开）；②thinking 默认折叠（💭 + 字数徽章，点击展开）；③toolCall 参数默认折叠（工具名 + 参数预览，点击展开）。小屏上 user/assistant 正文占主体，工具/思考过程不再满屏。
  · 澄清 slim 与“字变少”：slim 把 history 传输裁到 thinking200/toolResult800，前端 renderMessage 的 slice 上限(500/1000)虽大但源已短，故历史显示可能从“满1000/500”变“满800/200”→看起来字略少，这是传输瘦身副作用，**非吞字/吟唱**，且不影响流式。修现象A 时勿把流式 bug 归咎于 slim。
- **废弃隧道彻底拆除（2026-07-25）**：用户确认手机走 frpc(`pi:8443`)，要求废弃路线全删。取证: mobile 域名 0 真实登录流量+530、lhr 临时域名 503 且 BFF 日志 lhr 登录为历史残留→两条均废。拆 Cloudflare: stop-cloudflare.ps1 停 cloudflared+nohup 父+tunnel-watchdog，删 start-tunnel.bat/tunnel-auto-setup*.sh/ns-watchdog.sh/tunnel-watchdog.sh/resources/cloudflared 二进制+各 log/status/pid；保留 ~/.cloudflared 凭证。拆 lhr: 停 localhost.run 的 ssh+lhr-loop，删 lhr-tunnel-loop.sh/.lhr-*/tunnel-lhr.log；保留 mobile/vps-relay(frpc 的家)。终态 frpc 唯一(count=1,200)、cloudflared=0、lhr=0。
  · 坑7 进程拆除自匹配: powershell 全进程 CommandLine 匹配 `localhost.run`/`lhr-tunnel-loop` 时，若**同一条 bash 命令**的 echo/rm/for 含这些完整字面量，则承载命令的 bash 自身 CommandLine 被匹配→Stop-Process 杀掉自己→命令中断 exit -1、后续 rm/核查不执行。解法: 匹配串与危险文件名都用**运行时拼接变量**(powershell 内 `'localhost'+'\.run'`、bash 内 `L1='lhr-tunnel';L2='-loop';rm "${L1}${L2}.sh"`)，使命令字面量不含完整匹配串；或把“匹配杀进程”与“rm/echo 含字面量”拆成不同命令。frpc/cloudflared 按 Name 匹配不受此影响(bash Name≠frpc.exe/cloudflared.exe)。
  · 坑8 别替用户赌“手机在用哪条”: BFF 日志同源 POST 登录 origin 可能为 `-`(不少浏览器同源不发 Origin)，故 `origin=-` 的登录=用户从 frpc 域名登录过；带 `origin=lhr` =从 lhr 页面登录过。判“手机现用哪条”不能只看 origin 计数，要结合: 各域名当前 curl 通不通 + 用户自报 + 进程是否近期有流量。lhr 现 503=事实上已废，停它不伤“能用的” frpc。
- **缩放变形**：撤掉前几轮误加的 JS CSS-zoom 双向补偿——它在 iOS 无效、在 desktop 会抵消用户主动 Ctrl+wheel 放大、且可能与 dvh/visualViewport 计算打架**反致变形**。改为纯声明式：viewport maximum-scale=2.5,user-scalable=yes + CSS text-size-adjust:100%。原生 pinch 下限 1x（不会无限缩小）且原生缩放不变形；Android 锁 2.5；iOS 锁不住但不变形（Apple 硬限制，无解且无害）。
- **SSE 掉线恢复**：BFF 心跳改发可解析 ping data 事件（旧的心跳是 SSE 注释帧，会被 EventSource 静默丢弃，前端无法用作活信号 → 移动 NAT 半开僵死检测不到）；前端 onerror 处理 readyState===CLOSED 指数退避自重连 + visibilitychange/online 唤醒 + 45s 活动超时检测半开；BFF upstream SSE 加 20s header-phase 超时（pi-web 卡死时不无限挂连接）。
- **生效边界**：前端改动 = PWA pi-mobile-v21，手机在线 SW network-first 自动更新（下次冷启动生效）；BFF 侧(ping/超时/重试)需**带 env 重启 standalone-bff**；桌面外壳修复需**托盘→退出重开**。
