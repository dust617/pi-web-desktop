# progress.md

## 2026-07-21 22:40
- 当前阶段：0
- 本次完成：
  - Electron 骨架建立（src/main.ts, src/preload.ts, src/pi-web-runtime.ts）
  - resources/pi-web/ 锁定副本已复制（含 .next/ 编译产物）
  - useDragDrop 补丁已应用（window.__piDesktop.getDroppedFilePaths 检测）
  - chunk JS 语法错误修复（literal LF → \n 转义）
  - pi-web-runtime.ts：系统 node.exe 启动、resources/pi-web 路径、HTTP 2xx 严格校验、taskkill /T /F /PID 进程树清理
  - preload.ts：webUtils.getPathForFile 拖拽路径获取
  - main.ts：IPC sender frame 校验、外链只允许 https:
  - 冒烟测试全部通过：HTTP 200 ✅ | 无 SyntaxError ✅ | 无 ChunkLoadError ✅ | 端口释放 ✅
- 冒烟测试：通过（第1轮）
- 下一步：阶段1 - 拖拽路径实际验证（需人工拖文件测试）、文件管理器基础功能
- 状态：阶段0完成

## 2026-07-21 15:30（计划定稿）
- 当前阶段：0（未开始）
- 本次完成：计划全面修订，确认内置锁定 pi-web 方案，同步所有连续性文档
- 下一步：阶段 0 - 建 Electron 骨架，复制 pi-web 到 resources/，用系统 node.exe 启动，验证启动/退出/端口释放
- 状态：等待定时任务执行
