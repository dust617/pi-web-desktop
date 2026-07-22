# 移动端规划复审发现

## 已确认的本地事实
- pi-web 锁定版本：`@agegr/pi-web@0.7.16`，由桌面端启动于 `127.0.0.1:<动态端口>`。
- 可复用接口包括 sessions、agent prompt/abort/set_model、models 和 SSE events。
- 会话详情无服务端分页；可用 `deferThinking=1&deferMedia=1` 减载，客户端渐进渲染历史。
- 桌面端运行时内存中已知 pi-web 动态端口；互通桥合并后不需要端口文件。
- 用户无 VPS、有免费域名、优先免费；安卓已有 VPN/TUN 代理，Tailscale 会抢占 VPN 槽。

## 既有网络探测
- `https://www.baidu.com`：200，约 0.25s。
- Google：SSL/TLS 失败。
- `https://api.cloudflare.com/client/v4/ips`：200，约 0.8s。
- `https://www.cloudflare.com`：200，约 2.4s。
- `argotunnel.com`：DNS 失败；注意该裸域不一定等同 cloudflared 当前实际隧道端点，不能单凭此项判定 Cloudflare Tunnel 不可用。

## 2026-07-22 联网研究（第一轮）

### Cloudflare 官方事实
- Cloudflare 官方明确：Quick Tunnel 仅用于测试/开发，生成随机 `*.trycloudflare.com`，进程重启地址会变；生产/长期使用应使用 remotely-managed / named tunnel。
- Named Tunnel 可把自己控制的固定 hostname 映射到本地服务；Cloudflare 官方 FAQ 明确支持 WebSocket。SSE 属普通 HTTP 流式响应，技术上可透传，但仍需真实链路稳定测试。
- cloudflared 隧道连接使用 `region1/region2.v2.argotunnel.com` 等实际端点的 7844 端口，QUIC 用 UDP、HTTP/2 用 TCP。此前只探测裸域 `argotunnel.com` 并据此否定 Tunnel，证据不足。
- Cloudflare 524 文档给出默认 Proxy Read Timeout（官方页面当前显示 120 秒）；SSE 需要尽快返回响应并持续有数据/心跳。计划中应让桥为 SSE 注入 15–30 秒注释心跳并禁用缓存/缓冲。
- 搜索未找到 cloudflared 隧道传输原生支持 `HTTP_PROXY/HTTPS_PROXY` 的官方证据；官方要求直连 7844 TCP/UDP。电脑代理若为系统 HTTP 代理，不能假定 cloudflared 会走它；若为 TUN/透明代理并接管相关目标/端口，可能有效，必须实测。可强制 `--protocol http2` 作为 QUIC 失败时的回退。

### PWA / SSE 平台约束
- Service Worker / 完整 PWA 安装要求安全上下文（公网通常必须 HTTPS）；固定域名 + 自动 HTTPS 因而是核心条件，不是可选美化。
- 浏览器原生 `EventSource` 构造器只有 URL 和 `withCredentials`，不能添加任意 Authorization Header。现计划“每请求共享 token Header”与 EventSource 冲突。
- 推荐鉴权：PWA 与 API 同源；首次输入共享 token，经 `POST /mobile/auth` 换取 `HttpOnly; Secure; SameSite=Strict` Cookie。后续普通 fetch 与 EventSource 自动携带 Cookie。不要把长期 token 放 URL 或 localStorage。
- 备选是用 `fetch()` + ReadableStream 手工解析 SSE 并加 Header，但重连、事件解析和兼容性代码更多，不符合简单稳定优先。

### 初步架构纠偏
- Cloudflare Named Tunnel 应从“不采用”调整为“**免费首选候选，但必须先做真实链路门禁测试**”；不能仅凭裸域 DNS 失败否定。
- 若用户的免费域名只是第三方免费子域名、不能把 NS/DNS zone 托管到 Cloudflare，则可能无法用于 Named Tunnel 固定 hostname；需要核实域名控制能力。
- 免费国内穿透若没有固定 HTTPS hostname，只能作测试/降级，不满足稳定 PWA 的长期入口。

## 2026-07-22 联网研究（第二轮）

### Cloudflare Named Tunnel
- Cloudflare 官方 Setup 文档：Tunnel 在所有计划可用；发布 public application 需要 Cloudflare 账号和“位于 Cloudflare 上的域名”。Free/Pro 常规方式是 Full Setup，即把域名 NS 交给 Cloudflare。
- `cfargotunnel.com` 目标只会代理同一 Cloudflare 账户内的 DNS 记录。因此用户所谓“免费域名”只有在能作为独立 zone/委派 NS 到 Cloudflare 时，才可直接用于 Named Tunnel；仅能修改普通子域 CNAME 不一定满足。
- 因此需先核实免费域名类型和 DNS/NS 控制能力。

### 国内成熟服务免费层
- cpolar 官方价格页：免费版 1Mbps、随机 URL、HTTP/TCP；固定二级域名约 99 元/年，自定义域名与端到端 HTTPS约 149 元/年。
- NATAPP 官方页：免费隧道随机域名/端口，且会不定时强制更换；固定域名与 HTTPS约 9 元/月起。
- 结论：cpolar/NATAPP 免费层适合临时验证，不适合作为长期固定 PWA 入口。

### SakuraFrp（当前最匹配免费候选）
- 官方文档称所有用户可免费申请固定 `nyat.app` 子域名和 SSL，绑定可随隧道迁移更新，手机端可获得固定 HTTPS origin。
- 官方 frpc 手册明确 `--proxy` 支持 system、HTTP 或 SOCKS5 代理，正面满足“通过现有代理改善连接”的需求。
- 官网显示每月有基础免费流量（页面呈现 `5 + 158 GiB`，其中签到可增流量）；纯文本/API/SSE通常远低于 5 GiB/月。
- 国内居民需 KYC；官方 FAQ说明实名认证第三方成本约 1 元。海外 HTTP(S) 节点需实名认证；中国大陆建站节点还要求 ICP 备案。用户免费域名若未备案，应优先选海外/港澳台节点或按官方允许方式用 HTTPS/TCP映射。
- 官方明确免费节点可能长期过载且不保障扩容，所以必须做实际节点延迟、断线、SSE长连测试；不能承诺 SLA。

### 零隧道备选：Telegram Bot
- Telegram Bot API 官方支持 `getUpdates` 长轮询（电脑仅向外连接）、inline keyboard 和 `editMessageText`。
- 可做项目/会话分页按钮、发送消息、中止、模型按钮，并用定时编辑消息模拟流式输出；无需 VPS、域名、入站端口或额外安卓 VPN，电脑/手机均可使用现有代理。
- 缺点：不是独立 App/PWA，长历史与富文本体验较差，输出受 Bot API消息长度/频率限制。适合作为“免费稳定沟通优先”的 Plan B，而非默认 UI。

### 新发现的现有计划问题
- PWA 直接调用 pi-web 未版本化内部 API，不能真实保证“主体升级少影响”。应新增桌面端稳定的 `/mobile/api/v1/*` 适配层，PWA只依赖该契约；上游升级只改一处 adapter 并跑契约测试。
- 现计划写“手机选项目目录新建会话”不可行：手机文件选择器无法浏览电脑文件系统。应改为只能在已知项目卡片下“新建会话”（复用该项目 cwd），首版不允许任意路径。
- Tunnel 场景下互通桥应仅绑定 `127.0.0.1:<固定端口>`；frpc/cloudflared 在同机向该端口转发。无需监听 `0.0.0.0` 或网卡地址，暴露面更小。
- 移动端远程功能必须为桌面端可选模块；桥/隧道启动失败不得阻塞 pi-web 和桌面窗口。

## 2026-07-22 用户免费域名核实
- 用户提供的平台是 `dash.domain.digitalplat.org`，即 DigitalPlat FreeDomain。
- DigitalPlat 官网与开源项目说明明确支持把所注册的免费 public name 连接到外部 nameservers / DNS provider，并点名 Cloudflare；因此域名权限原则上满足 Cloudflare Full Setup / Named Tunnel 的要求。
- Dashboard 未登录直连返回 Cloudflare challenge 403，属登录/防机器人页面，未尝试绕过，也不需要用户提供账号密码。
- 仍需在 Gate 0 确认用户实际域名后缀可被 Cloudflare 当前 Public Suffix List / zone onboarding 接受、NS能生效、Universal SSL能签发。DigitalPlat 免费域名的续期规则也需按账户页面确认。
- 基于“完全免费优先 + 域名可外部NS”，候选顺序调整为：**Cloudflare Named Tunnel 首测 → SakuraFrp 次测 → Telegram Bot/低成本国内入口**。

## 待实测
- Cloudflare Named Tunnel：DigitalPlat实际域名 onboarding、NS、固定hostname、Universal SSL；direct/QUIC、强制HTTP2、同机TUN代理；2小时+过夜SSE。
- SakuraFrp（Cloudflare失败时）：账户/KYC、固定 nyat.app + SSL、2–3个免费节点和代理路径。
- 确认电脑端代理类型；只有TUN/透明代理可能接管cloudflared 7844，普通系统HTTP代理不能假定有效。

## 2026-07-22 Gate 0B 通宵执行发现

### pi-web API 关键事实（source-confirmed + live-read-only-observed）
- pi-web 0.7.16 运行在 127.0.0.1:62809（PID 10832，Next.js start）。
- `GET /api/sessions` 返回 `{sessions, runningSessionIds}`；session 列表 `messageCount` 是总条目数，**不是** context messages 数量。
- `GET /api/sessions/{id}?deferThinking=1&deferMedia=1` 返回压缩后 context；实测最大 512KB（168条 context messages）。
- `GET /api/sessions/{id}/state` 返回 `{running, state}`；`state` 含 `model`, `thinkingLevel`, `contextUsage`, `isStreaming`, `isPromptRunning`；**还含 `systemPrompt`（完整系统提示）和 `sessionFile`（绝对路径），BFF 必须过滤**。
- `GET /api/models?cwd=` 有 60秒服务端内存缓存；切换模型后列表可能短暂显示旧值。
- SSE 心跳间隔 30秒（上游）；无 `Last-Event-ID` replay；首条事件 `{type:"connected",sessionId}`。
- `POST /api/agent/{id}` 在 agent 未运行时会**自动启动** agent 再发送；移动端 BFF 需注意此行为。
- `POST /api/agent/new` 的 `cwd` 必须是已存在目录；`type:"ensure_session"` 只创建不发消息。
- session 文件（~/.pi/agent/sessions/）最大 9.3MB，p95 1.9MB；但 API 响应远小于文件大小（compaction）。
- 8MiB 历史上限对当前数据是安全的；需监控 context window 满载时的极端情况。

### 延期验证项
- `message_update` 是 delta 还是全量：unverified-mutation。
- `set_model` 运行中行为：unverified-mutation。
- `get_state` 完整字段已 live 观察，但 `state` 对象中可能还有其他字段未记录。
- 详见 `mobile/gate0b/deferred-live-tests.md`。

## 2026-07-22 实际域名 `tt3721.qd.je` 检查
- 系统公共DNS查询 `NS/SOA/A/AAAA` 均返回 NXDOMAIN：当前尚未形成有效委派/解析。
- 直接获取 Public Suffix List 官方实时文件（版本 `2026-07-20_19-57-20_UTC`）：`qd.je` **未出现**；`dpdns.org` 与 `qzz.io` 已出现。
- `qd.je` 的 PSL提交在 publicsuffix/list 中仍有未生效/未合并记录。Cloudflare Free Full Setup通常会把未列入PSL的 `tt3721.qd.je` 视为 `qd.je` 下的子域，用户又不控制整个 `qd.je`，因此当前不能把它当作可靠可接入zone。
- 最小免费修正：在DigitalPlat另申请 `*.dpdns.org`（优先）或 `*.qzz.io`，再做Cloudflare onboarding实测。
- 若不更换后缀：Cloudflare Named路线降级，直接测试SakuraFrp免费固定 `nyat.app`；现有 `tt3721.qd.je` 可保留作其他用途。

## 关键官方来源（访问于 2026-07-22）
- Cloudflare Tunnel：`https://developers.cloudflare.com/tunnel/`
- Cloudflare Tunnel Setup：`https://developers.cloudflare.com/tunnel/setup/`
- Cloudflare Quick Tunnel限制：`https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/`
- Cloudflare Tunnel防火墙/7844：`https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/tunnel-with-firewall/`
- DigitalPlat FreeDomain：`https://domain.digitalplat.org/`、`https://github.com/DigitalPlatDev/FreeDomain`
- SakuraFrp子域与SSL：`https://doc.natfrp.com/bestpractice/domain-bind.html`
- SakuraFrp frpc代理：`https://doc.natfrp.com/frpc/manual.html`
- MDN EventSource：`https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource`

## 复审任务错误记录
- 一次 context-builder 子任务因配置声明了不可用的 `web_search` 而被运行时标为失败；其本地只读报告仍完整生成。联网事实由父任务和两个 researcher 独立核实，未重复同一失败调用。

> 外部搜索结果仅记录在本文件，视为不可信信息，最终以官方文档和本机实测为准。

## 2026-07-22 实现复核新增发现

- Tunnel 会把公网请求转发到 loopback BFF，因此“只绑定 127.0.0.1”不等于某个 HTTP 路由仅本机可见；`/mobile/auth/pairing-code` 必须删除或移出 HTTP 面。
- Electron 正式集成路径没有传入 `allowedOrigins`，与 standalone 路径不一致，造成公网页面读取成功但 mutation 被 Origin 检查拒绝。
- 项目卡片 inline handler 的 HTML 组合方式无效；应使用 DOM 事件监听和内存中的项目 ID，避免把路径拼入事件属性。
- body 超限处理应停止收集并排空请求，保持 socket 可写，再返回结构化 413；直接 `req.destroy()` 会让客户端只看到连接重置。
- Gate 0A 仍为硬门禁；本地 health 和 cloudflared edge 注册不代表公网 hostname 已可用。
