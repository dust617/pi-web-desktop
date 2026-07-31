# Git 分支约定

本项目保留“本地完整开发历史”和“公开脱敏发布快照”两条独立主线；两者没有共同祖先是发布流程的设计结果，不是分支错误。

## `main`：本地开发主线

- 保存完整项目历史、内部规划和开发提交。
- 日常开发、测试和本地提交都在 `main` 上进行。
- 不要把 `origin/main` 当作普通上游执行 `pull`、merge 或 rebase。

## `origin/main`：公开发布快照

- 对应 GitHub 公共仓库的脱敏版本。
- 由 `scripts/publish-github.mjs` 从当前 `main` 生成快照，重新初始化干净历史后 force-push。
- 不直接在该历史上开发；发布前必须先完成本地验证和脱敏扫描。
- 发布命令：

  ```bash
  node scripts/publish-github.mjs          # 构建并检查快照，不推送
  node scripts/publish-github.mjs --push   # 检查通过后更新公共 main
  ```

## 已退役分支

- 本地 `master` 是早期仅含规划文件的旧历史，已无开发用途并已删除。
- 如需追溯旧内容，优先使用现有备份标签或 Git 历史记录。
