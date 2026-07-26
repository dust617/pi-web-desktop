# 当前任务进度

- [2026-07-26] 规划会话完成，产出 NEXT_VERSION_PLAN.md
- [2026-07-26] 工作清单拆解完成，P0 项已修复（contract 热重载、test:package asar）
- [2026-07-26] P0 全部完成，commit 0d8eee8。下一步: P1 pi-web 0.8.1 锁定适配
- [2026-07-26] P0–P2 复验：mobile 88/88、tunnel 29/29 通过；package parity、memory 与 pi-web unit Gate 失败。P1 staging 为 upstream artifact fallback 且缺归档路由；P2 有真实 frpc readiness 死锁。已进入修复阶段。
- [2026-07-26] P0–P2 修复完成：fail-closed staged 0.8.1 source build（BUILD_ID K3JEWNYMYope0rJKVblmj）和 140 项 staged pi-web test 通过；active runtime smoke、package 6/6、mobile 88/88、memory、tunnel 37/37 均通过。发布前仍需 staged MobileBridge 合同与 rollback 安装人工演练。
- [2026-07-26] P7 功能保全完成：五项升级遗漏全部恢复——会话右键复制（Session ID + JSONL 路径）、归档/取消归档、普通发送状态未确认提示、compaction 尾部保持、模型加载安全错误提示；移动端桌面发言锚点采用 generation-safe 一次重试。新增 UI adapter fail-closed patch，staged 0.8.1 source build 与 143 项测试通过；active pi-web 143、mobile 89、package 6、memory、tunnel 37 全通过。
- [2026-07-26] 提交前检查：完整 `git diff --check` 会报告 Next 生成的 minified `.next/server/chunks/2325.js` 内置 trailing whitespace；非生成源码检查通过，因此提交时保留经过 build 验证的 `.next`，并对其排除 whitespace lint。
- [2026-07-26] P8 核查完成：校正全部 Token Plan 对话模型 context/max output，移除误配图像模型，迁移明文凭据到权限受限 auth；Codex 改 SSE，timeout 600s，agent retry 2 次。模型清单、认证探针、全部压缩阈值、Qwen/GPT smoke 均通过；跨 provider 仍要求新会话，compact transport 为 0.82.1 残余限制。
