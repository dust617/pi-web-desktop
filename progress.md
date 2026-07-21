# 进度记录

## 2026-07-21

- 创建项目目录并完成桌面优先、移动端后置的项目方案定稿。
- 明确采用 Electron 锁定运行时、手动确认上游更新、临时外部附件引用与 Android 私有组网路线。

### 阶段 0 完成 ✅

- 创建 Electron + TypeScript 工程骨架（`src/main.ts`, `src/preload.ts`, `src/pi-web-runtime.ts`）。
- 实现动态回环端口分配（`findFreePort`），避开已占用的 30141。
- 实现 Pi Web 子进程管理：启动、HTTP 健康探测（轮询至 200）、优雅停止。
- 预加载桥启用 `contextIsolation` + `sandbox`，禁用 `nodeIntegration`。
- 单实例锁、原生菜单（刷新/缩放/开发者工具）、外部链接用系统浏览器打开。
- **验证通过**：Pi Web 在端口 54072 启动，HTTP 200 确认，窗口正常加载。
- 发现并修复 npm `omit=dev` 全局配置导致 devDependencies 不安装的问题（项目级 `.npmrc` 覆盖）。

### 下一步

- 阶段 1：窗口状态持久化、托盘、项目快捷入口、启动诊断日志。
