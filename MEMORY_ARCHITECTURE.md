# Pi-Web-Desktop 记忆架构

> 版本: 2026-07-26。目标是跨 session 连续、容量有界、无秘密值、能在 provider/模型故障时恢复。

## 1. Pi 实际加载机制

Pi 0.81.1 启动时自动加载：

1. `~/.pi/agent/AGENTS.md`；
2. 从文件系统根到 cwd，每层最多一个 `AGENTS.md/AGENTS.MD/CLAUDE.md/CLAUDE.MD`；
3. 同目录中 `AGENTS.md` 优先。

这些内容进入所有 Pi 模型的同一 system prompt。`STATUS.md`、`FACTS.md`、计划和 archive 不会被 Pi 原生自动加载；本项目由 `.pi/extensions/memory-guard/` 在首个实质请求自动注入有界 Brief，领域细节再用 `memory-recall` 读取。模型切换不会触发资源重载；修改 AGENTS 或 Extension 后应执行 `/reload` 或开新 session。

同一 Pi session 的 GPT/Qwen 共用活动分支、system prompt 和 compaction 摘要，并不存在按模型分开的项目记忆。项目 `AGENTS.md` 应视作可能被 Codex 等其他工具共享；Pi 私有的 `~/.pi/agent/` 不能假设被其他工具读取。

## 2. 唯一来源层级

发生冲突时按以下顺序处理：

1. **重新验证的运行状态/真实配置**；
2. `.pi/memory/STATUS.md`：当前状态与最多 6 个下一步；
3. `.pi/memory/FACTS.md`：跨任务稳定事实和凭据位置；
4. 当前任务的 `task_plan.md`、`findings.md`、`progress.md`；
5. 专题 runbook/设计文档；
6. `archive/` 与 session transcript：只作历史证据。

一个当前事实只允许一个活动版本；其他文件使用路径或事实编号引用。更新事实时用新条目的 `Replaces: F-xxx` 替代当前版本，旧条目只供追溯且不参与 recall。发现冲突时先复验再替代，禁止保留两个活动真相。

## 3. 文件职责与硬限制

| 文件 | 作用 | 硬限制 | 生命周期 |
|---|---|---:|---|
| 全局 `~/.pi/agent/AGENTS.md` | 跨项目通用 Pi 安全规则 | 2 KiB / 40 行 | 稳定、极少变更 |
| 项目 `AGENTS.md` | 构建、安全、记忆入口 | 4 KiB / 80 行 | 可提交，禁止动态事实/秘密 |
| `.pi/memory/STATUS.md` | 当前快照、阻塞、6 个下一步 | 2 KiB / 32 行 | 覆写；运行事实 7 天复验 |
| `.pi/memory/FACTS.md` | 稳定拓扑、配置路径、结论 | 64 KiB / 800 行（约 100 条） | `memory-save` 追加；Source/Verified/TTL/Replaces |
| `task_plan.md` | 当前复杂任务步骤 | 4 KiB / 80 行 | 每个任务一份 |
| `findings.md` | 当前任务证据/决策 | 12 KiB / 20 条 | 任务完成整包归档 |
| `progress.md` | 当前任务最近里程碑 | 2 KiB / 8 条 | 任务完成整包归档 |
| `archive/` | 冷任务包 | 1 MiB / 50 包 | 从不自动读取，不静默删除 |

`.pi/memory/` 与 `archive/` 是本机运维记忆，加入 `.gitignore`。项目 AGENTS 与本架构文档不含私人拓扑细节，可在人工审核后提交。

## 4. 启动、写入和交接

### 新独立 session

1. Pi 自动取得 AGENTS；纯问候不触发项目记忆。
2. 首个实质请求由 memory-guard 注入 STATUS 摘要与少量匹配事实；Brief 按当前 session ID 去重，fork 会获得新 Brief。
3. 已有 Brief 时不重复做无标签 recall；需要领域细节才调用 `memory-recall(tags)`。
4. 复杂任务再读当前三件套；修改记忆前后运行 `npm run memory:check`。

### 写入

- 新当前状态：原位覆写 STATUS，不追加历史。
- 新稳定事实：用 `memory-save` 写入，必须提供安全 Source；更新用 `Replaces`，只允许替代当前版本。
- FACTS/INBOX 写入经过进程内队列、跨进程锁和原子替换；不要绕过工具并发改写。
- 当前任务证据：写 findings；里程碑写 progress；计划变化写 task_plan。
- 每次修改后运行 `npm run memory:check`；校验失败时不得删除 session 或继续归档。

### 完成任务

运行 `npm run memory:archive -- <slug>`。工具先校验，再把三件套复制到 `archive/tasks/YYYY-MM-DD-<slug>/`，写 SHA-256 manifest，最后重置三件套。达到 archive 上限时失败关闭，由人把最旧任务包移到外部/Obsidian，不自动删除。

## 5. 模型切换与 compaction

- 不使用固定“70%”猜测；以运行时目标模型窗口和 `/session` 活动上下文为准。
- 跨 provider/model family 时，使用 `/model-handoff <provider/model> [intent]`；它保留旧 session、创建干净子 session、设定目标模型并要求新 session 读取项目检查点。命令不可用时，先写 STATUS 检查点，再手动开同 cwd 的新 session。
- `/compact` 是当前 provider 的一次 LLM 调用，不是本地截断；网络、地区、认证、thinking 能力错误不会被 compaction 修复。
- compaction 最多尝试一次；失败时保留原 session，改用干净 session 读取检查点，不循环重试。
- Qwen 3.8 必须保持 thinking 开启。GPT 5.6 的 272K 是当前 `openai-codex` 已验证值；1.05M 在该路径未验证，不为迁就历史而虚报元数据。

## 6. Session 保留与删除

- 重要 session 先命名；当前 session 不在同一次运行中更新记忆后立即删除。
- 仅清理已完成、未固定、非当前且超过 30 天的 session；保留最多 20 个普通历史和 5 个固定历史是建议上限，不启用自动清理。
- 删除前：更新 STATUS/FACTS、运行校验、必要时 `/export` 到被忽略的 `session-exports/`。
- pi-web 当前删除会真实 unlink；移动端在有导出/归档保护前不增加删除按钮。

## 7. 凭据与 Git

记忆中只允许符号引用、被忽略文件路径和“待轮换”状态。禁止凭据 UUID、密码、API token、认证头、cookie、私钥、VLESS URL、六位配对码以及 `secret=...` 值。保存参数必须为单行，防止注入 FACTS 结构；Brief/recall/review 在读取时再次扫描，发现风险即停止输出原文并提示安全清理。

旧工作区和 Git 历史曾出现凭据样式值。清理工作树和 `.gitignore` 不能抹掉历史；仍有效的值必须轮换。是否重写已共享 Git 历史必须单独评估，不能在本次迁移中自动执行。

## 8. 子代理与 Obsidian

- pi-subagents `agent-memory` 是特定角色的可选经验库，不是主项目 STATUS/FACTS，也不自动回写父 session。
- 当前版本的项目上下文剥离与 Pi XML prompt 可能不兼容；修复前不要假设 fresh reviewer 看不到项目 AGENTS。
- Obsidian 只保存去敏、跨项目可复用的长期知识；每条注明 Source 和 Last verified。不要自动双向同步当前状态或凭据，避免第二真相源。

## 9. 自动校验

`npm run memory:check` 检查：字节/行/条目上限、活动事实 TTL、Fact ID/Replaces、遗留 STATUS/KEYSTORE、整个记忆文本层的秘密模式、临时文件、归档总量以及 `.gitignore`。被替代事实不再因 TTL 阻塞校验，但仍检查格式、引用和敏感信息。`npm run test:memory` 验证 Extension 注入、召回、保存、安全拒绝和并发写入。

这套机制刻意不做“无限自动记忆”：活动层始终小，超限时失败关闭并要求归档/合并，冷层按需检索。
