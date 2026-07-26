# Pi-Web-Desktop Agent Instructions

## Build and validation
- Build: `npm run build`.
- Mobile regression: `npm run test:mobile`; package parity: `npm run test:package`.
- After memory edits run `npm run memory:check`.
- PWA changes must bump both `resources/mobile/index.html` PWA version and `resources/mobile/sw.js` cache version.

## Safety
- Router changes require a fresh backup, background restart, validation, and an immediate rollback path.
- VPS uses SSH keys. Do not change immutable `/etc/resolv.conf` without a dedicated DNS diagnosis and rollback.
- Do not install/start v2rayN, mihomo, or FlClash in the VM for normal browsing; preserve frpc.
- Never store credential values, tokens, credential UUIDs, pairing codes, cookies, or private keys in project memory/docs.
- Never auto-read `archive/`; read a named archive only for a stated recovery reason.

## Project continuity
- Pi automatically loads this file, but not other memory files.
- 项目级 memory-guard 会在新会话首个实质请求自动注入简短的 STATUS/FACTS 背景；纯问候跳过。已有 Brief 时不要在 session start 重复无标签 recall。
- Brief 缺失或需要领域细节时，用 `memory-recall` 精确召回，例如 `tags: ['network']` 或 `tags: ['model', 'pwa']`。
- 仅将已验证、可复用的事实/决策/约束/失败模式用 `memory-save` 保存；绝不传入凭据、Token、Cookie、私钥或认证 URL。
- 自动观察只进入候选 INBOX，不会自动成为事实；需要时用 `memory-review` 查看，再确认是否保存。
- `task_plan.md`, `findings.md`, `progress.md` 只描述当前复杂任务；完成后运行 `npm run memory:archive -- <slug>`。
- Runtime/config verification overrides stale memory. Resolve contradictions in place; do not preserve two live truths.
- After editing AGENTS use `/reload` or a new session. After compaction, re-read STATUS only when exact current state matters.

## Models and sessions
- Cross-provider/model-family changes: checkpoint STATUS and prefer a clean session; do not assume `/compact` fixes network, auth, region, or thinking-capability errors.
- Attempt compaction at most once for recovery. Preserve the original session on failure.
- Do not delete the current session in the same run that updates memory. Export/checkpoint and pass `memory:check` before deleting any completed session.

## GPT models (openai-codex / chatgpt.com backend)
- The `openai-codex` provider connects to `chatgpt.com/backend-api` via WebSocket. This backend has stricter concurrency limits and lower stability than the official `api.openai.com` API.
- **Context hygiene**: When the GPT session accumulates heavy tool output (multiple large `read`/`bash` results), run `/compact` proactively before the context grows beyond ~120K tokens. Large context = large WebSocket payload = fragile connection.
- **Prefer serial over parallel**: Avoid launching more than 2–3 parallel subagents in a single GPT session. The ChatGPT backend enforces tight concurrent request limits; parallel fanout multiplies the chance of hitting "Too many concurrent requests".
- **Error escalation**: If 3+ consecutive `fetch failed` / `Service Unavailable` / `terminated` errors occur, stop retrying and recommend the user run `/compact` or start a new session. Persistent retries against a degraded backend waste tokens and time.
- **Thinking level**: For routine tasks on GPT models, use `medium` or `high` thinking instead of `xhigh`/`max`. Higher thinking levels produce longer responses, keeping the WebSocket open longer and increasing disconnect risk.
- **Session length**: Treat ~100 tool calls or ~4 hours as a soft ceiling for GPT sessions. Beyond that, proactively summarize and start fresh rather than pushing the WebSocket transport to its limits.
