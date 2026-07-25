# Progress

## Done
- 项目状态核查：8 个核心文件未提交变更、dist/release 过期、pi-web 已升级到 0.8.0
- Phase A: `npm run build` (tsc 零错误) + `npm run test:mobile` (65/65 passed)
- Phase B: 清理 .next.failed (115MB) + `git add -A && git commit` → `c3c646e` (701 files, +55664/-7425)
- Phase C: `npm run dist` 首次用 37.10.3 (electron-builder 从 node_modules 读版本); patch package.json 到 40.10.6 后重新打包成功; `npm run test:package` 6/6 passed
- Phase D: STATUS.md 更新、node_modules/electron 版本还原 37.10.3

## In Progress
- (无)

## Blocked
- Electron 冷切换: 当前 37.10.3 进程锁定 node_modules/electron/dist/, 需关闭实例后 `npm install electron@40.10.6` 再验证

## 待办
- Electron 40.10.6 冷切验证 (关闭 → npm install → 启动 → smoke test)
- 凭据轮换
- frpc 心跳 24h 观察
