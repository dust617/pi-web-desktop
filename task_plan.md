# task_plan.md

> 权威计划见 PROJECT_PLAN.md。本文件仅为任务清单快照。

## 阶段

- [ ] 阶段 0：技术验证与工程骨架
- [ ] 阶段 1：桌面最小可用版
- [ ] 阶段 2：外部附件
- [ ] 阶段 3：打包与发布

## 今晚任务范围（定时任务）

1. 统一所有计划与连续性文档（以 PROJECT_PLAN.md 为准）
2. 建 Electron 骨架，将全局 pi-web 复制到 resources/pi-web/ 锁定
3. 用系统 node.exe 启动 pi-web，HTTP 2xx 就绪检查（30 秒超时）
4. 实现退出时 taskkill /T /F /PID 清理进程树，验证端口释放
5. 冒烟验证：启动、退出、端口释放三项
6. **完成上述后停止，不进入阶段 1/2/3**

## 当前下一步

阶段 0：建 Electron 骨架，用系统 node.exe 启动内置 pi-web，验证启动/退出/端口释放。
