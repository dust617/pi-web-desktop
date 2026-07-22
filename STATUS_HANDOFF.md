# Pi Web Desktop — 状态交接文档（给检查者 / 下一位接手者）

> 目的：自包含地记录项目当前进度、架构、关键标识、阻塞项与坑，便于第三方（如另一个 AI）无需翻历史即可核查与接手。
> 采集时间：2026-07-22 约 22:0x（本地 +08:00）。所有"当前值"以本文末"实时快照"为准，进程/端口可能随时间变化，核查时请重跑命令。

---

## 0. 一句话总览

桌面端 Electron 壳 + 锁定版 pi-web 已打包完成；移动端 PWA + 本地 BFF 已实现并在本地端到端验证通过；Cloudflare Named Tunnel 已建好并 4 连接在线；**唯一阻塞**是域名 `tt56677.top` 在 `.top` 注册局的 NS 委派尚未从 `dnsowl` 切到 `cloudflare`（Namesilo→注册局的批次延迟，无法人为加速）。NS 一传播，后台 watchdog 会自动完成 DNS route + 隧道重启 + HTTPS 验证，手机即可访问 `https://mobile.tt56677.top/mobile/`。

---

## 1. 关键标识（务必核对，曾有拼写坑）

| 项 | 值 | 备注 |
|---|---|---|
| **正确域名** | `tt56677.top` | ⚠️ 历史对话/旧文件曾误写 `tt58677.top`，已全部修正。检查时若看到 58677 视为过期残留。 |
| 移动端子域 | `mobile.tt56677.top` | tunnel ingress hostname |
| Cloudflare NS | `earl.ns.cloudflare.com` / `irena.ns.cloudflare.com` | Namesilo 已保存 |
| Cloudflare Account ID | `7781d2fc636a357e2fd221ba167f143f` | 账户级，跨 zone 不变 |
| 新 zone (`tt56677`) Zone ID | **未在本地记录** | 需到 Cloudflare 面板 Overview 查看；勿与旧 zone 混淆 |
| 旧 zone (`tt58677`) Zone ID | `4ea097e695220dccdaf589776db18ba7` | ⚠️ 该 zone **已从 Cloudflare 删除**，此 ID 仅作历史参考 |
| Tunnel 名 / ID | `pi-mobile` / `5a18d771-4a59-43ce-8ff8-8e4cad5e5e78` | |
| pi-web runtime 端口 | `127.0.0.1:62809` | 当前 Electron 会话所依赖，**不可杀/不可重启** |
| MobileBridge BFF 端口 | `127.0.0.1:62810` | loopback-only |
| **手机配对码** | `102835` | 本次 standalone BFF 生成；BFF 重启会变，见 `bff-pairing-code.txt` |

---

## 2. 架构链路

```
[手机浏览器/PWA]
   │  https://mobile.tt56677.top/mobile/   (Cloudflare 边缘终止 TLS，免费证书)
   ▼
[Cloudflare edge]  ── Named Tunnel (QUIC, 4 连接) ──►  [本机 cloudflared.exe]
                                                          │  按 ingress 转发
                                                          ▼
                                              http://127.0.0.1:62810  (MobileBridge BFF)
                                                          │  Cookie 鉴权 / 字段过滤 / 8MiB 历史上限 / SSE 代理
                                                          ▼
                                              http://127.0.0.1:62809  (锁定版 pi-web runtime = 当前会话)
```

- BFF **不**新起 pi-web runtime，而是以 duck-type 假 `runtime.info` 指向已存在的 62809，避免打断当前 Electron 会话。
- BFF 仅 loopback 监听；外部 HTTPS 入口完全由 cloudflared tunnel 提供，**手机无需装 VPN**。

---

## 3. 各组件当前状态（含判定依据）

| 组件 | 状态 | 判定依据 / 命令 |
|---|---|---|
| pi-web runtime (62809) | ✅ 运行 | `netstat -ano \| grep :62809` LISTENING；承载当前会话 |
| MobileBridge BFF (62810) | ✅ 运行 | `netstat -ano \| grep :62810` LISTENING；`curl http://127.0.0.1:62810/mobile/api/v1/health` → `{"ok":true,"piWebPort":62809}` |
| BFF 鉴权 | ✅ 生效 | 未带 cookie 访问 `/mobile/api/v1/projects` → `{"error":{"code":"UNAUTHORIZED",...}}`（且证明 BFF→62809 转发通） |
| PWA 静态壳 | ✅ 200 | `curl -o /dev/null -w %{http_code} http://127.0.0.1:62810/mobile/` → 200；manifest 200 |
| cloudflared tunnel | ✅ 4 连接在线 | `tasklist \| grep cloudflared` 有进程；`grep -c "Registered tunnel connection" tunnel-run.log` = 4 |
| CNAME 记录 | ✅ 已写 zone | `cloudflared tunnel route dns` 输出 `Added CNAME mobile.tt56677.top` |
| cloudflared 权限(cert.pem) | ✅ 已重绑新 zone | 旧 cert 绑死已删的 tt58677 导致 route `Authentication error`；已重新 `tunnel login` 选 tt56677 解决 |
| Cloudflare zone 激活 | ✅ 已激活 | 面板显示绿勾 "Your domain is now protected by Cloudflare" |
| Namesilo NS 保存 | ✅ cloudflare | 用户截图确认 |
| Namesilo 邮箱验证 | ✅ 已验证 | 解除 "domain will be suspended" 红条风险 |
| **注册局 NS 委派** | ❌ 仍 dnsowl | `nslookup -type=NS tt56677.top a.nic.top` 仍返回 ns1/2/3.dnsowl.com |
| **全球递归 DNS** | ❌ 仍 dnsowl | `nslookup -type=NS tt56677.top 8.8.8.8` 同上 |
| **公网 HTTPS** | ❌ 暂不通 | `curl https://mobile.tt56677.top/mobile/` → 000（解析不到，符合 NS 未传播） |
| ns-watchdog | ✅ 运行 | `ns-watchdog-status.json` 的 attempt 持续增长（采集时为 20） |
| 桌面打包产物 | ✅ 已生成 | `release/Pi-Web-Desktop-0.1.0-x64.exe`(291M, NSIS) + `...-portable.exe`(290M) |

### ⚠️ 进程存活判定陷阱（检查者必读）
在 **Git Bash** 下，`ps aux | grep ns-watchdog` 与 `ps aux | grep standalone-bff` 对 `nohup` 启动的进程**经常匹配不到（返回空）**，但这**不代表进程死了**。请以以下为准：
- BFF 存活 = `:62810` LISTENING 且 `/health` 返回 ok。
- watchdog 存活 = `ns-watchdog-status.json` 的 `attempt` 字段随时间增长（每 ~2 分钟 +1）。
- 如需看进程，用 Windows 视角：`tasklist | findstr node` / `tasklist | findstr bash`，或 `wmic process where "commandline like '%ns-watchdog%'" get ProcessId,CommandLine`。

---

## 4. 唯一阻塞项

**`.top` 注册局的 NS 委派尚未更新**：Namesilo 界面虽已保存 cloudflare NS，但 Namesilo 把该变更**推送给 `.top` 注册局**存在批次延迟（实测注册局源头 `a.nic.top` 仍委派 dnsowl）。这是注册商→注册局链路，**无法人为加速**，典型几分钟到数小时。注册局更新后，全球递归 DNS（8.8.8.8/1.1.1.1）才会跟随刷新，`mobile.tt56677.top` 才能解析到 Cloudflare。

> 注：Cloudflare 能激活 zone 是因为它走自己的验证通道；但 cloudflared 的权威 NS 在注册局委派切过来前不会对外"开门"服务该 zone，故所有公网解析路径都收敛到这同一阻塞。

---

## 5. 自动收尾机制（ns-watchdog.sh v3）

后台单实例轮询，逻辑：
1. **Phase 1**：每 120s 查 NS（8.8.8.8 / 1.1.1.1 / a.nic.top 任一返回 cloudflare 即视为传播），最多 360 轮（~12h）。
2. **Phase 2**：`cloudflared tunnel route dns pi-mobile mobile.tt56677.top`（幂等，最多重试 5 次）→ 杀旧 cloudflared → 重启 tunnel。
3. **Phase 3**：循环 `curl https://mobile.tt56677.top/mobile/`，直到返回 **200**（覆盖"注册局已变但递归 DNS 缓存未刷新"的窗口），最多 40 轮（~40min），每轮写 `ns-watchdog-status.json`。
- 状态文件：`ns-watchdog-status.json`；日志：`ns-watchdog.log`。
- 终态 `{"status":"ok","httpCode":200,...}` 即全链路公网打通。

---

## 6. 重要约束 / 踩过的坑

1. **不要重启/杀当前 Electron**：62809 的 pi-web runtime 由当前 Electron 启动，承载本会话；重启会断会话。移动端长期方案是重启 Electron 用"集成版 BFF"（`src/main.ts` 已接线），但**验证 mobile 期间请勿重启**。
2. **standalone BFF 是临时后台 node 进程**（`standalone-bff.mjs`）：机器重启或进程被杀即消失，需重跑 `node standalone-bff.mjs`（或改用打包/集成版）。它用 duck-type runtime 挂 62809，不新起 runtime。
3. **域名拼写**：正确的是 `tt56677.top`。`tt58677` 为历史错误，已全局 sed 修正（src/脚本/文档）；若复查发现 58677 残留请一并改掉。
4. **cert.pem 权限绑 zone**：`cloudflared tunnel login` 生成的 cert 绑定登录时账户里选中的 zone；旧 cert 绑已删的 tt58677，导致对新 zone route 报 `Authentication error`；解法是**重新 login 并选 tt56677**（已完成）。
5. **cloudflared config 路径**：Windows 下 `credentials-file` 用正斜杠 `C:/Users/...` 或双反斜杠；曾因 Git Bash 的 `/c/...` 路径导致 tunnel 启动报 "credentials file doesn't exist"。当前 `~/.cloudflared/config.yml` 已用正斜杠，正常。
6. **BFF 安全设计**：loopback-only、Cookie(`mb_session`, HttpOnly, SameSite=Strict)、不转发 `systemPrompt`/`sessionFile` 等敏感字段、历史 8MiB 硬上限、SSE `no-store,no-transform`、登录 5 次/分钟限流。经 tunnel 走 HTTPS 时，loopback 段未设 `Secure` 标志（本地回环无需），如需更严可在 BFF 检测 `X-Forwarded-Proto` 后加 `Secure`。
7. **打包未签名**：自用足够；`electron-builder.yml` 已配 NSIS+portable，`npmRebuild:false`，pi-web 作为 `asarUnpack` 资源整体打入（故包体 ~290M）。

---

## 7. 关键文件清单

| 路径 | 作用 |
|---|---|
| `src/main.ts` | Electron 主进程；已集成 MobileBridge 启动/停止、托盘配对码、右键菜单注册代码 |
| `src/mobile-bridge.ts` | BFF 实现（12 端点、鉴权、SSE 代理、字段过滤） |
| `src/pi-web-runtime.ts` | 锁定版 pi-web 启停封装 |
| `resources/mobile/index.html` `manifest.json` `sw.js` `icon-192/512.png` | PWA 壳（登录/项目/会话/聊天/模型切换/上下文用量） |
| `standalone-bff.mjs` | **临时**独立拉起 BFF 挂 62809 的脚本（不重启 Electron 的方案） |
| `bff-pairing-code.txt` | 当前 standalone BFF 的端口+配对码+URL |
| `resources/cloudflared/cloudflared.exe` | cloudflared v2026.7.2 |
| `~/.cloudflared/config.yml` | tunnel ingress（hostname=mobile.tt56677.top → 127.0.0.1:62810） |
| `~/.cloudflared/cert.pem` `*.json` | tunnel 登录凭证 + tunnel 凭据 |
| `ns-watchdog.sh` `ns-watchdog.log` `ns-watchdog-status.json` | NS 传播自动收尾 |
| `tunnel-run.log` | tunnel 运行日志 |
| `start-tunnel.bat` | 以后双击启动隧道的入口 |
| `electron-builder.yml` `release/*.exe` | 打包配置与产物 |
| `progress.md` `mobile/progress.md` | 进度流水 |
| `mobile/gate0b/*` | 早期协议/容量核查与只读探针（27/27、探针全 200） |

---

## 8. NS 传播后：用户操作 & 自查命令

**用户**：手机浏览器开 `https://mobile.tt56677.top/mobile/` → 登录页填配对码（当前 `102835`）→ 即可用。

**自查**（电脑端，按序）：
```bash
# 1) NS 是否切到 cloudflare
nslookup -type=NS tt56677.top 8.8.8.8
# 2) 子域是否解析
nslookup mobile.tt56677.top 8.8.8.8
# 3) 公网 HTTPS 是否 200
curl -sI --max-time 15 https://mobile.tt56677.top/mobile/
# 4) 本地链路是否仍健康
curl -s http://127.0.0.1:62810/mobile/api/v1/health
# 5) watchdog 终态
cat D:/PI-web-desktop/ns-watchdog-status.json
```
若 NS 已切但 HTTPS 仍 000：等 1–2 分钟递归缓存刷新；或看 `tunnel-run.log` 是否仍有 4 条 `Registered tunnel connection`，没有则 `cloudflared tunnel run pi-mobile` 重启。

---

## 9. 后续待办（非阻塞，按优先级）

1. **NS 传播 + watchdog 自动收尾**（进行中，等待）。
2. 真机 PWA 验收：登录/项目列表/会话列表/历史/SSE 流式/发消息/abort/切模型/上下文用量/添加到主屏幕。
3. 移动端满意后，**择机重启 Electron** 切换到集成版 BFF（去掉 standalone 临时进程），并验证托盘配对码显示。
4. 桌面右键菜单真实验收：重启后确认注册表 `HKCR\Directory\shell\PiWebDesktop` 与 `...\Background\...` 存在，右键"在此打开 Pi Web"切项目生效（当前运行实例未注册，故未验）。
5. 可选：NSIS 安装版实机安装/卸载流程验收。
6. 长期：BFF 经 HTTPS 时按 `X-Forwarded-Proto` 给 cookie 加 `Secure`；考虑把 standalone BFF 做成开机自启或并入 Electron 生命周期。

---

## 10. 给检查者（GPT/Reviewer）的核查清单

- [ ] 域名全文应为 `tt56677.top`，无 `tt58677` 活跃引用（历史 progress 流水里出现属正常记录）。
- [ ] 62809 与 62810 均 LISTENING；`/mobile/api/v1/health` 为 `{"ok":true,"piWebPort":62809}`。
- [ ] 未鉴权访问受保护端点返回 `UNAUTHORIZED`（鉴权未失效）。
- [ ] cloudflared 进程在、`tunnel-run.log` 有 4 条注册连接；`config.yml` 的 hostname 为 `mobile.tt56677.top`、service 为 `http://127.0.0.1:62810`。
- [ ] `ns-watchdog-status.json` 的 attempt 在增长（watchdog 活）；NS 仍 dnsowl 时 status 为 waiting 属预期。
- [ ] 理解"ps grep 空 ≠ 进程死"的 Git Bash 陷阱，勿据此误报故障。
- [ ] 确认未触碰/重启 62809 的 Electron（会话完整性）。
- [ ] 公网 HTTPS 在 NS 传播前为 000 属预期，非 bug。

---

## 实时快照（本次采集）

```
端口监听:  62809 LISTENING (pi-web)   62810 LISTENING (BFF)
tunnel:    进程在, 4 条 Registered tunnel connection
watchdog:  status={"status":"waiting","attempt":20}  (活, 等 NS)
BFF health: {"ok":true,"piWebPort":62809}
配对码:    102835
NS(a.nic.top / 8.8.8.8): 仍 ns1/2/3.dnsowl.com  ← 唯一阻塞
HTTPS(mobile.tt56677.top/mobile/): 000  ← 由上一行决定, 预期
打包产物:  release/Pi-Web-Desktop-0.1.0-x64.exe (291M)
           release/Pi-Web-Desktop-0.1.0-portable.exe (290M)
```

---

## 2026-07-22 更新：审计修复完成 + 公网全链路打通

### 审计修复（MOBILE_AUDIT_REPORT.md，已全部修复并测试）
- **P0-1** 删除未鉴权的 `GET /mobile/auth/pairing-code`（tunnel 会把公网请求转到 loopback）。配对码只能 Electron 托盘进程内读取。**公网验证：404 ✓**
- **P0-2** 统一 Origin 配置来源 `resolveAllowedOrigins()`（Electron 与 standalone 共用）；**缺失 Origin 的 mutation 也返回 403**（纵深防御）。默认内置 `https://mobile.tt56677.top`，设 `PI_MOBILE_ORIGIN=`（空）= 仅本机模式。**公网验证：缺失/恶意 Origin → 403 ✓**
- **P1-1** PWA 的项目/会话/模型列表改为 DOM 构建（`dataset` + `addEventListener`），消除 API 数据拼接的 inline onclick（路径含引号/空格/& 不再破坏页面）。静态按钮（doLogin/send/abort/back）保留，无注入面。
- **P1-2** 超限请求体返回结构化 **413**（不再 socket RST）；`finally` 用 `req.resume()` 排空未读 body（keep-alive 干净复用，不 reset 响应）。
- **P1-3** `ns-watchdog.sh` v4：mkdir 单实例锁 + NS 超时失败分支 + route 幂等。
- **P1-4** `.gitignore` 排除 `bff-pairing-code.txt`、`*-status.json`、`release/`、`resources/cloudflared/`。已本地提交 `a991804`（未 push）。
- **P2-1** Set-Cookie 在 `X-Forwarded-Proto=https` 时自动加 `Secure`（本地 HTTP 不加，公网 HTTPS 加）。**公网验证：cookie 含 Secure ✓**
- **P2-2** 托盘"刷新配对码"真正轮换码并吊销所有手机会话（`rotateCode()`）。
- **P2-3** standalone BFF 加 DEV 横幅 + EADDRINUSE 指引。
- **P2-4** 新增自包含回归测试 `mobile/tests/bff.test.mjs`（24 项全过：`node mobile/tests/bff.test.mjs`）。

### 公网全链路打通（里程碑）
- **NS 传播已生效**（watchdog attempt 62 检测到 Cloudflare NS）。
- `https://mobile.tt56677.top/mobile/` 公网返回 **200**，鉴权/Origin/Secure cookie/敏感字段过滤全部公网验证通过。
- 当前配对码见 `bff-pairing-code.txt`（每次 BFF 重启会变）。

### ⚠️ 关键运行约束：依赖代理 TUN
- 本机直连 Cloudflare 边缘的 **TLS 被干扰**（`SEC_E_ILLEGAL_MESSAGE`），且 DNS 被 Clash/mihomo fake-ip 接管（`198.18.0.0/15`）。
- cloudflared 2026.7.2 **不走 HTTP 代理**（`--proxy-url` 已移除、`HTTPS_PROXY` 不生效）。
- 因此 cloudflared **必须经 mihomo TUN 模式**接管流量才能连上 Cloudflare 边缘。
- 已在 `config.yml` 固定 `protocol: http2`（TCP，避开 QUIC/UDP 被代理丢弃），与 TUN 兼容性最好。
- **TUN 开 → cloudflared 自动连通；TUN 关 → 安全重连等待**（cloudflared 自带重连，互不冲突）。
- 代理时开时关时，移动端公网可用性随 TUN 状态变化，这是环境限制，非配置错误。

### 手机真机测试指引
1. 确保本机代理 **TUN 已开启**（cloudflared 才能连边缘）。
2. 手机浏览器打开 `https://mobile.tt56677.top/mobile/`。
3. 输入 `bff-pairing-code.txt` 里的当前配对码。
4. 验证：项目列表 → 会话列表 → 历史 → SSE 流式 → 发送 → 中止 → 切模型 → 上下文用量 → 添加到主屏幕（PWA）。

---

## 2026-07-23 更新：running/绿点/流式顺序 + 千问上下文

- 已恢复并接续卡住的 `019f85e6…` session；JSONL 完整，停点是超长上下文压缩，不是 session 文件损坏。
- BFF `/state` 不再把持久 agent 的 `isAlive()` 当作运行中；active 统一为 `isPromptRunning || isStreaming || isCompacting`（且要求 agent alive）。idle 时仍返回模型、上下文用量等安全字段。
- 项目/会话列表在可见时每 5 秒刷新，并在页面回到前台时立即刷新；绿点现在使用 pi-web 的 active-running 列表语义。
- PWA 现完整处理 `message_start` / `message_update` / `message_end`：每条 assistant/toolResult 消息在结束时固化，下一轮工具调用不会再把上一段回复替换掉。
- 流式 block 按 content index 合并，拒绝较短回退快照；稳定复用 streaming DOM，并使用 animation frame 合并高频更新，减少手机端闪烁与重排。
- history/state 对账增加 session/load guard；旧请求不能覆盖新会话，对账也不会清掉当前尚未落盘的流式 bubble。
- `connected` 是未命名 SSE data 记录，不是浏览器 named event；重连对账已移到 JSON `type:"connected"` 分支并去重。
- 修复 thinking 内容字段（`thinking`）及 toolCall 参数字段兼容，模型思考阶段不再表现为长时间完全无内容。
- 新增回归：`mobile/tests/pwa-stream.test.mjs` 8/8（含同 session history/message_end 并发竞态）；BFF 状态矩阵 30/30；TypeScript、PWA/SW 语法和 diff check 均通过。
- 本机 `~/.pi/agent/models.json` 的 `qwen3.8-max-preview` 原误配为 128K/16K；已按阿里云官方精确值改为 context `983616`、max output `131072`。Pi CLI 已显示 `983.6K / 131.1K`。现有已加载会话需重新选择该模型或重启后才能拿到新元数据。
- 注意：更大窗口解决的是错误的提前压缩/128K 显示，不会消除模型推理、网络或超长 prompt 本身的延迟；保留自动压缩与余量仍是正确做法。

---

## 2026-07-23 更新：移动端 v5 全链路复检

### 真机体验修复
- 输入区使用不可收缩 flex item，聊天滚动区 `min-height:0`；以 `visualViewport.height` 作为手机实际可视高度，解决地址栏/键盘导致输入框底部裁切。
- 智能滚动只在用户位于底部时跟随；上翻阅读不再被流式输出拽回。新消息按钮跟随输入区动态高度，手动回到底部/点击按钮恢复跟随。
- 相同 history 对账不再误报新消息；离开聊天页会清理提示。旧 state poll 不会覆盖更新的 SSE running 状态。
- 模型选择按服务端 state 权威对账，支持包含 `:` 的模型 ID；切换失败恢复旧选项并提示，桌面/其他客户端切模型也会同步到手机。

### PWA 更新与安全
- PWA/SW 版本为 `pi-mobile-v5`；注册时 `updateViaCache:none` 且立即 `reg.update()`，不再等 5 分钟或 24 小时。
- SW 预缓存失败会拒绝安装并保留旧工作版本，不再误删可用离线缓存。
- HTTP `/mobile/auth/revoke-all` 已删除，配对码/全量吊销仅允许 Electron 托盘进程内操作。
- 畸形 cookie 返回 401；SSE 每 20 秒重验登录状态，过期/吊销即关闭；上游 401/404 停止自动重连。

### 验证与交付
- 当前会话模型真实状态：`openai-codex/gpt-5.6-sol`、thinking high。
- 自动测试：BFF 32/32、PWA 12/12、SW/layout 4/4、package parity 6/6；TypeScript/语法/diff 全过。
- 公网验证：shell/health/login/state/models/SSE 通过；Secure 7 天 cookie；secret routes 404；malformed cookie 401；公网 SW=v5。
- 新 release 已重新构建；ASAR 内 bridge/main/PWA/SW/manifest 与当前工作树逐字节一致，不再包含旧 pairing-code/revoke-all 路由。
- 当前 standalone BFF 配对码：`812464`；已有持久化 cookie 不因本次重启失效。

### 未阻塞但待加固
- 当前公网运行仍是 DEV-only standalone，session token 文件位于项目根目录；生产使用应切回集成 Electron 的 per-user userData 存储。
- cloudflared 后登录限流共享 loopback bucket；watchdog 仍按 image name 重启 cloudflared，且只监督隧道、不监督 BFF。
- 公网可用性继续依赖路由器/本机代理对 `argotunnel.com` 的可用转发路径。
