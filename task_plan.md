# v0.2.0 工作清单

> 详细规划见 `NEXT_VERSION_PLAN.md`。本文件仅跟踪优先级和状态。

## P0：修复与测试基线（已复验）
- [x] 重建 installer/portable 后 `test:package` 6/6 通过
- [x] `test:memory` 与 `memory:check` 通过，contract 热重载回归可运行
- [x] 当前 mobile 回归：88/88 通过
- [x] 更新验证计数与进度记录

## P1：pi-web 0.8.1 锁定适配（已修复，待人工发布决策）
- [x] staging 删除 upstream `.next` fallback；源码 build/route/test 任一失败均阻止 swap
- [x] 隔离 stage 完成 `npm ci`、source build、归档路由编译、140 项 pi-web 测试
- [x] active pi-web 依赖树恢复，Windows 路径单测与 source build 通过
- [x] active desktop runtime smoke 通过；stage manifest 记录 build/test/compiled route
- [ ] staged MobileBridge 合同与正式 rollback 安装演练（发布前人工 Gate）

## P2：隧道监督核心（已复验）
- [x] 修复 ManagedProcess/FrpcAdapter readiness 死锁、chunk 重组与 child 日志监听
- [x] FrpcAdapter 使用 EventEmitter，并对日志/错误摘要脱敏
- [x] mock-frpc 覆盖 fragmented success、auth、network 与 crash-loop
- [x] `test:tunnel` 37/37 通过

## P3：安全配置与打包
- [ ] safeStorage 秘密管理
- [ ] frpc 二进制供应链
- [ ] HTTPS 拓扑验证

## P4：生命周期与稳定性
- [ ] DesktopLifecycleCoordinator
- [ ] HealthAggregator + 诊断日志
- [ ] 稳定性测试（sleep/wake/soak）

## P5：桌面体验
- [ ] 设置页 + 托盘菜单增强
- [ ] 旧 BAT 迁移工具

## P6：发布
- [ ] 版本升级 0.2.0 + installer/portable
- [ ] 文档 + beta feature flag

## P7：pi-web 升级功能保全与扩展边界（已完成，待提交）
- [x] 审计 0.8.0 定制版、官方 0.8.1 与当前版的功能差异
- [x] 恢复会话右键菜单：带标签复制 Session ID/JSONL 路径，及归档/取消归档
- [x] 修正移动端桌面发言后的末条问题锚点重试，并补回归测试
- [x] 恢复普通发送失败提示、compaction 尾部保持、模型加载失败提示并补回归
- [x] 写入下游功能差异清单与“外挂优先”升级/实现策略；UI adapter patch 纳入 fail-closed staging
- [x] 完成 active/staged build、pi-web、mobile、package、memory、tunnel Gate；检查提交内容并提交
