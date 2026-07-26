# 任务：pi-web-desktop 公开发布（桌面端 + 移动端子项目）

## 目标
本地保留**未脱敏完整版**；通过发布管线生成**脱敏快照 + 全新干净历史**推送到公开 GitHub。
桌面端与移动端一起发布，移动端作为子项目。重写 README（详细功能/特点，标明移动端适配）。
起草给 pi-web 主项目（agegr/pi-web）的推荐说明（@ 参考），发布前需用户确认。

## 关键决策
- 不用 git filter-repo（未安装）。改用「快照 + 全新历史」：旧推送历史本就干净，force-push 干净历史即可。
- 脱敏替换映射存于 gitignored 的 `publish/desensitize-map.json`（含真实值，仅本地）。
- 发布管线脚本 `scripts/publish-github.mjs`（tracked，不含真实秘密，读 map 文件）。
- 内部运维文档（STATUS_HANDOFF / 审计报告 / handoff / planning / 日志）不发布。

## 阶段
- [x] 阶段1：全量敏感信息扫描（当前树 + 历史 + 已推送版本）— 完成
- [x] 阶段2：确认已推送 GitHub 版本干净 — 完成（origin/main 树/历史 0 命中）
- [ ] 阶段3：编写发布管线（desensitize-map.json + publish-github.mjs + .gitignore）
- [ ] 阶段4：重写 README（桌面+移动，详细功能），整理 mobile/README 子项目说明
- [ ] 阶段5：本地生成脱敏快照并复扫验证 0 命中（推送前）
- [ ] 阶段6：用户确认后 force-push 公开仓库
- [ ] 阶段7：起草给 agegr/pi-web 的推荐 issue/discussion（用户确认后发布）

## 遇到的错误
| 错误 | 次数 | 解决 |
|------|------|------|
| memory-save 报 findMemoryControlRisk is not a function | 1 | memory-guard 扩展内部 bug，改用本地 DESENSITIZE_REPORT.md 落盘 |
| git log -p 扫描被 mermaid SVG/打包 JS 坐标污染 | 多次 | 改用 git grep <tree> 精确扫描，限制文件类型 |
