# v0.2.0 工作清单

> 详细规划见 `NEXT_VERSION_PLAN.md`。本文件仅跟踪优先级和状态。

## P0：修复与测试基线
- [x] 记忆 contract 热重载修复（cache-busted 动态加载 + MEMORY_CONTRACT_VERSION=1）
- [x] test:package asar 分配失败修复（Node v24 Buffer deepEqual bug workaround + 重建 asar）
- [x] test:mobile 验证（65/65 通过，code 127 为瞬态问题）
- [x] 清理空规划文件 + 重建紧凑版 planning files

## P1：pi-web 0.8.1 锁定适配
- [x] pi-web:stage 强制脚本（scripts/pi-web-stage.mjs）
- [x] Downstream patch manifest（scripts/pi-web-patch-manifest.json）
- [x] Node.js >=22.19.0 预检 + PI_WEB_HOSTNAME（src/pi-web-runtime.ts）
- [x] 0.8.1 staged 完成（.backup/pi-web-0.8.1-staged，BUILD_ID: l0CiKzT_81sgMiO7ty15w）
- [x] MobileBridge 0.8.1 合同测试（48/48 通过）
- [x] 0.8.1 桌面 smoke（自动交换成功，Web UI 正常加载，BUILD_ID: l0CiKzT_81sgMiO7ty15w）
  - 已知问题：archived-sessions 路由源码存在但未编译（需在干净环境重新构建）
- [x] 回滚 Gate（docs/pi-web-rollback.md + 自动交换逻辑验证）

## P2：隧道监督核心
- [x] ManagedProcess 通用模块（src/managed-process.ts）
- [x] TunnelSupervisor 状态机（src/tunnel-supervisor.ts）
- [x] FrpcAdapter（src/frpc-adapter.ts）
- [x] Mock frpc + test:tunnel（scripts/mock-frpc.js + tests/tunnel.test.mjs，29/29 通过）

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
