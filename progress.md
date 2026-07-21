# progress.md

## 2026-07-22 资源管理器右键切换项目排查
- 已确认右键注册命令能把目标目录传给第二 Electron 进程。
- 已定位第二实例 argv 重排、双消费者、旧 URL 刷新、runtime 退出竞态及会话 cwd/全局 cwd 错位。
- 当前未重启 Electron，避免中断正在进行的交互会话。
- 已实现：additionalData 单实例传递、原子 pending 备用信号、请求 ID 去重与串行队列、目标 cwd 空会话创建并导航到 `?session=`、动态 origin 校验、runtime 启动/退出竞态修复。
- 当前未重启 Electron，避免中断正在进行的交互会话。
- TypeScript 编译已通过。
- 独立 runtime/API 冒烟首次失败：目标为 `.test/右键项目测试`，新会话元数据 cwd 却是 `resources/pi-web`；测试已正常清理独立服务。
- 已确认空会话在首条助手消息前不会落盘，`?session=` 预创建方案不可用，已撤回该实现。
- 已改为 pi-web 原生新会话状态：桌面端导航 `/?cwd=<目标>`；客户端和 SSR bundle 从 cwd 查询参数初始化 newSessionCwd，并阻止历史会话自动覆盖。
- 重新编译、客户端/SSR bundle 语法检查均已通过。
- 隐藏 Electron 冒烟第 1 次因继承 `ELECTRON_RUN_AS_NODE` 而以 Node 模式启动失败；临时服务已清理。
- 第 2 次页面正文已正确显示目标中文路径，但测试因额外要求 document.title 同步变化而判失败；标题不是 cwd 正确性的必要条件。
- 第 3 次以目标目录标记文件验证通过：页面同时显示中文 cwd 和 `当前项目标记.txt`。
- 最终审查项已修：runtime 启动 generation/错误与提前退出竞速、每请求独立 fallback spool、IPC/弹窗精确 origin。
- 最终 TypeScript/bundle 检查通过；注册表命令最终输出验证为 `@="\"D:\\\\...electron.exe\" ... --project \"%1\""`。
- 独立启动取消→立即重启测试通过，旧进程退出未覆盖新 runtime 状态。
- 当前任务代码完成；未强杀正在承载本会话的 Electron，真实 Explorer 右键验收需用户重启桌面端后执行。

## 2026-07-21 22:55
- 当前阶段：2 完成
- 本次完成：
  - 阶段0：Electron骨架、锁定pi-web、node.exe启动、HTTP 2xx、taskkill进程树、端口释放
  - 阶段1：托盘图标（最小化/重启/退出）、窗口状态记忆、增强菜单、启动失败详情对话框
  - 阶段2：外部附件面板（preload注入）、webUtils.getPathForFile、附件列表UI、失效标红、资源管理器、check-file-exists IPC
  - chunk JS语法修复（literal LF → \n转义）
  - tsconfig加DOM lib
  - 冒烟测试全部通过（3轮）
- 冒烟测试：通过
- 下一步：阶段3 - electron-builder打包（NSIS安装版+便携版），明天执行
- 状态：阶段2完成，今晚停止（打包不在今晚范围）

## 2026-07-21 22:40
- 当前阶段：0
- 本次完成：Electron骨架、resources/pi-web锁定副本、useDragDrop补丁、chunk语法修复、node.exe启动、taskkill、webUtils拖拽、IPC校验、https外链
- 冒烟测试：通过（第1轮）
- 状态：阶段0完成

## 2026-07-21 15:30（计划定稿）
- 当前阶段：0（未开始）
- 本次完成：计划全面修订，确认内置锁定 pi-web 方案，同步所有连续性文档
- 状态：等待定时任务执行
