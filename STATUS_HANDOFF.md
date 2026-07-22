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
