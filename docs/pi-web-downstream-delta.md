# pi-web 下游功能差异与升级保全清单

**基线**：官方 `@agegr/pi-web@0.8.1`（npm `gitHead` `ae58c82…`）；旧定制基线：`.backup/pi-web-0.8.0-old-1785059619147`。

本项目是 pi-web 的 Electron/移动端封装，AI 会话、模型、渲染和核心 API 仍由上游负责。本文件只登记**刻意保留的下游差异**，避免将整个旧目录覆盖到新版本。

## 已登记差异

| 能力 | 上游 0.8.1 | 本项目状态 | 所在层/文件 | 升级验收与移除条件 |
|---|---|---|---|---|
| 会话右键菜单：复制 ID + JSONL 路径 | 无 | 保留 | `components/SessionSidebar.tsx` + `lib/session-copy.ts` | 单测复制文本；人工右键、Esc/外部点击关闭。若上游提供可扩展的行操作 API，迁到独立扩展。 |
| 会话归档/取消归档（含子分支） | 无 | 保留 | `SessionSidebar.tsx` + `app/api/archived-sessions/route.ts` | 测试父会话、后代、重启后的隐藏/显示；归档栏右键“清空归档箱”（取消归档全部，二次点击确认）；计数按当前项目可见归档会话而非全局；删除会话时清理子树陈旧归档 ID。未来迁至 authenticated MobileBridge 或 upstream extension API。 |
| 归档 HTTP route | 无 | 保留 | `app/api/archived-sessions/route.ts` | staged build 必须出现 route；MobileBridge 合同测试 GET/PUT。 |
| Windows Next tracing 隔离 build | 无 | 保留 | `bin/pi-web-build.mjs`、`next.config.ts` | Windows source build；上游修复用户目录 tracing 后删除。 |
| Windows 序列化目录父路径 | 无 | 保留 | `lib/directory-browser.ts` | Windows/Posix 路径单测；上游同等修复后删除。 |
| pi-web 测试入口 | 未提供完整本地入口 | 保留 | `package.json`、`lib/*.test.mjs` | `npm --prefix resources/pi-web test`。 |
| 普通 prompt 发送失败提示 | 上游普通异常静默 | 保留 | `hooks/useAgentSession.ts` + `lib/prompt-failure.ts` | 单测区分“确定未送达”与“状态未确认”；后者保留消息且要求刷新对账。 |
| empty-abort 重试（thinking-only 空中止） | 无 | 保留 | `lib/empty-abort-retry.ts` + `lib/rpc-manager.ts` | 重试只有 thinking 无输出就 aborted 的请求（≤2 次）；单测验证丢弃空 thinking。0.8.7 升级曾因不在 patch manifest 而丢失，已补回。 |
| provider 流诊断/中止追踪 | 无 | 保留 | `lib/session-diagnostics.ts` + `lib/rpc-manager.ts` | 记录 stream_function/abort/core_run 诊断；`session-stops.mjs` 依赖这些痕迹。0.8.7 升级曾丢失（未跟踪），已补回并纳入 manifest。 |
| compaction 后实时尾部保持 | 上游未保留旧 guard | 保留 | `hooks/useAgentSession.ts` | 用户在尾部时 compact 后保持尾部；用户上翻时不强拉。 |
| 模型注册表加载失败提示 | 上游伪装为空成功结果 | 保留 | `app/api/models/route.ts` + `lib/model-load-response.ts` | 单测仅返回固定安全文案，UI 显示 `modelError`。 |
| 本地 Markdown 图片预览 | 已部分吸收 | 不重放旧 patch | 上游功能 + 本项目 smoke | 验证本地/UNC/尺寸限制；仅发现缺口时添加最小适配。 |

## 本次审计发现并已恢复的旧定制能力

以下能力在旧 0.8.0 定制版存在、官方 0.8.1 与初始同步版中没有；它们不是“功能重复而主动删除”。本轮已以独立 helper/薄 adapter 恢复，并纳入 fail-closed staging patch。

| 能力 | 旧代码证据 | 本轮处理 |
|---|---|---|
| 非 SSE 的发送失败提示与会话重新对账 | 旧 `hooks/useAgentSession.ts:1114-1136` | 普通异常保留 optimistic 消息并提示刷新对账；只对确定未送达的 EventStream 错误回滚并恢复输入。 |
| compaction 后停留在实时尾部 | 旧 `hooks/useAgentSession.ts:1027-1033,1579-1598` | 保留用户是否在尾部的 guard；compact reload 后仅在允许自动跟随时恢复尾部。 |
| 模型注册表加载失败的可见安全提示 | 旧 `lib/model-load-response.ts` 及测试 | API 返回固定、不含配置/错误细节的 `modelError`，UI 继续走既有 model error 呈现。 |

## 外挂优先策略（后续修改的硬约束）

1. **上游视为不可改核心**：禁止以旧 `resources/pi-web` 整目录覆盖新版本；不得把本项目流程、认证或 Electron 逻辑塞进上游会话/模型核心。
2. **先选外层**：新能力优先放在 Electron `src/`、MobileBridge、独立 API route、preload、独立组件/utility；能用配置、事件或代理解决时，不改 pi-web 内部组件。
3. **需要 UI 挂点时只留薄 adapter**：本次 `SessionSidebar` 是现存例外。状态、格式化、持久化应拆到独立小模块；上游文件只保留导入、事件挂点和渲染槽位。禁止复制整段上游组件逻辑。
4. **每个下游 patch 必须可回答五件事**：目的、上游状态、受影响文件、自动/人工验收、删除/迁移条件；同时登记到 `scripts/pi-web-patch-manifest.json`（可自动套用者）或本表（UI adapter）。
5. **升级先审计后合并**：新 upstream → 干净 stage → 应用 manifest patch → `diff` 旧定制/当前/上游 → 更新本表 → build + unit + MobileBridge 合同 + desktop smoke + package parity。任何一项失败不得 swap。
6. **不适配也不拖垮主功能**：外层能力必须 fail-safe；如归档 API 不可用，正常会话列表、桌面和移动端不能失效。

## 已采用的参考来源与边界

| 来源 | 实际采用/参考 | 未采用 |
|---|---|---|
| 官方 `agegr/pi-web` 0.8.1、Pi SDK | 本项目 pi-web UI/API/CLI 的唯一上游基线；升级带来目录选择器、输入历史、模型错误显示、安全与渲染能力。 | 不把本项目的桌面/移动代码混入上游核心。 |
| Electron、Next.js、Node 标准 API | 壳进程管理、打包、PWA 与 build/tracing 适配。 | 无第三方桌面壳代码直接移植。 |
| `andrewyng/openworker@db93d75` | 仅在 v0.2.0 规划中参考“受管 sidecar、明确 ownership、错误隔离/诊断”架构思想。 | 未复制其 Tauri/Python/SQLite/SecretStore、connector/persona/自动任务平台代码或产品设计。 |
| 本项目历史版本与真实故障复现 | 移动端历史/SSE、PWA 更新、会话锚点、归档等修复来自本项目运行时问题和旧实现。 | 不把未经复验的历史行为标为当前已保留。 |

## 本轮 0.8.1 升级实际改进

- 锁定官方 0.8.1 provenance，使用隔离 `npm ci`、source build 和 fail-closed stage，禁止借用 upstream `.next`。
- 保留 archived-sessions 下游 route，修复 Windows tracing/路径序列化，补 build/test 入口。
- Runtime 改用 `PI_WEB_HOSTNAME`、Node `>=22.19.0` 预检；执行 active/staged build、pi-web unit、MobileBridge/desktop/package 回归。
- 修复 frpc 受管生命周期：starting readiness、日志 chunk、非重试错误阻断、退避/crash-loop 测试。
- 本轮补回会话右键复制/归档、普通发送失败提示、compaction 尾部保持与安全模型加载错误；移动端末条问题锚点在 history 未应用时有 session-safe 的一次重试。

> 更新本文件不代表所有旧能力已恢复；“尚未恢复”表是下次升级前的必查项。
