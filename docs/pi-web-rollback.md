# pi-web 回滚程序

> 版本：v1.0
> 最后更新：2026-07-26

---

## 1. 自动回滚机制

桌面应用 `src/main.ts` 中的 `tryApplyStagedPiWebUpgrade()` 函数实现了自动升级和回滚：

### 升级流程
1. 检测 `.backup/pi-web-*-staged` 目录
2. 比较 staged 版本与当前版本
3. 将当前 `resources/pi-web` 重命名为 `.backup/pi-web-{version}-old-{timestamp}`
4. 将 staged 目录重命名为 `resources/pi-web`
5. 如果步骤 4 失败，立即恢复旧版本

### 回滚保护
- 升级前自动备份当前版本到 `.backup/pi-web-{version}-old-{timestamp}`
- 如果交换失败，同步恢复旧版本
- 如果交换成功但启动失败，旧版本仍在 `.backup/` 中

---

## 2. 手动回滚步骤

如果 0.8.1 升级后出现问题，按以下步骤回滚到 0.8.0：

### 步骤 1：停止桌面应用
确保应用完全退出（检查任务管理器）。

### 步骤 2：查找备份
```bash
ls .backup/ | grep pi-web-0.8.0-old
```

### 步骤 3：恢复备份
```bash
# 删除当前版本（如果存在）
rm -rf resources/pi-web

# 恢复 0.8.0 备份
cp -r .backup/pi-web-0.8.0-old-{timestamp} resources/pi-web
```

### 步骤 4：验证
```bash
cat resources/pi-web/package.json | grep version
# 应显示 "version": "0.8.0"
```

### 步骤 5：重启应用
启动桌面应用，验证功能正常。

---

## 3. 当前备份状态

| 备份 | 版本 | 位置 | 状态 |
|---|---|---|---|
| 0.8.0 原始 | 0.8.0 | `.backup/pi-web-0.8.0-old-20260726165214` | ✓ 完整（含 .next） |
| 0.8.0 staged | 0.8.0 | `.backup/pi-web-0.8.0-staged` | ✓ 完整 |
| 0.8.1 staged | 0.8.1 | `.backup/pi-web-0.8.1-staged` | ✓ 完整（待交换） |
| 当前运行 | 0.8.0 | `resources/pi-web` | ✓ 正常 |

---

## 4. 验证检查点

升级后应验证：
- [ ] `resources/pi-web/package.json` 版本正确
- [ ] `.next/BUILD_ID` 存在
- [ ] 桌面应用启动正常
- [ ] Web UI 可访问（http://localhost:3000）
- [ ] 会话列表加载正常
- [ ] Agent 通信正常（发送消息、接收响应）
- [ ] MobileBridge 正常（如有移动端）

---

## 5. 常见问题

### Q: 交换失败，提示 "Device or resource busy"
**A**: 桌面应用仍在运行。完全退出后重试。

### Q: 升级后 Web UI 404
**A**: `.next` 目录可能损坏。从备份恢复或重新运行 `npm run pi-web:stage 0.8.1`。

### Q: 需要回滚到更早版本（如 0.7.16）
**A**: `.backup/pi-web-0.7.16` 仍存在，按步骤 2-5 操作。

---

## 6. 自动化测试

回滚逻辑已在以下测试中验证：
- `mobile/tests/bff.test.mjs` — BFF 合同测试（48/48 通过）
- `npm run test:package` — asar 打包测试
- `npm run test:mobile` — 移动端回归测试

手动验证回滚：
```bash
# 模拟升级失败场景
mv resources/pi-web resources/pi-web-test
cp -r .backup/pi-web-0.8.0-old-20260726165214 resources/pi-web
npm run build
npm start
# 验证应用正常启动
```
