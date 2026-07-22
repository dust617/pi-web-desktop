# 移动端规划复审进度

## 2026-07-22
- 用户要求重新完整复审移动端规划，优先免费；已确认无 VPS、有免费域名、安卓代理占 VPN/TUN 槽。
- 已读取 `mobile/MOBILE_PLAN.md` 与 `mobile/README.md`。
- 已发现现有计划仍有 Tailscale/Cloudflare 旧描述残留，需整体清理。
- 已建立移动端独立 `task_plan.md / findings.md / progress.md`。
- 已完成第一轮联网核实：Cloudflare Named Tunnel可固定域名但要求域名在Cloudflare；Quick Tunnel仅测试；cloudflared代理能力需实测。
- 已完成PWA/SSE约束核实：原生EventSource不能加自定义Header，计划需改为同源HttpOnly Cookie；SSE需心跳。
- 已完成国内服务核实：cpolar/NATAPP免费层地址随机，不适合长期PWA；SakuraFrp官方提供免费固定nyat.app+SSL且frpc支持代理，但KYC约1元、免费节点无SLA。
- 已识别零隧道Plan B：Telegram Bot长轮询，免费且只出站，但不是独立App、历史体验较弱。
- 已识别架构问题：需稳定`/mobile/api/v1`适配层；手机不能浏览电脑目录；Tunnel模式桥只绑127.0.0.1；移动功能失败不得阻塞桌面主体。
- 三路子审查已完成（一个子任务因声明不可用web_search而状态失败，但本地审查产物完整）；结论已纳入方案。
- 已重写 `mobile/MOBILE_PLAN.md`：loopback版本化BFF、Cookie鉴权、SSE心跳/快照纠偏、有界历史、真实入口先行Gate。
- 用户补充免费域名来自 DigitalPlat；已核实该平台支持外部NS/Cloudflare，候选顺序调整为 Cloudflare Named Tunnel 首测、SakuraFrp 次测。
- 两名独立终审完成：无Gate 0 blocker；技术审查要求补历史硬限、SSE最终一致、no-store和量化SLO；简单性审查要求砍完整历史缓存、新会话、逐设备管理和MVP connector自动管理。
- 已全部采纳核心修正并再次重写 `MOBILE_PLAN.md`：Cloudflare Named首测、Sakura次测；稳定v1 BFF；Cookie鉴权；8MiB初始历史硬限；SSE快照最终一致；MVP仅最近历史；connector手工试运行。
- 一致性扫描通过：无Tailscale/Sakura首选等旧路径残留；移动端5份文档均位于 `mobile/`。
- 用户提供实际域名 `tt3721.qd.je`。只读检查发现：当前NXDOMAIN，且`qd.je`尚未进入官方实时PSL；Cloudflare Free zone onboarding当前不应视为可行。
- 建议用户在DigitalPlat另申请已进入PSL的 `*.dpdns.org`（优先）或 `*.qzz.io`；否则Gate 0A改测SakuraFrp。
- 用户决定域名/Tunnel后续再处理；执行顺序调整为Gate 0B（本地pi-web协议/容量）先行，Gate 0A暂缓。两项均通过后才进入完整PWA。
- 已建立 `mobile/OVERNIGHT_RUN.md`：本次仅执行Gate 0B的静态/只读/合成验证；禁止真实mutation、禁止修改~/.pi、禁止重启当前桌面端、禁止Stage1源码实现；07:45收尾、08:00硬停止。
- 规划复审完成；尚未修改源码、安装connector或改DNS。

## 2026-07-22 Stage 1 BFF + PWA 壳实现
- 域名 `tt56677.top` 已购买（Namesilo），Cloudflare NS 已配置（earl/irena.ns.cloudflare.com），等待传播。
- `src/mobile-bridge.ts` 完成：loopback BFF，12个API端点，Cookie鉴权，SSE代理+20s心跳，8MiB历史硬限，字段过滤（无systemPrompt/sessionFile）。
- `resources/mobile/index.html` 完成：单文件 PWA SPA，登录/项目/会话/聊天四视图，SSE流式渲染，模型切换，中止按钮。
- `resources/mobile/manifest.json` + `sw.js` 完成：PWA manifest + 最小 SW。
- `src/main.ts` 已集成：bridge 生命周期 + 托盘配对码显示/复制。
- 集成自测 40/40 通过。
- 待域名传播后：安装 cloudflared → 配 Named Tunnel → 手机真机测试。

## 2026-07-22 通宵执行（Gate 0B 安全部分）
- 03:42 开始；pi-web 确认在 127.0.0.1:62809（PID 10832）。
- Phase A 完成：进程/端口识别，磁盘72GB，git干净。
- Phase B 完成：从 `.next/server/app/api/` bundle 提取全部 API 路由；写入 `mobile/gate0b/protocol-inventory.md`（14个端点，含置信度标注）。
- Phase C 完成：只读 GET 探针验证 sessions/models/state 端点；写入 `mobile/gate0b/capacity-report.md`。
  - 关键发现：session 列表 `messageCount` ≠ context messages 数量（compaction 后大幅缩小）；最大实测响应 512KB，远低于 8MiB 上限。
  - `get_state` 完整字段已记录；`systemPrompt`/`sessionFile` 不应转发移动端。
- Phase E 完成：合成 fixture（sessions-list/session-detail/state-running/state-idle/models/sse-stream）；BFF 契约草案；`fixture-check.mjs` 27/27 通过；`read-only-probe.mjs` 验证通过。
- 写入 `mobile/gate0b/deferred-live-tests.md`：prompt/abort/set_model/new-session/SSE格式等延期项。
- 未启动任何临时进程；未修改任何源码；未触碰 ~/.pi/agent。
- 补充发现：
  - `message_update` 是全量替换（frontend-confirmed），不是 delta。
  - `agent_end` 后前端会调用 `GET /api/agent/{id}` 获取最新 `contextUsage`（快照对账）。
  - `deferThinking=1` 减少约 11% 响应大小；`deferMedia=1` 无图片时无效果。
  - `GET /api/sessions/{id}/context` 比 session detail 多了每条消息的 `usage/cost/provider` 元数据；移动端不需要。
  - `GET /api/sessions/{id}/entries/{entryId}/thinking?blockIndex=N` 可懒加载 thinking 块。
  - `GET /api/agent/running/events` 首条事件已 live 确认：`{type:"running",runningSessionIds:[...]}`。
  - `session_info_changed` 事件字段：`{name: string | undefined}`。
  - `model_select` 事件字段：`{model, previousModel, source}`。
  - `thinking_level_select`（不是 `thinking_level_changed`）事件字段：`{level, previousLevel}`。
- 写入 `mobile/gate0b/bff-implementation-guide.md`：完整 BFF 实现指南（端点映射、字段过滤、SSE转发、8MiB限制、安全清单）。

## 2026-07-22 实现复核

- 构建通过；fixture 27/27；当前 standalone BFF 对真实 pi-web 的只读契约 13 项通过。
- 发布包已包含 MobileBridge 与 PWA 当前版本。
- 发现两个 P0：公网可读 pairing-code 路由；Electron 集成版未配置公网 allowed origin，POST 会返回 403。
- 发现两个 P1：项目卡片 inline onclick 被 projectId 的 JSON 双引号截断；请求体超限表现为 socket reset。
- 公网域名仍未委派到 Cloudflare，手机 URL 当前 NXDOMAIN；尚未开始有效真机验收。
- 多个 watchdog/setup 实例并行运行，且实现未提交到 HEAD。
