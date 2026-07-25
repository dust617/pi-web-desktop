# Pi Web Desktop：项目计划

> **历史基线（2026-07-21），不再是当前权威计划。** 当前状态见 `.pi/memory/STATUS.md`，稳定事实见 `.pi/memory/FACTS.md`，当前复杂任务见 `task_plan.md`。本文件保留最初桌面薄壳范围，后续移动端/公网中继演进以已验证运行状态和专题文档为准。

## 1. 目标与核心原则

### 目标

将已安装的 Pi Web 转为稳定的 Windows 桌面产品，消除"先开终端、再开浏览器"的使用成本，并补齐外部文件拖入能力。

### 核心原则（优先级从高到低）

1. **稳定优先**：内置并锁定已验证的 pi-web 版本。上游更新不自动影响桌面端，需手动验证后切换。
2. **壳子要薄**：Electron 只做启动、窗口、托盘、preload 桥。pi-web 是黑盒子进程。
3. **简单可维护**：不做多余功能，不引入额外复杂度。
4. **不破坏现有环境**：读取既有 `~/.pi/agent` 配置和会话，不迁移、不修改。

### 成功标准

1. 双击打开独立窗口，不需要终端或浏览器。
2. 读取既有 `~/.pi/agent` 会话和配置。
3. 项目外文件/文件夹可拖入聊天，作为临时外部附件交给 Agent 读取。
4. pi-web 上游更新不会自动破坏桌面端；更新需手动验证后切换。

### 明确不做

- 不 fork pi-web。对 pi-web 源码的唯一修改：`useDragDrop.ts` 加一行 `window.__piDesktop` 检测（唯一例外，已内置锁定版本中，不受上游更新影响）。
- 不接入 Qoder 或其他 Agent。
- 不让外部附件自动复制、移动或删除用户文件。
- 不开放公网端口、不自建账号系统。
- 移动端（Android）在桌面稳定后单独规划，不在本计划内。

## 2. 架构

```text
Pi Web Desktop（Electron，薄壳）
  Main 进程
    - 单实例锁（app.requestSingleInstanceLock）
    - 找空闲端口
    - 用系统 node.exe 启动内置 pi-web：
        node.exe resources/pi-web/bin/pi-web.js --port <动态> -H 127.0.0.1 --no-open
    - 轮询 HTTP 2xx（超时 30 秒）-> 显示 BrowserWindow
    - 托盘图标（最小化/退出）
    - 退出时 taskkill /T /F /PID 清理完整进程树，验证端口已释放
  Preload 桥（唯一注入点，contextIsolation + sandbox）
    - webUtils.getPathForFile(file): 从拖入 File 对象取真实绝对路径
    - showInExplorer(path): 在资源管理器显示（校验路径合法性）
    - selectFolder(): 选择文件夹对话框
  BrowserWindow
    - 加载 http://127.0.0.1:<port>
    - 外链只允许 https:，其余拦截
    - IPC 调用校验发起方（sender frame URL）
```

**pi-web 内置锁定策略**：
- 安装包内含经过验证的 pi-web 版本（resources/pi-web/）
- 不依赖全局 npm 安装，不调用全局 pi-web 命令
- 上游新版本：手动下载 -> 在隔离环境测试 -> 确认兼容后替换 resources/pi-web/ -> 重新打包
- useDragDrop.ts 补丁已包含在锁定版本中，不受上游更新影响

**node.exe 获取策略**：
- 优先从 PATH 找系统 node.exe（`where node`）
- 找不到时显示明确错误：请先安装 Node.js
- 不使用 Electron 自身可执行文件运行 pi-web（打包后会失败）

**附件功能实现方式（正确路径）**：
- 网页拖入 File 对象 -> preload 层调用 `webUtils.getPathForFile(file)` 取真实路径 -> 通过最小化 IPC 返回路径数组
- pi-web `useDragDrop.ts` 加一行检测：若 `window.__piDesktop` 存在则调用，否则走原有图片逻辑
- 附件仅当前会话有效，不持久化
- 发送格式：`[外部附件 - 文件] 路径` / `[外部附件 - 目录] 路径`

## 3. 分阶段交付

### 阶段 0：技术验证与工程骨架（约 1 天）

- 创建 Electron + TypeScript 工程骨架。
- 将当前全局 pi-web 版本复制到 resources/pi-web/（锁定版本）。
- 用系统 node.exe 启动 resources/pi-web/bin/pi-web.js，轮询 HTTP 2xx（超时 30 秒）后加载窗口。
- 验证：端口 30141 已占用时仍能正常启动。
- 验证：既有 `~/.pi/agent` 会话在窗口中正常显示。
- 实现退出时 taskkill /T /F /PID 清理进程树，验证端口已释放。

**通过标准**：30141 已占用时桌面端仍启动并显示历史会话；退出后无残留进程，端口已释放。

### 阶段 1：桌面最小可用版（约 2 天）

- 单实例锁：重复双击只聚焦已有窗口，不启动第二个服务。
- 托盘图标：最小化到托盘、退出、重新启动。
- 窗口状态记忆：保存尺寸和位置。
- 原生菜单：打开项目目录、刷新页面、在资源管理器显示当前项目。
- 启动失败可见提示：端口、子进程退出码，不记录密钥或消息内容。
- IPC 安全：校验 sender frame URL，showInExplorer 限制合法路径，外链只允许 https:。

**通过标准**：无需浏览器/终端，完成新建会话、继续历史会话、安全退出，无残留进程。

### 阶段 2：外部附件（约 3 天）

- Preload 桥用 `webUtils.getPathForFile(file)` 实现路径获取（Electron 官方推荐方式）。
- pi-web `useDragDrop.ts` 加一行检测 `window.__piDesktop?.getDroppedFilePaths`（唯一例外，已在锁定版本中）。
- 聊天输入框旁显示"外部附件"列表：路径、名称、失效状态（文件被移动/删除时标红）。
- 附件仅当前会话有效，不持久化，关闭应用后清空。
- 支持：移除引用、在资源管理器显示、检查路径是否存在。
- 不做：自动复制文件、导入项目、批量操作。

**通过标准**：将项目外文件拖入聊天，Agent 能读取；原文件删除后附件显示失效，应用不崩溃。

### 阶段 3：打包与发布（约 2 天）

- electron-builder 打包 Windows 安装版（NSIS）和便携版。
- 应用内显示：壳子版本、锁定 pi-web 版本。
- 冒烟测试：干净 Windows 环境、端口冲突、离线启动。

**通过标准**：干净环境安装后双击可用；卸载后无残留服务进程。

## 4. 风险与约束

| 风险 | 应对 |
|------|------|
| 系统无 node.exe | 启动时检测，显示明确提示：请先安装 Node.js |
| pi-web 子进程树残留 | taskkill /T /F /PID 清理完整树，退出后验证端口已释放 |
| 启动超时 | 30 秒超时，显示错误对话框，提供重试/退出 |
| Windows SmartScreen 拦截 | 首版接受警告提示，后续考虑代码签名 |
| 多实例启动 | app.requestSingleInstanceLock() 单实例锁 |
| IPC 滥用 | 校验 sender frame URL，限制路径范围，外链只允许 https: |
| 锁定版本过旧 | 手动验证更新流程：下载 -> 隔离测试 -> 替换 -> 重新打包 |

## 5. 工期

| 阶段 | 工期 |
|------|------|
| 阶段 0：技术验证 | 1 天 |
| 阶段 1：最小可用版 | 2 天 |
| 阶段 2：外部附件 | 3 天 |
| 阶段 3：打包发布 | 2 天 |
| **桌面版合计** | **约 8 个工作日** |

## 6. 自主执行边界（定时任务规则）

### 绝对禁止

- 删除 D:\PI-web-desktop 以外的任何文件或目录
- 修改 ~/.pi/agent/ 下任何文件（只读）
- npm install -g（全局安装）
- 需要管理员权限的命令
- 修改 Windows 系统文件、注册表、环境变量
- git push（只本地 commit，人工审核后再推 GitHub）
- 执行 rm -rf、del /f、format 等破坏性命令
- 修改 D:\PI-web-desktop 以外的任何项目或代码
- 用 Electron 自身可执行文件运行 pi-web（必须用系统 node.exe）

### 可以自主决定

- 端口选择策略、npm 包版本（选稳定版）
- 项目内代码结构、文件命名、实现细节
- 错误处理方式、UI 布局细节
- git commit 时机和消息
- 遇到小 bug 自行修复后继续

### 必须停止并记录到 progress.md

- 系统找不到 node.exe
- pi-web 启动后 HTTP 2xx 超时（30 秒）
- 需要修改 pi-web 源码（useDragDrop 那一行除外）
- 磁盘剩余空间 < 5GB
- 需要安装系统级软件
- 阶段完成（记录状态，等待下次运行继续）

### Git 策略

- 工作分支：dev，不在 master 直接开发
- 每完成一个有意义单元即 commit，消息格式：[阶段N] 描述
- 阶段完成时打 tag：phase-0-done、phase-1-done 等
- 不 push，等人工审核

### 备份规则

- 修改任何已存在文件前，先复制到 .backup/<文件名>.<时间戳>
- .backup/ 加入 .gitignore
- git 本身作为主要版本历史

### Token 限额处理

- **每完成一个 git commit 就同步更新 progress.md**（不是等运行结束）
- 下次运行先读 progress.md，从断点继续，不重复已完成工作
- 若感知到 token 接近限额，立即保存状态并停止

## 历史下一步（已失效）

原阶段 0 已完成；不要据此覆盖现有移动端、公网中继和后续安全工作。
