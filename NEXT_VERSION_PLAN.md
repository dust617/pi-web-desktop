# Pi Web Desktop v0.2.0 规划：一体化隧道与稳定性

> 建议版本主题：**Managed Tunnel & Reliability**  
> 目标平台：先完成 Windows 10/11 x64；其他平台后续适配。  
> 规划基线：当前 `0.1.0`、`andrewyng/openworker@db93d75`、2026-07-26 本地代码审计。

## 1. 版本目标

v0.2.0 要把“桌面应用、pi-web、MobileBridge、frpc”变成一棵由 Electron 主进程拥有的服务树：

- 启动 Pi Web Desktop 后，只要托盘程序仍在运行，移动端安全通道就自动运行；
- 关闭窗口只隐藏到托盘，通道继续；明确点击“退出”才按顺序停止通道、BFF 和 pi-web；
- frpc 崩溃能有界恢复，断网时不制造重启风暴，配置错误时给出可操作提示；
- 桌面功能不因隧道故障被拖死；状态必须明确区分“桌面可用、本地移动端可用、连接器在线、公网可达”；
- 记忆系统内部故障不再暴露原始函数错误，不阻断主任务，且能告诉用户如何恢复与诊断；
- 将锁定的 `@agegr/pi-web` 从 `0.8.0` 升级并适配到 `0.8.1`，把 Node.js、Pi SDK、API、下游补丁和打包回归作为独立 Gate；
- 吸收 OpenWorker 的成熟边界设计，但不迁移 Tauri/Python 技术栈，也不扩张为另一套 agent 平台。

## 2. 发布阻塞项（P0）

### P0-1：先修公网 HTTPS，再做自动启动

当前 VPS 草案是：

```text
手机 http://VPS:8443 -> frps/frpc TCP -> 127.0.0.1:62810
```

它同时存在两个问题：

1. MobileBridge 的公网 mutation Origin 只接受 HTTPS，公网 HTTP 登录/POST 会被拒绝；
2. 若放宽 HTTP，配对码和会话 Cookie 将通过公网明文传输。

v0.2.0 的唯一支持形态必须是：

```text
手机 HTTPS 域名
  -> VPS 上可信 TLS 终止（Caddy/Nginx/等价组件）
  -> VPS loopback 上的 frp proxy 端口
  -> frps/frpc
  -> 本机 127.0.0.1:62810 MobileBridge
```

要求：

- **PWA 数据面**只开放 HTTPS，不提供“临时 HTTP 模式”；frps control port 单独按固定版本启用 TLS/auth、最小化防火墙暴露，不能与数据面混为一谈；
- frps 的 remote proxy 只绑定 VPS loopback（例如 `proxyBindAddr = "127.0.0.1"`），防火墙禁止公网绕过 TLS 反代直连该端口；
- VPS 反代覆盖并清洗 `X-Forwarded-Proto`、`X-Forwarded-For`、Host；
- BFF 的 `Secure` Cookie 依据“请求 Origin 精确匹配已配置 HTTPS origin”判定，不再只信任可由 raw TCP 客户端伪造的 `X-Forwarded-Proto`；未实现代理认证前忽略 XFF，宁可共享限流桶，也不冒充真实客户端 IP；
- Origin 配置与公开 URL 必须同源、可验证；
- 完成“公网 proxy 端口旁路失败”的反例测试，以及真实手机的登录、发消息、停止、SSE、刷新登录态回归后才允许发布。

### P0-2：秘密与公开代码彻底分层

- 禁止把真实 frp token、服务器凭据、私钥写入仓库或普通日志；
- tracked 内容只保留通用 profile schema、TOML 模板和示例；
- 普通配置存到 `app.getPath("userData")/tunnel/profile.json`；
- token 使用 Electron `safeStorage` 加密保存；
- frpc TOML 使用官方支持的 `{{ .Envs.* }}` 模板，token 只注入 child environment，不放命令行、不写真实 TOML；
- `safeStorage.isEncryptionAvailable()` 为 false、解密失败、Windows 用户变化或 portable 跨机器时一律进入 `blocked/secret_unavailable` 并要求重新输入，绝不回退到明文；
- last-known-good 只能引用同一 safeStorage 中可解密的 secret，不能复制明文；
- 状态/API/UI 只返回 `configured/invalid/expired/lastVerifiedAt` 等元数据，永不回显值。

### P0-3：二进制供应链可验证

- 固定 frpc 版本和目标架构；
- 构建阶段下载并校验官方 SHA-256/发布资产，运行时不静默下载；
- 用 electron-builder `extraResources` 把按平台/架构固定的 frpc 可执行文件、hash 元数据和上游 LICENSE 放到 asar 外；仅在上游确实提供或许可证要求时加入 NOTICE，并生成第三方许可证清单；
- 启动前校验文件 hash 与版本；失败进入 `blocked`，不从网络临时补一个未知文件；
- installer、portable 和开发模式共用唯一资源解析函数并分别做真实 spawn 测试。

### P0-4：锁定并适配 pi-web 0.8.1

#### 官方变化与直接影响

- 目标固定为 `@agegr/pi-web@0.8.1`，不跟随 `main` 漂移。patch manifest 记录不可变 provenance：annotated tag peeled commit `b4f4576b890de92b1def79a56ad1fb2841ee84c1`、npm `gitHead` `ae58c82bae41b2583a3569299d4995f591a13b5c`、tarball shasum `056334d2410364a5b1a873547a60f9e02b52ba7e` 与 registry integrity；解释并核验 tag release commit 与 npm 构建来源差异；
- 最低系统 Node.js 从项目文档中的旧要求提升为 **`>=22.19.0`**。`PiWebRuntime` 必须在 spawn 前执行 semver 预检并给出中文可操作错误；不能只等 child 退出后显示笼统“启动失败”；
- Pi 依赖升级到精确 `0.82.1`，memory-guard、extension UI request、session state/SSE 不能沿用 0.81.1 的验证结果；
- CLI 仍支持 `--port`、`-H`、`--no-open`，但 host 环境变量改为 `PI_WEB_HOSTNAME`。Runtime 保留显式 `-H 127.0.0.1`，并把 env 从通用 `HOSTNAME` 同步为 `PI_WEB_HOSTNAME`，避免受宿主环境污染；
- 0.8.1 新增 API Origin 防护。MobileBridge 的无 Origin loopback server-to-server 请求理论上被允许，但必须用 staged runtime 做真实集成测试；
- 上游新增目录选择器、输入历史/Cmd+I、图片/KaTeX/Mermaid 预览、会话列表修复、模型错误呈现与安全加固，桌面壳/preload 不得覆盖或破坏这些行为。

#### MobileBridge API 合同

官方 0.8.1 runtime artifact 仍包含以下依赖路由，升级 Gate 必须验证“存在 + DTO/SSE 语义”，而不只检查 200：

- `/api/home`；
- `/api/sessions`、`/api/sessions/:id`、`/api/sessions/:id/state`；
- `/api/agent/new`、`/api/agent/:id`、`/api/agent/:id/events`；
- `/api/models`；
- `/api/archived-sessions`（下游 patch，GET/PUT）；
- `POST /api/agent/new` 的 `ensure_session -> sessionId`；
- `POST /api/agent/:id` 的 `prompt`、`extension_ui_response`、`abort`、`set_model` 四类请求与错误状态；
- sessions list/detail/state 的 `runningSessionIds`、`context.messages/model/thinkingLevel`、`running/state.isPromptRunning/isStreaming/isCompacting/model/thinkingLevel/contextUsage/messageCount`；
- models 的 `modelList/defaultModel/thinkingLevels`；
- SSE 的 `connected`、`agent_start/end`、`message_start/update/end`、`model_select`、`thinking_level_select`、`extension_ui_request`、`error` 及未知事件 fail-safe；
- history query 的 `deferThinking`、`deferMedia`。

为这些合同建立表驱动 staged integration：不仅断言 HTTP 200，还要断言请求体、响应字段、SSE event shape、MobileBridge 过滤后不泄露 `systemPrompt/sessionFile/queuedMessages/extensionStatuses`，并覆盖手机发送、停止、切模型和扩展 UI 回答。

**已确认缺口：** `/api/archived-sessions` 是本项目 0.8.0 阶段加入的下游能力，不在官方 0.8.1 tag 源码或 npm runtime artifact 中。直接替换会让手机归档功能变成 404。v0.2.0 必须二选一：

1. 先保留该 route 为有来源、可测试的 downstream patch，并纳入 0.8.1 重建；或
2. 将归档读写迁入已认证的 MobileBridge，再删除对 pi-web 自定义 route 的依赖。

本版本优先选择方案 1，控制改动面；方案 2 可在后续减少 patch queue。

#### 下游 patch queue

禁止把整个旧 `resources/pi-web` 覆盖到新版本。建立显式 patch manifest，逐项决定：

| 现有差异 | 0.8.1 状态 | 处理 |
|---|---|---|
| `b61188a` Markdown 本地图片 | 上游已部分吸收 | 不整块重放；测试点击打开、最大尺寸、UNC 后仅保留必要 delta |
| `843cdd3` `outputFileTracingRoot` | 上游未吸收 | 必须重放，并重新 build 验证 Electron 打包 tracing root |
| `c3c646e` archived-sessions route | 上游不存在 | 作为独立安全 patch 保留并补合同测试 |
| 本地 `test` script | 上游 package 未提供 | 保留明确 test entry，或把根 `test:pi-web` 改为显式 `node --test` |

每个 patch 记录：目的、上游状态、受影响文件、测试、移除条件。上游已覆盖的 patch 应删除，不能形成双实现。

#### 可回滚升级流程

1. 对当前 0.8.0 完整目录和 package/build 元数据做 fresh backup；
2. 从上述不可变 source/npm 标识准备完整 staged source，校验官方 release、tarball integrity 与 provenance 差异；
3. 使用上游 lockfile 做**干净 `npm ci`**，不把旧 `node_modules` 当最终依赖树；
4. 按 manifest 应用最小 downstream patches；
5. 本地重新 `npm run build`，保证源码、依赖和 `.next` 同源；不能把官方 `.next` 与修改后的源码混搭；
6. 运行 pi-web unit、CLI、完整 API/DTO/SSE contract、MobileBridge、memory loader、desktop smoke 与 package parity；
7. 加固现有 staged swap：只接受 manifest 指定的 `0.8.1`、semver 高于当前、required files/build ID/node_modules 完整且 smoke 已通过的目录；禁止“取第一个 `*-staged`”和意外降级；
8. 开发态冷启动 swap 失败立即恢复 0.8.0 backup；packaged 应用只随经过验证的新 installer/portable 更新，不修改安装目录。

把步骤 2–6 实现为强制脚本，例如 `npm run pi-web:stage -- 0.8.1`：在隔离目录完成 fetch/integrity、clean `npm ci`、patch manifest、pi-web build、BUILD_ID/route/provenance 检查和 staged contract tests，成功后写入可验证 manifest。根 `npm run build` 仅执行 `tsc`，绝不能替代该 Gate；`test:pi-web` 只测 active runtime，也不能替代 stage 测试。

#### Packaged 回滚

- 发布前保留可验证的上一版 installer/portable（内含 pi-web 0.8.0）及其 hash，不依赖开发态 staged swap；
- 0.8.1 首次运行前，对应用配置、mobile session store 和将用于回归的 Pi session 做安全 checkpoint/export；不删除原 session；
- 在隔离副本上验证 Pi 0.82.1 写入后的 session/config 能否被旧版读取；若不兼容，回滚必须同时恢复对应 backup，不能只降级 exe；
- 执行真实回滚 smoke：安装/运行 0.2.0 候选 -> 创建并续聊测试 session -> 卸载或覆盖安装上一版/启动上一版 portable -> 恢复必要 backup -> 验证桌面、项目切换和历史会话；
- `deleteAppDataOnUninstall: false` 保持不变；任何回滚失败都保留新旧安装包和 session export，不建议删除当前会话。

## 3. 目标架构

```text
Electron single-instance lock
└─ DesktopLifecycleCoordinator
   ├─ PiWebRuntime                 必需；动态 loopback 端口
   ├─ MobileBridgeController       可降级；默认 127.0.0.1:62810
   ├─ TunnelSupervisor             可降级；依赖 Bridge ready
   │  └─ FrpcAdapter               唯一受支持 connector（v0.2.0）
   ├─ HealthAggregator             聚合，不把 unknown 伪装成 healthy
   ├─ DiagnosticStore              脱敏、轮转、可安全导出
   └─ SecureTunnelConfigStore      profile + safeStorage secret
```

### 建议模块

| 模块 | 建议路径 | 职责 |
|---|---|---|
| 统一组件状态 | `src/service-state.ts` | 状态、事件、错误 envelope、generation |
| 生命周期编排 | `src/desktop-lifecycle.ts` | 启动依赖、优雅退出、恢复顺序 |
| 通用受管进程 | `src/managed-process.ts` | child ownership、日志、退出、重启预算 |
| 隧道监督器 | `src/tunnel/tunnel-supervisor.ts` | 状态机、退避、依赖门禁、手动控制 |
| frpc 适配器 | `src/tunnel/frpc-adapter.ts` | 参数、模板、frpc 错误分类与连接状态 |
| 配置/秘密 | `src/tunnel/tunnel-config.ts`, `src/tunnel/secure-store.ts` | schema、迁移、safeStorage、脱敏 |
| 健康聚合 | `src/health-aggregator.ts` | local/connector/public 分层快照 |
| 诊断日志 | `src/diagnostics.ts` | JSONL、轮转、redaction、diagnosticId |
| 设置页 | `resources/settings/` | 导入/编辑 profile、测试连接、查看状态 |
| 通用模板 | `resources/tunnel/frpc.template.toml` | 无真实值的 TOML 环境变量模板 |

`src/main.ts` 只保留 Electron 事件和 UI 接线，不继续堆叠进程监督细节。

## 4. TunnelSupervisor 设计

### 4.1 状态机

```text
disabled
  -> validating
  -> waiting_for_bridge
  -> starting
  -> connected
  -> degraded          网络断开，优先等待 frpc 自带重连
  -> backoff           child 真正退出后的有界重启等待
  -> blocked           配置/凭据/二进制/TLS 永久错误
  -> stopping
  -> stopped
```

每个状态快照至少包含：

```ts
{
  state,
  generation,
  since,
  reasonCode,
  retryable,
  restartCount,
  nextRetryAt,
  lastConnectedAt,
  lastErrorAt,
  diagnosticId
}
```

### 4.2 启动顺序

1. Electron 单实例锁必须先成功，第二实例只唤醒窗口，不能启动第二条 frpc；
2. 读取 profile，做 schema、origin、端口、binary hash、secret availability 校验；
3. 启动 pi-web 并通过 readiness；
4. 启动 MobileBridge 并确认 loopback live + upstream ready；
5. tunnel profile 已启用时再启动 frpc；
6. frpc 启动不阻塞桌面窗口，托盘显示“连接中”；
7. connector 成功后做公网 HTTPS synthetic health，得到最终 `publicReady`。

新安装默认 `disabled/unconfigured`；已导入并验证成功的 profile 可启用“随桌面自动启动”。

### 4.3 重启与防风暴策略

- frpc 自身仍存活但网络不可达：标记 `degraded`，优先让 frpc 原生重连，不反复 kill；
- child 真实退出且属于瞬时错误：带 jitter 的 `2s -> 5s -> 10s -> 30s -> 60s`；
- 使用滑动窗口保存真实 exit 时间：10 分钟内最多 5 次外层重启；短暂连上不能清零，只有连续稳定连接满 10 分钟才重置预算；超过后进入 `blocked/crash_loop`，需用户点击“重试”；
- 固定 frpc 版本及可机器判定的日志格式/adapter parser，用该版本真实输出制作 fixture，明确区分 auth、proxy conflict、config、binary 与 transient network/exit；未知错误不得猜成永久错误；
- 配置解析错误、凭据拒绝、binary/hash 错误、远端端口冲突：立即 `blocked`，不自动重试；
- 公网 synthetic probe 单独失败时先标记 `public=degraded/unknown`，不能仅凭这一层盲杀本地健康的 frpc；
- Bridge 失去 readiness 时不启动新 frpc；持续失败时安全停掉已拥有的 connector，Bridge 恢复后再按预算启动；
- 只终止当前 Electron 持有的 child/process tree；禁止按模糊命令行扫描并 kill 全局 frpc。

### 4.4 旧脚本迁移

第一次启用受管隧道：

1. 让用户手动关闭旧 BAT 窗口；
2. 导入现有 TOML，只抽取非敏感 profile 与 token，立即把 token 加密保存；
3. 测试 local health、frps auth、HTTPS public health；
4. 验证成功后默认原子脱敏旧 TOML（把 token 改成环境变量占位符）；若用户拒绝，明确标记“外部用户管理的明文残余风险”，不能把它算进应用安全 Gate；
5. 全部通过后才打开 auto-start；
6. beta 阶段提供“关闭 managed mode + 运行时安全输入 token 的兼容启动器”作为脚本回滚，兼容启动器不得持久化 token；稳定两个版本后再考虑移除。

检测到远端 proxy/端口已被占用时只提示“可能仍有旧脚本运行”，不得自动杀未知进程。

## 5. 生命周期与整体稳定性

### 5.1 受控退出与非受控崩溃分开保证

当前 `before-quit` 发起 `mobileBridge.stop()` 但不等待。v0.2.0 对**受控退出**使用一次性 shutdown barrier：

1. 标记 coordinator `stopping`，禁止新的恢复计时器；
2. 停 TunnelSupervisor，等待最多 5 秒，超时只 kill 自己拥有的 child tree；
3. 关闭 SSE 与 MobileBridge，等待最多 3 秒；
4. 异步停止 pi-web runtime，等待 exit confirmation，超时才强杀；
5. flush 脱敏日志和状态快照；
6. 允许 Electron 退出。

正常 Quit、安装更新、`query-session-end/session-end` 等受控路径复用该幂等 barrier。Electron/OS 非受控崩溃时这段代码无法执行，Windows 必须另设进程级兜底：优先采用并实测 Job Object `KILL_ON_JOB_CLOSE` 包住 pi-web/frpc 进程树；若 Node/Electron 绑定不可行，再使用打包且可测试的 watchdog helper。`PiWebRuntime.stop()` 与 `ManagedProcess.stop()` 都要升级为“可等待 + 超时 + exit confirmation”的异步 API。

### 5.2 组件故障隔离

- pi-web 首次启动失败：桌面主功能不可用，保留当前 fatal 行为但增强诊断；
- MobileBridge 失败：桌面仍可用，隧道不启动；
- frpc/TLS/public health 失败：桌面与本地 BFF 仍可用；
- 运行期 pi-web 崩溃：先有界自动恢复一次，失败后再请求用户；Bridge 状态变 `upstream_unavailable`，不丢手机登录会话；
- 设置页、托盘或日志写入失败不得阻断服务树。

### 5.3 分层健康模型

| 层 | 状态 | 判定 |
|---|---|---|
| Desktop | `ready/degraded/fatal` | Electron + pi-web |
| Bridge live | `up/down` | 62810 是否监听 |
| Bridge ready | `ready/degraded` | `/api/home` upstream 是否可用 |
| Connector | `connected/reconnecting/blocked/unknown` | child + frpc 明确信号 |
| Public | `ready/degraded/unknown` | HTTPS PWA/health synthetic probe |
| Memory | `healthy/degraded/blocked` | live contract + data/policy doctor |

`unknown` 必须保留，不能因为“看不到远端链路”就显示绿色。

建议拆分：

- `/mobile/api/v1/live`：BFF socket 活着即 200；
- `/mobile/api/v1/ready`：upstream 不可达返回 503；成功体包含 build/PWA version 与本次 BFF 启动随机 `instanceChallenge`；
- public synthetic probe 必须校验证书链和 hostname、禁止跳出预期 origin 的 redirect、校验 Host、HTTP 200、JSON schema、`ok:true`、build/PWA version 及预期 `instanceChallenge`；任一不符都不能 `publicReady`；
- 为错误域名、任意 HTTPS 站点、旧缓存响应和 `HTTP 200 + ok:false` 加反例测试；
- 原 `/health` 保持一版兼容，标记 deprecated；
- native `get-service-status` IPC 返回聚合状态，不含秘密。

### 5.4 日志与诊断

- userData 下按组件写结构化 JSONL：`desktop`、`runtime`、`bridge`、`tunnel`、`memory`；
- 单文件大小和保留份数受限，例如 5 MiB × 3；日志失败不阻断启动；
- 统一 redactor 去掉 token、Cookie、Authorization、配对码、认证 URL 和完整 request body；
- 每次用户可见故障生成 `diagnosticId`；
- 托盘提供“复制安全状态”“打开日志目录”“导出脱敏诊断包”；
- 导出前再次扫描，默认不含 profile 原文、session 内容和 memory 原文。

## 6. 桌面体验

### 托盘菜单

建议增加：

- `移动端通道：已连接 / 正在重连 / 配置错误 / 未配置`；
- `复制移动端地址`（只有 HTTPS public-ready 才启用）；
- `重新连接通道`；
- `暂停/恢复随桌面运行`；
- `移动端与隧道设置…`；
- `运行诊断`；
- `打开脱敏日志目录`。

### 设置页最小能力

- 导入旧 frpc TOML；
- 编辑公开 URL、server address/port、remote proxy 端口、自动启动；
- token 输入框只能覆盖，不能回显；
- “测试配置”按 local -> auth/connector -> HTTPS public 三步展示；
- 明确显示失败层和下一步，不只给一个红灯；
- 变更 profile 后先验证，再原子替换；失败保留 last-known-good profile。

## 7. 记忆系统改进

### 7.1 根因修复

当前故障已复现为：TS extension reload 后，Node 原生 ESM 仍缓存旧 `memory-contract.mjs` namespace。

推荐实现：

1. 移除 extension 对 shared `.mjs` 的静态 import；
2. `loadMemoryContract()` 根据 contract 内容 hash 构造 cache-busted file URL 动态加载；
3. 导出并校验 `MEMORY_CONTRACT_VERSION`；
4. 初始化时断言 required exports 的名字、类型和安全 smoke-call；
5. 将 live contract health 固化在 extension 状态中；
6. Node/Jiti 真实 loader、同进程 reload、新进程恢复和可用时 Bun packaged 路径全部回归。

若 cache-busted import 在某运行时无法可靠验证，则退回“extension 与 contract 原子打包成一个产物”，不能只加 optional chaining 吞掉错误。

### 7.2 稳定错误模型

| code | 用户提示重点 | 行为 |
|---|---|---|
| `MEMORY_RUNTIME_CONTRACT_STALE` | 组件版本不一致；重启 agent/桌面进程；本次未加载记忆 | recall/brief/review 降级，save 禁止 |
| `MEMORY_NOT_INITIALIZED` | 项目未初始化记忆目录 | 给初始化入口，不自动创建 |
| `MEMORY_CONTENT_BLOCKED` | 检测到安全风险；运行 memory:check | fail closed，不回显原文 |
| `MEMORY_DATA_INVALID` | 格式/日期/Replaces 无效 | 不读/不写，给检查命令 |
| `MEMORY_IO_UNAVAILABLE` | 安全相对路径 + read/write + 系统错误码 | 不把 IO 错误伪装成空记忆 |
| `MEMORY_BUSY` | 另一会话持锁，稍后重试 | retryable |
| `MEMORY_INPUT_INVALID` | 明确字段约束 | 修正参数后重试 |
| `MEMORY_INTERNAL` | 内部错误 + diagnosticId | 不泄漏函数名和 stack |

所有失败 details 统一包含：

```ts
{ ok: false, code, category, operation, degraded, retryable,
  recommendedAction, diagnosticId }
```

### 7.3 降级与 doctor

- `before_agent_start` 加 memory boundary；记忆故障不阻断主 prompt；
- scanner/contract 不健康时，brief/recall/review 不得输出 STATUS/FACTS/INBOX 原文；
- save 在任何安全校验不健康时 fail closed；
- 新增进程内 `memory-doctor`，对比 live export/version/path 与 fresh child import；
- `disk healthy + live stale` 时明确提示必须重启进程，不把 `/reload` 说成确定修复；
- `readText` 改为返回可分类结果，不能吞掉 EACCES/解析错误后假装空文件。

### 7.4 记忆能力边界

OpenWorker 的稳定 ID、显式 update/forget、scope ownership 只记为后续参考，不纳入 v0.2.0 交付，以免从“错误恢复”漂移到“记忆产品重构”。本版本继续保留本项目规则：

- 候选观察不自动成为长期事实；
- 必须有验证来源、TTL、替代链；
- 凭据和控制分隔符禁止进入记忆；
- v0.2.0 不迁移到 SQLite，不引入另一套自动记忆数据库。

## 8. OpenWorker 参考取舍

| OpenWorker 设计 | 决策 | 本项目应用 |
|---|---|---|
| 桌面壳持有 sidecar Child | 采用 | Electron 持有 frpc，退出只 kill owned child |
| 单实例必须早于 sidecar | 已有，强化测试 | 防重复 frpc |
| 每次启动 token | 延后 | 当前没有独立 native 管理 HTTP API，不为借鉴而新增范围 |
| 父进程 kill + 子进程 parent watchdog | 改造后采用 | 受控退出由 Child 句柄；非受控崩溃用 Windows Job Object/已测试 helper，不能假设 frpc 自带 parent watchdog |
| sidecar 日志保留 `.old` | 加强后采用 | 大小/份数轮转 + 脱敏导出 |
| 冷启动请求失败后健康恢复重载 | 采用 | Bridge/Tunnel settings 恢复 E2E |
| 错误保留上下文并提供 Retry | 采用 | tunnel、memory 可操作错误卡/托盘动作 |
| shallow `/health: ok` | 不采用 | 分层组件健康 + unknown |
| sidecar 无自动重启预算 | 不采用 | 有界退避、crash loop circuit breaker |
| 明文 SecretStore + ACL | 不采用 | Electron safeStorage + env 注入 |
| Tauri/Python 技术栈 | 不采用 | 保持 Electron/TypeScript |
| 自动任务、connector、persona 平台 | 延后/无关 | 不扩张 v0.2.0 范围 |
| SQLite 自动记忆 | 不采用 | 保留文件记忆与安全 guard |

## 9. 实施里程碑

### M-1：pi-web 0.8.1 锁定适配（Release blocker，最先完成）

交付：

- fresh backup 当前 0.8.0；锁定完整 source commit、npm gitHead/shasum/integrity，建立 0.8.1 staged source/build 和 downstream patch manifest；
- Node.js `>=22.19.0` 预检、`PI_WEB_HOSTNAME` 适配与 README/升级文档更新；明确改写 `UPGRADE_LESSONS.md` 中“复制旧 node_modules + npm install”的旧流程为隔离 clean `npm ci`，并加文档一致性检查；
- 新增强制 `pi-web:stage` 脚本，完成 clean `npm ci` + 重放 `outputFileTracingRoot`、archived-sessions 等已批准 patch + 本地重建 `.next` + staged contract tests；
- 加固 staged swap 的版本、manifest、完整性和防降级校验；
- 建立 0.8.1 CLI/API/DTO/SSE、MobileBridge、memory Pi 0.82.1、桌面 UI、installer/portable 回归报告；
- 更新 `README.md` 中 Node.js 要求、锁定版本和已过时的 `?cwd=` 补丁说明。

Gate：

- Node 22.18.x 在 spawn 前得到可操作阻断；22.19.x 与当前 24.x 启动成功；
- MobileBridge 所需 route 与字段全部通过合同测试，手机归档功能不 404；
- memory-guard 在 Pi 0.82.1 真实 loader 下完成 brief/recall/save/review、热加载错位和 fail-closed 测试；
- 目录选择器、输入历史/Cmd+I、图片/KaTeX/Mermaid、会话刷新、模型错误显示通过桌面 smoke；
- Electron 打包后 tracing、`?cwd=`、右键切项目、剪贴板图片、SSE 与扩展 UI 请求正常；
- staged swap 失败可原子恢复 0.8.0；packaged 候选包不依赖开发态热替换，并已用上一版 installer/portable + session/config checkpoint 完成真实降级恢复 smoke。

只有 M-1 通过后，后续 TunnelSupervisor 和稳定性工作才以 0.8.1 为唯一基线，避免在两个 pi-web 版本上重复开发和测试。

### M0：安全拓扑与基线（Release blocker）

交付：

- 确认受支持 HTTPS 拓扑和域名；
- 把无秘密的 frps/TLS 模板移到可跟踪、可公开审计的 `deploy/vps-relay/`（或明确为独立外部运维制品）；不继续依赖整体被忽略的 `mobile/vps-relay/`；
- VPS 脚本拆出 frps/TLS，移除无关代理安装；
- fresh backup、dry-run、回滚说明；
- 记录 `npm run build/test:mobile/test:package/test:memory` 基线；
- 查明并修复当前组合 test code 127 与 asar `Array buffer allocation failed`，不能把它们仅记作环境问题。

Gate：真实手机 HTTPS 登录/POST/SSE 成功；PWA 数据面的 HTTP/remote proxy 旁路关闭；frps control port 的 TLS/auth/防火墙验证通过；无秘密扫描命中。

### M1：Supervisor 核心（P0）

交付：

- `ManagedProcess`、`TunnelSupervisor`、`FrpcAdapter`；
- 状态机、generation、child ownership、退避、circuit breaker；
- Bridge readiness 依赖；
- 幂等 graceful shutdown；
- 托盘最小状态/重试/停止动作。

Gate：kill frpc 后有界恢复；断网 30 分钟无重启风暴；Quit 后无孤儿 frpc/监听端口。

### M2：安全配置、打包与迁移（P0）

交付：

- safeStorage、profile schema、last-known-good，以及不可用/跨用户/portable 跨机器的 blocked 流程；
- env template；
- 固定并校验 frpc binary，通过 `extraResources` 放到 asar 外，补上游 LICENSE、条件性 NOTICE 与第三方许可证清单；
- 设置页、旧 TOML 导入/原子脱敏和无持久 token 的兼容回滚启动器；
- installer/portable packaged smoke。

Gate：应用创建和管理的任何文件、Git、命令行、日志、诊断包均无 token；若用户拒绝清理外部旧 TOML，UI 明确残余风险且发布记录不能宣称已清除；safeStorage 不可用时绝不明文降级；干净 VM 首启通过。

### M3：健康、诊断与稳定性（P1）

交付：

- 分层 health/IPC；
- JSONL 轮转和统一 redactor；
- 安全诊断导出；
- pi-web/Bridge 恢复策略统一；
- sleep/wake、网络切换和第二实例测试。

Gate：8 小时 chaos soak 无孤儿、无无限 timer/socket、无 restart storm；RC 前再做 24 小时真实链路 soak。

### M4：记忆系统错误体验与根因修复（P0/P1）

交付：

- cache-busted/原子 contract loader + version handshake；
- stable error envelope；
- fail-closed 降级；
- live/fresh `memory-doctor`；
- hot-reload exact regression 与 loader parity。

Gate：精确旧 export 场景不再抛 raw TypeError；主任务继续；save 字节不变；新进程恢复。

### M5：发布验证与迁移说明

交付：

- 用户升级指南、关闭旧 BAT/导入/回滚步骤；
- 将 `package.json`、`package-lock.json` 根包版本、packaged manifest、`app.getVersion()` 展示、installer/portable artifact 文件名同步升级为 `0.2.0`，并加入自动一致性 Gate；
- installer + portable 候选包，以及可验证的上一版 installer/portable、hash、session/config checkpoint 与 packaged rollback 报告；
- 脱敏扫描、许可证清单、版本说明；
- beta feature flag 观察一版，确认后默认启用 managed tunnel。

Gate：下述验收矩阵全部通过；失败可在 5 分钟内关闭 managed mode 并使用“不持久化 token”的兼容启动器，且不改 VPS 路由。

## 10. 验收矩阵

| 场景 | 预期 |
|---|---|
| Node 版本边界 | 22.18.x 在 spawn 前阻断并提示升级；22.19.x、24.x 启动 0.8.1 成功 |
| pi-web provenance/stage | source commit、npm gitHead/shasum/integrity 匹配 manifest；隔离 clean `npm ci`、patch、build、BUILD_ID 和 staged tests 原子通过 |
| pi-web CLI/host | `--port/-H/--no-open` 与 `PI_WEB_HOSTNAME` 行为正确，只监听 loopback |
| Mobile API contract | 0.8.1 上 prompt/UI-response/abort/set-model、route、DTO、SSE、`ensure_session/defer*` 全部通过；archived-sessions 不 404 |
| Pi 0.82.1 extension | memory guard、extension UI request、state/SSE 均通过真实 loader 集成测试 |
| downstream patches | patch manifest 中每项有测试；已被上游吸收的 patch 不重复应用 |
| 0.8.1 staged swap | 只选指定高版本完整 stage；失败原子恢复 0.8.0；不会选旧 stage 降级 |
| packaged 0.8.0 rollback | 保留旧 installer/portable 和 hash；降级后配置/session 可读，必要 backup 可恢复，桌面与历史会话通过 smoke |
| 0.8.1 桌面功能 | 目录选择、输入历史/Cmd+I、图片/KaTeX/Mermaid、会话/模型错误行为正常 |
| 桌面启动，profile 已验证 | Bridge ready 后自动启动 frpc，托盘最终显示公网 HTTPS ready |
| 仅关闭窗口 | 窗口隐藏，pi-web/BFF/frpc 继续运行 |
| 明确退出 | 有序停止，无 frpc/pi-web 孤儿，无 62810 残留监听 |
| 强制终止 Electron | Job Object/watchdog 在有界时间内回收 pi-web/frpc 进程树，无孤儿进程 |
| frpc 进程被杀 | 按退避恢复；只有持续稳定连接满 10 分钟才重置滑动窗口预算 |
| 断网/VPS 不可达 | `degraded/reconnecting`，frpc 原生重连，外层不重启风暴 |
| token 错误/远端端口冲突 | `blocked` + 可操作提示，不无限重试，不回显值 |
| 62810 被占用 | 桌面仍可用；Bridge/Tunnel 不启动；明确端口冲突，不杀未知进程 |
| pi-web 运行期崩溃 | 有界恢复；手机会话保留；Bridge 明确 upstream unavailable |
| Electron 第二次启动 | 只唤醒窗口，不产生第二 frpc |
| 系统睡眠/唤醒、网络切换 | 状态重新评估，连接恢复，无重复 timer/child |
| 公网 TLS/Origin 错配 | fail closed；登录/POST 不降级为 HTTP |
| publicReady 反例 | 错域名、redirect、缓存旧实例、`200 + ok:false` 均不得显示 ready |
| 诊断包导出 | 不含 token、Cookie、配对码、认证 URL、memory/session 原文 |
| memory contract 热更新错位 | 不阻断主任务；无原始 TypeError；doctor 指向进程重启 |
| memory 内容含风险 | recall/brief/review 不泄露原文；save 不写 |
| installer/portable | frpc 资源、hash、license、路径和退出行为一致 |

## 11. 必跑验证命令

```bash
npm run pi-web:stage -- 0.8.1
npm run test:pi-web -- --stage .backup/pi-web-0.8.1-staged
npm run test:pi-web-compat -- --stage .backup/pi-web-0.8.1-staged
npm run build
npm run test:mobile
npm run test:memory
npm run memory:check
# package Gate 必须由干净工作区原子生成候选包后再做 parity，不能复用未知旧 release/
npm run test:package:clean
```

`test:package:clean` 应在脚本内部完成“清理隔离输出 -> 构建/pack 候选包 -> parity -> packaged smoke”，失败时保留可诊断 artifact；当前 `npm run test:package` 依赖预先存在的 `release/win-unpacked` 且本次出现 asar allocation failure，在根因修复前不算有效 Gate。

建议新增：

```bash
npm run pi-web:stage -- 0.8.1
npm run test:pi-web-compat -- --stage .backup/pi-web-0.8.1-staged
npm run test:tunnel
npm run test:lifecycle
npm run test:diagnostics
npm run test:memory:reload
npm run test:package:clean
```

另外必须有人工/环境测试：

- Windows installer 与 portable；
- 真实 frpc/frps + HTTPS 域名；
- 手机蜂窝网络与 Wi-Fi 切换；
- sleep/wake；
- 8h/24h soak；
- 独立脚本回滚。

PWA 若有任何资源改动，必须同时 bump `resources/mobile/index.html` PWA version 和 `resources/mobile/sw.js` cache version。

## 12. 明确不做

v0.2.0 不包含：

- 自动购买/自动接管 VPS、路由器、OpenClash 或代理软件；
- 在桌面端自动执行未经用户确认的远端网络变更；
- Cloudflare/localhost.run 等多 tunnel provider 同时支持；
- Tauri/Python 重写；
- OpenWorker 的 connector、persona、自动任务平台；
- SQLite 自动记忆或模型自行写入长期记忆；
- 跨平台完整支持（Windows 稳定后再扩展）。

## 13. 最终建议顺序

**不要直接从“把 BAT 放进 main.ts 启动”开始。** 正确顺序是：

1. 先完成 pi-web 0.8.1 锁定适配、下游 patch 收敛和 0.8.0 回滚 Gate；
2. 再封住 HTTP/TLS 与秘密泄漏两个 P0；
3. 实现独立、可测的 TunnelSupervisor；
4. 接入 Electron 生命周期和托盘；
5. 加配置迁移、打包和诊断，并完成 memory contract 根因修复；
6. 最后做真实链路 soak 和可回滚发布。

这样才能达到“桌面端在，安全稳定通道就在”，而不是把一个脆弱的独立死循环隐藏到桌面进程里。
