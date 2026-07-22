# Pi Web 移动端互通：权威项目计划

> **本文件是移动端子项目的唯一权威计划。** 桌面端权威计划仍为根目录 `PROJECT_PLAN.md`。
> 移动端规划、研究、进度和 PWA 资源均放在 `D:/PI-web-desktop/mobile/`。
> 状态：**规划复审定稿；下一步是 Gate 0，不先开发完整 UI。**

## 1. 目标与最终方案

### 目标

做一个自用的安卓 PWA：在外面能查看电脑上的项目与会话、最近历史和实时输出，并能发消息、中止、切换模型。

### 最终推荐架构

```text
Android Chrome / 安装到主屏幕的 PWA
  https://mobile.<DigitalPlat免费域名>/mobile/
  同源 fetch + EventSource（安全 Cookie）
                    │
                    ▼
Cloudflare Named Tunnel（首测；不是 Quick Tunnel）
  - 完全免费、固定域名、自动 HTTPS
  - 手机不安装额外 VPN
                    │
                    ▼
Windows 官方 cloudflared（MVP先手工运行）
                    │
                    ▼
127.0.0.1:<固定 bridgePort>
Electron MobileBridge（独立、可关闭的版本化 BFF）
  - PWA 静态资源与单用户登录
  - /mobile/api/v1/* 白名单 API
  - SSE适配、心跳、断线清理
  - 动态读取当前 pi-web 端口
                    │
                    ▼
127.0.0.1:<动态 piWebPort>
锁定版本 pi-web
```

### 为什么先测 Cloudflare Named Tunnel

- 用户免费域名来自 **DigitalPlat FreeDomain**；该平台官方支持外部NS/Cloudflare。
- 但用户现有 `tt3721.qd.je` 当前NXDOMAIN，且 `qd.je` 尚未进入官方实时Public Suffix List，不能把它视为可被Cloudflare Free接入的独立zone。
- 若在DigitalPlat另申请已进入PSL的 `*.dpdns.org`（优先）或 `*.qzz.io`，Named Tunnel即可继续作为完全免费首测；重启不换hostname并自动提供HTTPS。
- 手机只访问普通 HTTPS，不占安卓唯一 VPN 槽，与现有 VPN/TUN 代理不冲突。
- 固定 HTTPS 同时解决 PWA 安装、Service Worker、Secure Cookie 和 EventSource 鉴权。

### 必须诚实说明

- Cloudflare 免费全球网络不是中国大陆加速服务；大陆链路没有 SLA，必须真机实测。
- cloudflared 不可靠遵循普通系统 HTTP 代理。要改善电脑端连接，电脑代理需以 TUN/透明方式接管 TCP/UDP 7844；Gate 0 会用日志和实际链路验证。
- BFF 能把**手机侧协议变化集中到 adapter**，但不能保证 pi-web 无痛升级。每次候选升级仍需复核 pi-web API/SSE语义及桌面端现有 `?cwd=` 构建补丁。
- 家里电脑必须开机、联网且不休眠；首版不承诺息屏后台推送。

## 2. 远程入口排序

| 方案 | 成本 | 固定 HTTPS | 关键风险 | 决策 |
|---|---:|---|---|---|
| **Cloudflare Named Tunnel + DigitalPlat `dpdns.org/qzz.io`域名** | 完全免费 | 有 | 需另申请已进入PSL的后缀；大陆链路和电脑7844需实测 | **有合适后缀则首测** |
| **SakuraFrp + PWA** | 约1元一次实名，日常免费 | 免费固定 `nyat.app` + SSL | 免费节点可能拥塞，但frpc支持HTTP/SOCKS5/system代理 | **第二候选** |
| **Telegram Bot 长轮询** | 免费 | 不需要 | 不是独立App，历史/富文本体验较差 | **零隧道 Plan B** |
| NATAPP/cpolar 固定入口 | 约9元/月或99元/年起 | 有 | 需付费 | 最后降级 |
| cpolar/NATAPP免费层 | 免费 | 随机地址 | 地址变化 | 仅临时测试 |
| Cloudflare Quick Tunnel | 免费 | 随机 | 官方仅供测试且不支持SSE | 排除 |
| Tailscale/蒲公英VPN | 免费/低成本 | 私网 | 抢安卓唯一VPN槽 | 排除 |

**降级顺序：** 若用户申请 `dpdns.org/qzz.io` → Cloudflare Named首测；若只保留当前 `qd.je` → 直接SakuraFrp。之后失败再让用户在 Telegram Bot / 低成本固定入口之间选择。不把随机网址当长期主入口。

## 3. MVP 功能边界

### MVP 必须有

1. **项目/会话列表**
   - 按 `projectRoot/cwd` 分组。
   - 显示项目文件夹名、会话标题、末尾 `preview`、更新时间、运行中状态。
2. **会话页**
   - 显示最近一段有界历史。
   - SSE实时输出；连接/重连/离线状态清楚。
   - 发送消息；中止当前运行。
3. **模型按钮**
   - 显示当前模型；列出当前项目可用模型并切换。
   - 运行中默认禁切；切换后重新读取权威状态，不做永久乐观显示。

### MVP 后延期

- “加载更多/向上翻完整历史”、后端历史分页缓存和前端虚拟列表。
- 在已有项目下创建新会话、会话改名。
- 二维码配对、逐设备会话列表/逐设备吊销。
- Electron 自动启停 cloudflared/frpc、托盘完整移动端菜单、第三方二进制捆绑。
- Telegram Bot 实现（仅两条免费 PWA 入口均失败时重新决策）。

### 明确不做

- 手机浏览电脑文件系统、任意路径新建项目、附件上传、远程文件管理、shell/终端。
- 多用户/RBAC、后台推送、离线发送、消息必达。
- 任意透明代理 pi-web/localhost API。
- 无限历史或直接读取 `~/.pi/agent` 会话文件造分页。

## 4. MobileBridge 边界

### 模块和生命周期

- 独立模块（建议 `src/mobile-bridge.ts`）；`main.ts` 仅启停。
- 仅监听 `127.0.0.1:<固定可配置端口>`，不监听 `0.0.0.0`。
- 窗口隐藏不停止；Electron退出时关闭 server 和所有 SSE socket。
- bridge 跨 pi-web 重启保持存活；每个请求通过 getter 读取最新 `runtime.info`。
- bridge/隧道失败只让移动功能离线，**不得阻塞桌面启动或导致桌面崩溃**。
- connector 自动管理延期；以后实现时必须有 generation/cancellation，启动中退出或快速开关不得留下孤儿进程。

### 稳定 v1 API

```text
POST /mobile/auth/login
POST /mobile/auth/logout
POST /mobile/auth/revoke-all
GET  /mobile/api/v1/health
GET  /mobile/api/v1/projects
GET  /mobile/api/v1/projects/:projectId/sessions
GET  /mobile/api/v1/sessions/:sessionId/history
GET  /mobile/api/v1/sessions/:sessionId/state
GET  /mobile/api/v1/sessions/:sessionId/events
POST /mobile/api/v1/sessions/:sessionId/messages
POST /mobile/api/v1/sessions/:sessionId/abort
GET  /mobile/api/v1/sessions/:sessionId/models
POST /mobile/api/v1/sessions/:sessionId/model
```

- method、path/query、body大小、JSON shape和model id全部白名单验证。
- 统一错误：`{error:{code,message,retryable}}`。
- 不转发未知 upstream 路由、Cookie、CORS或hop-by-hop header。
- 所有 `/mobile/auth/*`、`/mobile/api/v1/*` 动态响应统一 `Cache-Control: no-store`；SSE用 `no-store, no-transform`；Cloudflare不得缓存移动API。
- 候选 pi-web 升级需跑adapter契约测试并复核桌面补丁；不通过不发布。

## 5. 鉴权与 PWA

### 单用户鉴权

原生 EventSource不能加自定义Authorization Header，因此不用Header token或URL token。

1. 桌面端生成高熵配对密钥/短时配对码。
2. 手机 `POST /mobile/auth/login` 后设置 host-only `__Host-` Cookie：`HttpOnly; Secure; SameSite=Strict; Path=/`。
3. fetch/EventSource自动带Cookie；写请求校验精确 `Origin`；登录限速、body限长。
4. MVP只提供退出和“吊销全部移动会话/重新生成密钥”，不做逐设备管理。
5. logout/revoke-all立即关闭对应已建立的SSE，不让旧连接继续收消息。
6. 日志不记录Cookie、配对码、消息正文或隧道Token。

### PWA

- 生产只使用同源相对 `/mobile/api/v1`，无任意API Base URL、无生产CORS。
- Service Worker只缓存版本化静态壳；绝不缓存auth/API/history/models/SSE/mutation。
- 首版安全纯文本/code block渲染，不用未消毒`innerHTML`；严格CSP；外链仅`http/https`。

## 6. SSE 与历史策略

### SSE：最终一致，不承诺断线期间逐token无损

- 立即flush headers并流式处理；15–30秒注释心跳；下游断开立即销毁上游请求。
- 上游当前没有可靠SSE replay cursor，不能声称 `Last-Event-ID` 无损回放。
- 断线时UI标记“恢复中”；重连后重新拉取权威session/state快照并替换临时流式显示。
- Gate 0B若证实存在稳定message/entry id，可用其去重；否则以快照最终一致为准，不承诺断线期间每个增量都保留。
- 发送消息/mutation不自动重试，避免重复prompt。

### MVP历史：最近有界窗口

- Gate 0B测量实际会话响应字节、解析耗时和内存后确定最终阈值。
- 初始建议上限：单历史响应原始数据 **8 MiB**、全局同时仅1个历史请求、同session single-flight；超限返回 `HISTORY_TOO_LARGE`。
- 有 `Content-Length` 时预检；缺失或不可信时流式计数，超过上限立即abort，不进入JSON解析/缓存。
- bridge只能保护自身；如果pi-web生成全量响应本身已不可控，则该会话拒绝移动历史并提示桌面查看。
- MVP只返回最近N条/安全大小，不做LRU/TTL分页系统。真实使用证明需要后，再单独规划“加载更多”。

## 7. 实施阶段与门禁

> 用户决定域名后续再处理。因此执行顺序临时调整为 **Gate 0B → Gate 0A → 阶段1**。两项Gate都必须通过，才进入完整PWA主体开发。

### Gate 0A：免费固定HTTPS与SSE链路（0.5–1天 + 过夜，暂缓）

**域名前置门禁：**
- 当前 `tt3721.qd.je` 因PSL未生效不进入Cloudflare首测。
- 用户若在DigitalPlat另申请 `*.dpdns.org`（优先）或 `*.qzz.io`，再进入下述Cloudflare Named测试；若不申请，则本Gate直接切SakuraFrp。

**Cloudflare Named测试：**
- 用户在自己的DigitalPlat/Cloudflare账户中改NS、创建Named Tunnel；不向助手提供密码/API Token/恢复码。
- 确认zone Active、固定 `mobile.<domain>`、Universal SSL有效。
- 官方portable `cloudflared`手工运行，映射最小health+SSE测试服务。
- 测 direct/auto、强制QUIC、强制HTTP2、电脑同机TUN。普通系统HTTP代理不假定有效。

**初始门禁指标：**
- hostname在进程/电脑重启后不变；证书有效；手机VPN/TUN保持开启可访问。
- 100次小API请求HTTP错误率 <1%，p95 <5秒。
- 活跃SSE消息端到端p95 <3秒；2小时意外重连≤3次，单次不可用不超过30秒。
- Wi-Fi↔蜂窝切换后15秒内恢复；过夜无不可恢复断线。

若失败：测试SakuraFrp免费固定HTTPS和2–3个节点/代理路径。两者均失败则停止PWA主体。

### Gate 0B：pi-web协议和容量画像（1–1.5天）

- 实测sessions/history/state/models/prompt/abort/set_model/SSE的2xx/4xx/运行中冲突。
- 保存脱敏fixture和最小schema；确认agent/session id、当前模型读取方式、模型作用域及稳定entry/message id。
- 测最大实际会话的响应、解析和RSS增量，确认/调整8MiB历史上限。

**通过标准：**所有MVP功能有已观察状态转换；关键schema可验证；历史请求不会超过设定预算。假设不成立立即缩范围。

### 阶段1：Bridge内核 + Auth + PWA壳（约2天）

- loopback controller、动态runtime getter、health/auth、Cookie/Origin/速率/body限制、日志脱敏。
- 最小manifest/Service Worker/登录页/状态条。
- SSE fixture测试；动态API no-store；退出/吊销关闭SSE；端口/socket全部释放。

### 阶段2：只读项目/会话/最近历史（1.5–2天）

- 项目分组、会话标题/preview/运行态、最近有界历史。
- 安全文本渲染、超限提示。

### 阶段3：实时 + 双向 + 模型（2–2.5天）

- SSE最终一致恢复、发送、中止、模型显示/切换。
- 网络中断不自动重复mutation；失败状态可解释。

### 阶段4：手工隧道试运行与真机验收（1天 + 实际使用观察）

- 继续手工运行Gate选中的connector，不把自动管理作为MVP门槛。
- 真机蜂窝/代理开启/添加主屏幕/切网/桌面重启/pi-web重启完整闭环。
- 真实使用稳定后再决定是否做connector自动管理、更多历史和新会话。

## 8. 工期

| 工作 | 预计 |
|---|---:|
| Gate 0A | 0.5–1天 + 过夜 |
| Gate 0B | 1–1.5天 |
| 阶段1 | 约2天 |
| 阶段2 | 1.5–2天 |
| 阶段3 | 2–2.5天 |
| 阶段4 | 约1天 + 使用观察 |
| **MVP主动开发** | **约8–11个工作日，另计DNS/过夜等待** |

后续产品化（connector自动管理、更多历史、新会话、二维码）另行评估，不混入MVP承诺。

## 9. 风险与停止规则

| 风险 | 应对 |
|---|---|
| 当前 `qd.je` 不能接入Cloudflare | 另申请 `dpdns.org/qzz.io`；不换则直接切SakuraFrp |
| Cloudflare大陆链路不稳 | Gate量化测试direct/HTTP2/同机TUN；失败切SakuraFrp |
| 两条免费入口都不稳 | 停止PWA，用户选择Telegram Bot或低成本固定入口 |
| SSE无回放游标 | 明确最终一致，断线重拉快照，不承诺逐token无损 |
| 长会话全量响应过大 | 8MiB初始硬限、single-flight、流式计数abort、超限转桌面 |
| pi-web内部API变化 | adapter契约测试 + 桌面补丁复核；失败不升级 |
| 移动模块拖累桌面 | 可关闭、故障隔离；任何失败不得阻塞桌面核心 |
| 账号/Token泄露 | 用户自己操作账号；秘密不入仓库/命令行/日志 |

**必须停止请用户决策：**
- Cloudflare Named 与 SakuraFrp均未通过Gate 0A。
- 需要付费固定入口但用户未批准。
- pi-web关键API/模型状态不支持需求。
- 最大实际会话即使拒绝历史仍会拖垮桌面主体。

## 10. 用户配合与下一步

### 用户配合

- 决定是否在DigitalPlat再申请一个 `*.dpdns.org`（优先）或 `*.qzz.io` 免费域名；不要提供账号信息。
- Gate 0时自行登录DigitalPlat/Cloudflare并完成NS/Tunnel操作；不要发送密码/API Token/恢复码。
- 用真机外部网络测试，反馈延迟和断线；保持电脑开机不休眠。

### 文件边界

- 文档、PWA、fixture：`mobile/`。
- Bridge代码因Electron生命周期放 `src/mobile-bridge*.ts`；不修改 `resources/pi-web/`。
- 阶段0只使用官方connector并校验来源；MVP不捆绑第三方二进制。

## 当前下一步

域名/Tunnel按用户决定暂缓。下一步先执行 **Gate 0B：pi-web协议与容量画像**（sessions/history/state/models/prompt/abort/set_model/SSE、模型状态、历史大小与内存）。

Gate 0B完成后等待域名准备，再执行Gate 0A；两项均通过后才开始完整PWA。电脑代理模式届时可由我在本机只读检测。
