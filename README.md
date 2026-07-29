# Pi Web Desktop

> [Pi Web](https://github.com/agegr/pi-web) 的 **Windows 桌面壳** —— 基于 Electron，支持**右键菜单一键打开项目目录**，并内置**移动端 PWA 互通桥**，让你在手机上随时查看/操作电脑里的 AI 编码会话。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

---

## ✨ 功能特点

### 🖥️ 桌面端

- 🖱️ **右键打开**：资源管理器中右键文件夹 →「在此打开 Pi Web」，直接以该目录为工作区启动
- 🔄 **项目热切换**：已运行时再次右键其他文件夹，自动切换工作目录，**无需重启**
- 📁 **单实例管理**：始终只有一个窗口，多次右键自动聚焦并切换
- 💾 **窗口状态记忆**：位置、大小、最大化状态跨启动保留
- 🧰 **系统托盘**：最小化到托盘、托盘菜单快速操作
- 🛡️ **崩溃恢复**：pi-web 进程意外退出时提示一键重启
- 📎 **附件拖拽**：直接拖拽文件到输入框作为附件

### 📱 移动端（内置 PWA 互通桥）

把手机变成桌面 Pi Web 的**远程遥控器**——在外面也能查看电脑上的项目、会话、实时输出，并发消息、中止、切换模型。

- 🌐 **PWA 应用**：手机浏览器访问后可「添加到主屏幕」，接近原生 App 体验（图标、全屏、Service Worker 离线壳）
- 🔐 **配对码登录**：首次用一次性配对码认证；登录态持久化，BFF 重启不掉线
- 🛡️ **安全设计**：
  - BFF 默认**仅绑定 127.0.0.1**（loopback-only），不直接暴露公网
  - Cookie 认证（`HttpOnly` + `SameSite=Strict`），变更接口强制 Origin 校验
  - 认证令牌仅存 **SHA-256 哈希**，原子写入；接口**不转发敏感字段**（systemPrompt、sessionFile 等）
  - 历史记录 8 MiB 硬上限
- ⚡ **实时流式输出**：基于 SSE（Server-Sent Events）把会话事件实时推到手机，含心跳与断线清理
- 💬 **完整交互**：查看项目/会话列表、历史消息、发送消息、响应 UI 请求、切换模型
- 📜 **智能滚动**：stick-to-bottom + 「新消息」跳转按钮；下拉刷新
- 🚇 **公网接入（可选）**：通过 Cloudflare Named Tunnel 获得固定 HTTPS 域名，手机无需安装 VPN
- 🩺 **隧道看门狗**：分层健康检查（pi-web → BFF → 公网 API），连续失败才恢复，避免重启风暴
- 🧩 **扩展 UI 请求**：支持把 pi-web 扩展的 UI 请求转发到手机端处理

> 📂 移动端代码与文档集中在 [`mobile/`](mobile/) 子项目；互通桥实现位于 [`src/mobile-bridge.ts`](src/mobile-bridge.ts)。

---

## 🚀 快速开始

### 环境要求

- Windows 10/11
- Node.js ≥ 22.19.0
- Git

### 安装

```bash
git clone https://github.com/dust617/pi-web-desktop.git
cd pi-web-desktop

# 安装 Electron 依赖
npm install

# 安装 pi-web 运行时依赖
cd resources/pi-web
npm install
cd ../..

# 编译 & 启动
npm start
```

### 注册右键菜单

启动后点击菜单栏 **工具 → 注册右键菜单**，之后即可在资源管理器中：

- 右键**文件夹** → 在此打开 Pi Web
- 右键**文件夹空白处** → 在此打开 Pi Web

### 打包发行

```bash
npm run dist      # 生成安装包 / 便携版（release/）
npm run pack      # 仅生成 unpacked 目录
```

---

## 📱 移动端使用

1. 桌面端启动后，MobileBridge BFF 会在 `127.0.0.1:62810` 监听（loopback-only）。
2. **局域网/本机**：手机与电脑同网时，可通过端口转发或局域网绑定访问 `http://<电脑IP>:62810/mobile/`。
3. **公网（推荐 Cloudflare Tunnel）**：
   - 安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 并创建 Named Tunnel；
   - 将隧道公网域名指向 `127.0.0.1:62810`；
   - 通过环境变量告知 BFF 你的公网 Origin：
     ```bash
     set PI_MOBILE_ORIGIN=https://mobile.你的域名.com
     ```
   - 手机浏览器打开 `https://mobile.你的域名.com/mobile/`，输入桌面端生成的**配对码**登录，即可「添加到主屏幕」。
4. 不设置 `PI_MOBILE_ORIGIN` 时，BFF 仅允许 loopback 访问（最安全）。

> ⚠️ 公网暴露请务必使用 HTTPS + 强配对码，并妥善保管登录态。

---

## ⚙️ 工作原理

### 桌面端项目切换

```
资源管理器右键
  └─→ electron.exe --project "D:\目标目录"
        └─→ 单实例锁 additionalData 传递给主实例
              └─→ 调用 pi-web /api/cwd/validate 设置全局 cwd
                    └─→ 导航到 /?cwd=D:\目标目录
                          └─→ 前端初始化 newSessionCwd，进入目标目录新会话
```

### 移动端互通链路

```
Android Chrome / 安装到主屏幕的 PWA
  https://mobile.<你的域名>/mobile/        （同源 fetch + EventSource，安全 Cookie）
        │
        ▼
Cloudflare Named Tunnel（固定域名 + 自动 HTTPS，手机免 VPN）
        │
        ▼
127.0.0.1:62810  ← Electron MobileBridge（独立、可关闭的版本化 BFF）
  · PWA 静态资源 + 单用户配对码登录
  · /mobile/api/v1/* 白名单代理（过滤敏感字段）
  · SSE 适配、心跳、断线清理、动态读取 pi-web 端口
        │
        ▼
127.0.0.1:<动态端口>  ← 锁定版本的 pi-web 运行时
```

### 关于 `?cwd=` 补丁

pi-web 原生不支持通过 URL 查询参数指定初始工作目录。本项目对两份前端构建产物做了最小补丁：

| 文件 | 修改 |
|------|------|
| `.next/static/chunks/app/page-*.js` | `newSessionCwd` 初始值从 `useSearchParams().get("cwd")` 读取 |
| `.next/server/app/page.js` | SSR 侧同步初始化，避免 hydration 闪烁 |

补丁仅影响初始状态，不改变 pi-web 的任何 API 或会话逻辑。

> 💡 已向 pi-web 上游提交 Feature Request，建议原生支持 `?cwd=` 参数（见下方「致谢与上游」）。

---

## 🗂️ 项目结构

```
pi-web-desktop/
├── src/
│   ├── main.ts              # Electron 主进程（窗口、托盘、右键注册、项目切换）
│   ├── pi-web-runtime.ts    # pi-web 子进程管理（启动、停止、端口分配）
│   ├── mobile-bridge.ts     # 移动端互通桥 BFF（PWA 服务、认证、白名单代理、SSE）
│   └── preload.ts           # 预加载脚本（IPC 桥接）
├── resources/
│   ├── pi-web/              # 锁定的 pi-web 运行时（含 ?cwd= 补丁）
│   └── mobile/              # 移动端 PWA 静态资源（index.html / sw.js / manifest / 图标）
├── mobile/                  # 移动端子项目（文档、测试、规划）
│   ├── README.md            # 移动端子项目说明
│   └── tests/               # 移动端测试（BFF / PWA / 打包一致性）
├── scripts/                 # 构建与内存治理脚本
├── package.json
├── electron-builder.yml
└── tsconfig.json
```

---

## 🧪 测试

```bash
npm run test:mobile     # 移动端：runtime + BFF + PWA(stream/navigation/shell)
npm run test:package    # 打包一致性（ASAR parity）
npm run test:memory     # 内存治理脱敏守卫
npm run build           # TypeScript 编译
```

---

## 🧰 技术栈

- **Electron** 40 – 桌面壳
- **TypeScript** 5.9 – 主进程代码
- **pi-web** 0.8.1 – AI 编码助手 Web UI（锁定版本内置）
- **Next.js** 16 – pi-web 前端框架
- **Cloudflare Tunnel** – 可选公网 HTTPS 接入
- **PWA** – Service Worker + Manifest，移动端接近原生体验

---

## 🙏 致谢与上游

本项目是 [agegr/pi-web](https://github.com/agegr/pi-web) 的第三方桌面封装，**所有 AI 编码能力来自 pi-web 上游**。我们：

- 锁定经过验证的 pi-web 构建版本；下游差异采用“外挂优先”的最小 adapter，而非覆盖上游核心；
- 在其上增加桌面壳（右键菜单、托盘、单实例、崩溃恢复）与移动端互通桥。

下游能力清单、升级 Gate 与迁移原则见 [`docs/pi-web-downstream-delta.md`](docs/pi-web-downstream-delta.md)。

> 如果你也在做 pi-web 的桌面/移动集成，欢迎参考本项目的 `src/mobile-bridge.ts`（版本化 BFF + 配对码认证 + SSE 适配）与 `mobile/` 子项目实践。

---

## License

MIT © dust617
