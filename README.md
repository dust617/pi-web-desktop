# Pi Web Desktop

[Pi Web](https://github.com/agegr/pi-web) 的 Windows 桌面壳 —— 基于 Electron，支持**右键菜单一键打开项目目录**。

## 功能

- 🖱️ **右键打开**：在资源管理器中右键文件夹 →「在此打开 Pi Web」，直接以该目录为工作区启动
- 🔄 **项目热切换**：已运行时再次右键其他文件夹，自动切换工作目录，无需重启
- 📁 **单实例管理**：始终只有一个窗口，多次右键自动聚焦并切换
- 💾 **窗口状态记忆**：位置、大小、最大化状态跨启动保留
- 🛡️ **崩溃恢复**：pi-web 进程意外退出时提示一键重启

## 快速开始

### 环境要求

- Windows 10/11
- Node.js ≥ 18
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

## 工作原理

```
资源管理器右键
  └─→ electron.exe --project "D:\目标目录"
        └─→ 单实例锁 additionalData 传递给主实例
              └─→ 调用 pi-web /api/cwd/validate 设置全局 cwd
                    └─→ 导航到 /?cwd=D:\目标目录
                          └─→ 前端初始化 newSessionCwd，进入目标目录新会话
```

### 关于 `?cwd=` 补丁

pi-web 原生不支持通过 URL 查询参数指定初始工作目录。本项目对两份前端构建产物做了最小补丁：

| 文件 | 修改 |
|------|------|
| `.next/static/chunks/app/page-*.js` | `newSessionCwd` 初始值从 `useSearchParams().get("cwd")` 读取 |
| `.next/server/app/page.js` | SSR 侧同步初始化，避免 hydration 闪烁 |

补丁仅影响初始状态，不改变 pi-web 的任何 API 或会话逻辑。

> 💡 已向 pi-web 上游提交 Feature Request，建议原生支持 `?cwd=` 参数。

## 项目结构

```
pi-web-desktop/
├── src/
│   ├── main.ts              # Electron 主进程（窗口、托盘、右键注册、项目切换）
│   ├── pi-web-runtime.ts    # pi-web 子进程管理（启动、停止、端口分配）
│   └── preload.ts           # 预加载脚本（IPC 桥接）
├── resources/
│   └── pi-web/              # 锁定的 pi-web 运行时（含 ?cwd= 补丁）
│       ├── bin/pi-web.js
│       ├── .next/           # Next.js 构建产物
│       └── package.json
├── package.json
└── tsconfig.json
```

## 技术栈

- **Electron** 37 – 桌面壳
- **TypeScript** 5.9 – 主进程代码
- **pi-web** 0.7.16 (pi 0.80.10) – AI 编码助手 Web UI
- **Next.js** 16 – pi-web 前端框架

## License

MIT
