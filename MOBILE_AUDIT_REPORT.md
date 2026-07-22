# Pi Web Desktop 移动端进度与问题审查报告

> 供后续开发者或修复 Agent 参考  
> 审查时间：2026-07-22（Asia/Shanghai）  
> 工作区：`D:\PI-web-desktop`

## 1. 审查结论

移动端已经完成较多实际开发，并非只有规划：MobileBridge BFF、PWA 页面、PWA manifest/Service Worker、Electron 生命周期集成及 Windows 安装包均已存在。

当前阶段可概括为：

- **按代码实现量估算：约 70%。**
- **按公网可用验收估算：约 40%。**
- 本地只读链路已跑通；公网域名、双向操作、真机和稳定性门禁仍待完成。
- 当前存在 2 个 P0 和多个 P1 问题，处理完成前不宜宣告移动版交付。

## 2. 已完成内容

### 2.1 Gate 0B 协议与容量画像

- 已建立 pi-web 0.7.16 的 sessions、history、state、models、agent、SSE 等协议清单。
- 已保存合成或脱敏 fixture。
- `mobile/gate0b/fixture-check.mjs` 当前结果：`27 passed, 0 failed`。
- 历史响应采用 8 MiB 硬限制；当前实测会话响应低于该阈值。
- state DTO 已过滤 `systemPrompt`、`sessionFile` 等敏感字段。

### 2.2 MobileBridge BFF

实现文件：`src/mobile-bridge.ts`

已具备：

- 仅监听 `127.0.0.1:62810`。
- 配对码登录和 Cookie 会话。
- 项目、会话、历史、状态和模型查询。
- 发送消息、中止、切换模型。
- SSE 转发与 20 秒心跳。
- 动态读取 Electron `PiWebRuntime.info` 中的 pi-web 地址。
- 静态 PWA 文件服务。

本次对真实 `127.0.0.1:62809` pi-web 执行只读契约测试，13 项通过，包括项目、会话、历史、状态和模型 DTO。

### 2.3 PWA 页面

实现目录：`resources/mobile/`

已具备：

- 配对登录页。
- 项目列表、会话列表、聊天历史。
- SSE 流式输出。
- 发送、中止、模型选择。
- manifest、图标、Service Worker。

### 2.4 Electron 与打包

- `src/main.ts` 已集成 MobileBridge 启停和托盘配对码菜单。
- TypeScript 构建通过。
- NSIS 安装版和 portable 版均已生成。
- 已检查发布包 `app.asar`，其中包含：
  - `dist/mobile-bridge.js`
  - `resources/mobile/index.html`
  - `resources/mobile/manifest.json`
  - `resources/mobile/sw.js`
- 发布包中的移动静态资源与当前工作区哈希一致。

## 3. 当前运行与公网状态

审查时的本机快照：

- pi-web：`127.0.0.1:62809` 正在监听。
- standalone MobileBridge：`127.0.0.1:62810` 正在监听。
- 本地 `/mobile/api/v1/health` 返回正常。
- cloudflared 进程正在运行，日志出现已注册 edge connection。
- `tt56677.top` 的权威 NS 在 1.1.1.1、8.8.8.8、9.9.9.9 查询结果中仍为 `dnsowl`。
- `mobile.tt56677.top` 当前为 NXDOMAIN，公网 PWA 地址尚未生效。

注意：cloudflared 已连接 edge 只代表连接器在线，不代表域名解析和手机入口已经完成。

## 4. 阻塞问题

## P0-1：配对码可通过公网转发路径直接读取

证据：`src/mobile-bridge.ts:285-288`

当前存在未鉴权接口：

```text
GET /mobile/auth/pairing-code
```

代码注释把它视为 local-only，但 Cloudflare Tunnel 会把公网 HTTP 请求转发到同一 loopback BFF，因此 loopback 绑定并不会隐藏该路由。域名生效后，访问者可先取得配对码，再调用登录接口创建会话。

### 建议修复

1. 删除 `/mobile/auth/pairing-code` HTTP 路由。
2. Electron 托盘直接通过 `mobileBridge.pairingCode` 读取内存值。
3. pairing code 只在本机托盘或受控本机界面显示。
4. 增加回归测试：未鉴权请求该旧路径应返回 404。

### 验收标准

- 公网和本地 HTTP 均取不到配对码。
- 托盘仍能正常显示、复制和刷新配对码。

## P0-2：Electron 正式集成版会拒绝公网 POST

证据：

- `src/main.ts:684`：`new MobileBridge({ runtime })`
- `src/mobile-bridge.ts:336-343`：mutation Origin 检查

Electron 集成路径没有配置 `allowedOrigins`。通过 `https://mobile.tt56677.top` 打开的 PWA 发出 POST 时，Origin 为公网域名，BFF 会返回 403。

受影响功能：

- 发送消息。
- 中止运行。
- 切换模型。
- 登出或吊销会话。

standalone 脚本单独硬编码了公网 Origin，因此 standalone 和安装版行为不一致。

### 建议修复

1. 建立单一配置来源，例如环境变量或应用配置：

```text
PI_MOBILE_ORIGIN=https://mobile.tt56677.top
```

2. Electron 正式集成和 standalone 共用同一配置解析函数。
3. 启动时规范化 Origin，只接受完整的 `https://host[:port]`。
4. 未配置公网 Origin 时，在托盘明确显示“仅本机模式”。
5. 增加公网 Origin 与恶意 Origin 的 POST 回归测试。

### 验收标准

- 配置的 HTTPS Origin 可完成发送、中止、切换模型和登出。
- 其他 Origin 返回 403。
- 安装版与 standalone 行为一致。

## P1-1：项目卡片的 inline onclick 属性被破坏

证据：`resources/mobile/index.html:242`

当前把 `JSON.stringify(projectId)` 直接拼入双引号 `onclick` 属性。项目路径 JSON 自带双引号，HTML 解析时会提前结束属性。

本次使用 HTML 解析器复现，最终 `onclick` 只剩：

```text
navigate('sessions',{projectId:
```

项目列表虽然可以显示，但项目到会话列表的导航不可靠。

### 建议修复

- 移除 inline `onclick`。
- 使用 `document.createElement()`、`dataset` 和 `addEventListener()`。
- projectId 保留在 JavaScript 内存或安全的 dataset 中，不拼接成可执行 HTML。
- 会话卡片和模型 option 同步检查相同的属性拼接问题。

### 验收标准

- 普通英文路径、中文路径、空格、`&`、单引号等路径均可进入正确会话列表。
- 页面中不再出现由 API 数据拼成的 inline event handler。

## P1-2：请求体超限表现为连接重置

证据：`src/mobile-bridge.ts:70-85`，特别是第 77 行 `req.destroy()`。

当前超限后直接销毁 socket。临时 BFF 实测 2 KB 登录请求得到 `UND_ERR_SOCKET / fetch failed`，而不是结构化 400 或 413 JSON。

### 建议修复

- 达到上限后停止收集数据并排空剩余请求体，保持响应 socket 可写。
- 返回统一错误：

```json
{
  "error": {
    "code": "BODY_TOO_LARGE",
    "message": "Request body exceeds limit",
    "retryable": false
  }
}
```

### 验收标准

- 登录、消息和模型接口超限时均返回稳定 413 JSON。
- 服务继续处理后续正常请求。

## P1-3：重复 watchdog/setup 进程存在竞态

审查快照：

- `ns-watchdog.sh` 直接实例：5 个。
- `tunnel-auto-setup-v2.sh` 直接实例：2 个。

这些脚本共享日志和状态文件；检测到 NS 传播后还会执行 cloudflared 停止与启动。多个实例并发会相互覆盖状态、重复 route、重复重启 Tunnel。

`ns-watchdog.sh` 还存在一个流程问题：Phase 1 循环自然结束后缺少 `NS_OK` 失败分支，仍会进入 Phase 2。

### 建议修复

1. 清理前通过 Windows `Win32_Process` 核对目标 PID 和 CommandLine。
2. 保留单一 watchdog。
3. 增加 PID/lock 文件，并验证 PID 的命令行仍匹配后再认为锁有效。
4. NS 等待超时后写入 timeout 状态并退出。
5. route 和 tunnel start 设计为幂等单实例操作。

## P1-4：移动端实现尚未提交到当前 HEAD

当前 HEAD 仍为桌面版提交，移动端主要内容处于 modified/untracked 状态，包括：

- `src/mobile-bridge.ts`
- `resources/mobile/`
- `mobile/`
- `electron-builder.yml`
- Tunnel/watchdog 脚本
- `src/main.ts`
- `package.json` / `package-lock.json`

fresh clone 当前不会包含完整移动端成果。

### 建议处理

1. 先整理 `.gitignore`：release、状态 JSON、配对码文件、运行日志和 connector 凭据不进入提交。
2. 检查 staged diff 中没有 pairing code、Cookie、Token、证书和 Tunnel credential。
3. 将源码、PWA 资源、构建配置、测试和必要文档形成独立提交。
4. 从干净 clone 执行 build 和测试。

## 5. 其他问题与改进项

### P2-1：Cookie 缺少 Secure

证据：`src/mobile-bridge.ts:381`、`:393`、`:408`

当前 Cookie 有 `HttpOnly; SameSite=Strict`，但缺少 `Secure`。公网 HTTPS 模式应增加 `Secure`，本机 HTTP 开发模式可通过显式配置控制。

### P2-2：“刷新配对码”菜单没有刷新

`src/main.ts` 中该菜单只显示当前 code 并重建菜单，没有调用 regenerate/revoke。建议改名为“显示配对码”，或实现真正的刷新并吊销旧会话。

### P2-3：固定端口与 standalone 双启动冲突

当前 standalone BFF 已占用 62810。Electron 重启后，集成 MobileBridge 会因 `EADDRINUSE` 启动失败；standalone 又硬编码 pi-web 62809，pi-web 动态端口变化后会指向旧端口。

建议只保留一个正式启动路径。若 standalone 仅用于调试，应增加明显的开发标记和端口/PID检查。

### P2-4：缺少可重复的“40/40”测试脚本

文档记录过 40/40 集成自测，但仓库中没有对应脚本。现有可复现验证为：

- Gate 0B fixture：27/27。
- 本次临时只读真实链路测试：13 项。

建议增加正式测试目录，覆盖 BFF 路由、鉴权、Origin、历史上限、字段过滤、SSE、PWA 导航及关闭释放端口。

### P2-5：PWA 发送后的交互反馈较弱

- 用户消息要到 `agent_end` 刷新历史后才稳定显示。
- 网络错误主要使用 alert/console。
- SSE 结束后可能持续重连，缺少清晰状态与退避提示。

这些属于核心阻塞修复后的体验优化项。

## 6. 推荐修复顺序

1. 移除公开 pairing-code 路由。
2. 统一 Electron/standalone 的公网 Origin 配置。
3. 修复项目卡片导航。
4. 修复请求体超限响应。
5. 建立自动回归测试并复测 BFF/PWA。
6. 清理重复 watchdog，增加单实例锁。
7. 整理 Git 提交和 `.gitignore`，从干净 clone 验证。
8. 等 NS 委派生效后执行公网 Gate 0A。
9. 最后执行安卓真机、SSE 耐久和 Wi-Fi/蜂窝切换验收。

## 7. 建议测试矩阵

### 7.1 BFF 自动测试

- 未登录读取受保护 API：401。
- pairing-code HTTP 路径：404。
- 错误 code、频率限制、正确登录。
- Cookie 属性：HttpOnly、SameSite、HTTPS 模式 Secure。
- 正确 Origin POST：成功。
- 错误或缺失 Origin mutation：403。
- history 超过 8 MiB：413 JSON。
- state 输出中没有敏感字段。
- SSE connected、message_update、agent_end、heartbeat。
- stop 后 SSE 关闭且端口释放。

### 7.2 PWA 浏览器测试

- 登录后进入项目、会话、聊天。
- 中文、空格及特殊字符项目路径。
- 历史消息纯文本安全渲染。
- 发送、中止、模型切换。
- SSE 断开与恢复。
- Service Worker 不缓存 API/auth/SSE。
- 401 后返回登录页。

### 7.3 公网与真机 Gate 0A

- 权威 NS 已切换到 Cloudflare。
- `mobile.tt56677.top` 可解析且 HTTPS 证书正常。
- 安卓 Chrome 登录、安装 PWA、发送和接收正常。
- 100 次小 API 请求错误率与延迟达标。
- SSE 连续 2 小时和过夜测试。
- Wi-Fi 与蜂窝切换后恢复。
- Windows 重启、Electron 重启、Tunnel 重启后 hostname 保持不变。

## 8. 当前可复现验证命令

```powershell
cd D:\PI-web-desktop

# TypeScript 构建
npm run build

# Gate 0B fixture
node mobile\gate0b\fixture-check.mjs

# 本地端口
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 62809,62810 }

# 本地 BFF health
Invoke-RestMethod http://127.0.0.1:62810/mobile/api/v1/health

# 当前权威 NS
Resolve-DnsName tt56677.top -Type NS -Server 1.1.1.1 -DnsOnly

# 工作区状态
git status --short
git diff --check
```

## 9. 修复完成判定

以下条件全部满足后，可把移动端状态更新为“进入公网试运行”：

- P0、P1 问题全部关闭并有自动测试覆盖。
- 安装版直接启动的 MobileBridge 可完成公网双向操作。
- HTTP 面不再暴露 pairing code。
- 项目、会话、聊天导航在真实浏览器通过。
- 单一 watchdog/connector 路径稳定运行。
- 移动端源码已提交，干净 clone 构建与测试通过。
- 域名、HTTPS、安卓真机、长 SSE 和网络切换 Gate 0A 通过。

