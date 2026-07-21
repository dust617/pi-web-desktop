# Pi Web Desktop：项目计划

## 1. 目标与核心原则

### 目标

将已安装的 Pi Web 转为稳定的 Windows 桌面产品，消除"先开终端、再开浏览器"的使用成本，并补齐外部文件拖入能力。

### 核心原则（优先级从高到低）

1. **壳子要薄**：Electron 只做启动、窗口、托盘、preload 桥。pi-web 是黑盒子进程，壳子不依赖 pi-web 内部实现。
2. **升级零改动**：pi-web 或 pi 升级时，用户只需 `npm update -g @agegr/pi-web`，壳子代码不需要任何修改。
3. **简单稳定**：不做多余功能，不引入额外复杂度。
4. **不破坏现有环境**：读取既有 `~/.pi/agent` 配置和会话，不迁移、不修改。

### 成功标准

1. 双击打开独立窗口，不需要终端或浏览器。
2. 读取既有 `~/.pi/agent` 会话和配置。
3. 项目外文件/文件夹可拖入聊天，作为临时外部附件交给 Agent 读取。
4. pi-web 升级后，壳子无需任何代码改动即可继续使用。

### 明确不做

- 不 fork pi-web。对 pi-web 源码的唯一修改：`useDragDrop.ts` 加一行 `window.__piDesktop` 检测（明确标注为唯一例外，pi-web 升级后需重新加这一行）。
- 不接入 Qoder 或其他 Agent。
- 不让外部附件自动复制、移动或删除用户文件。
- 不开放公网端口、不自建账号系统。
- 移动端（Android）在桌面稳定后单独规划，不在本计划内。

## 2. 架构

```text
Pi Web Desktop（Electron，薄壳）
  Main 进程
    - 单实例锁（app.requestSingleInstanceLock）
    - 从 PATH 找 pi-web 命令（找不到则提示用户安装）
    - 找空闲端口 -> 启动 pi-web 子进程
        pi-web --port <动态> --hostname 127.0.0.1 --no-open
    - 轮询 HTTP 200（超时 30 秒）-> 显示 BrowserWindow
    - 托盘图标（最小化/退出）
    - 退出时 kill 子进程
  Preload 桥（唯一注入点）
    - contextBridge 暴露：
        getDroppedFilePaths(): 返回 OS 级拖入文件的绝对路径
        showInExplorer(path): 在资源管理器显示
        selectFolder(): 选择文件夹对话框
  BrowserWindow
    - 加载 http://127.0.0.1:<port>（pi-web 原生界面，不做任何修改）
```

**pi-web 升级流程**：用户执行 `npm update -g @agegr/pi-web` -> 壳子代码零改动，直接生效。

**附件功能实现方式**：Electron 在 OS 层拦截文件拖放，拿到真实绝对路径（浏览器安全限制拿不到），通过 preload 桥暴露给页面。pi-web 的 `useDragDrop.ts` 加一行检测：若 `window.__piDesktop` 存在则调用，否则走原有图片逻辑。**【唯一例外：pi-web 升级后需重新加此行，< 1 分钟】**

## 3. 分阶段交付

### 阶段 0：技术验证（约 1 天）

- 创建 Electron + TypeScript 工程骨架。
- 验证：从 PATH 找 pi-web，以子进程启动 `pi-web --port <动态> -H 127.0.0.1 --no-open`，轮询 HTTP 200（超时 30 秒）后加载窗口。
- 验证：端口 30141 已占用时仍能正常启动。
- 验证：既有 `~/.pi/agent` 会话在窗口中正常显示。

**通过标准**：本机 30141 已占用，桌面端仍启动并显示历史会话。

### 阶段 1：桌面最小可用版（约 2 天）

- 单实例锁：重复双击只聚焦已有窗口，不启动第二个服务。
- 托盘图标：最小化到托盘、退出、重新启动。
- 窗口状态记忆：保存尺寸和位置。
- 原生菜单：打开项目目录、刷新页面、在资源管理器显示当前项目。
- 启动失败可见提示：端口、子进程退出码，不记录密钥或消息内容。

**通过标准**：无需浏览器/终端，完成新建会话、继续历史会话、安全退出，无残留进程。

### 阶段 2：外部附件（约 3 天）

- Preload 桥实现 `getDroppedFilePaths()`：Electron main 进程监听 OS 级拖放事件，返回绝对路径数组。
- pi-web `useDragDrop.ts` 加一行检测：`window.__piDesktop?.getDroppedFilePaths`，有则用，无则走原有图片逻辑（向后兼容）。**【唯一例外：pi-web 升级后需重新加此行】**
- 聊天输入框旁显示"外部附件"列表：路径、名称、失效状态（文件被移动/删除时标红）。
- 附件仅当前会话有效，不持久化，关闭应用后清空。
- 发送消息时附件以下列固定格式附入提示：
  ```
  [外部附件 - 文件] C:/Users/xxx/document.pdf
  [外部附件 - 目录] D:/reference/specs/
  ```
- 支持：移除引用、在资源管理器显示、检查路径是否存在。
- 不做：自动复制文件、导入项目、批量操作。

**通过标准**：将项目外文件拖入聊天，Agent 能读取；原文件删除后附件显示失效，应用不崩溃。

### 阶段 3：打包与发布（约 2 天）

- electron-builder 打包 Windows 安装版（NSIS）和便携版。
- 应用内显示：壳子版本、pi-web 版本。
- 冒烟测试：干净 Windows 环境、端口冲突、离线启动、已有全局 pi-web。

**通过标准**：干净环境安装后双击可用；卸载后无残留服务进程。

## 4. 风险与约束

| 风险 | 应对 |
|------|------|
| pi-web 升级后 useDragDrop 那一行消失 | 明确标注为唯一例外，升级后手动重新加一行（< 1 分钟） |
| PATH 中找不到 pi-web | 启动时检测，显示明确提示：请先 npm install -g @agegr/pi-web |
| Windows SmartScreen 拦截未签名应用 | 首版接受警告提示，后续考虑代码签名 |
| 子进程崩溃 | 检测退出码，显示错误对话框，提供重启按钮 |
| 多实例启动 | app.requestSingleInstanceLock() 单实例锁 |
| pi-web 启动超时 | 30 秒超时，显示错误对话框，提供重试/退出 |

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

- 删除 D:/PI-web-desktop 以外的任何文件或目录
- 修改 ~/.pi/agent/ 下的任何文件（只读，不写）
- 安装全局 npm 包（npm install -g）
- 运行需要管理员权限的命令
- 修改 Windows 系统文件、注册表、环境变量
- git push（只做本地 commit，人工审核后再推 GitHub）
- 执行 rm -rf、del /f、format 等破坏性命令
- 修改 D:/PI-web-desktop 以外的任何项目或代码

### 可以自主决定

- 端口选择策略、npm 包版本（选稳定版）
- 项目内代码结构、文件命名、实现细节
- 错误处理方式、UI 布局细节
- git commit 时机和消息
- 遇到小 bug 自行修复后继续

### 必须停止并记录到 progress.md

- pi-web CLI 接口与预期不符（--port/--hostname 不可用）
- 需要修改 pi-web 源码（违反核心原则，useDragDrop 那一行除外）
- 磁盘剩余空间 < 5GB
- 需要安装系统级软件
- 任何可能影响系统稳定性的操作
- 阶段完成（记录完成状态，等待下次运行继续）

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

## 当前下一步

建立 Electron 工程骨架，验证从 PATH 启动 pi-web 子进程并加载窗口。
