#!/usr/bin/env node
/**
 * session-stops.mjs — 诊断 Pi 会话「异常停止 / 中断」原因。
 *
 * 背景：GPT/DeepSeek 等后端会话偶尔会「回合中断」（用户看到助手只回复一半就停），
 * 常见原因是 pi 上下文压缩（compaction）在长回合后触发，其次是传输错误。
 * 本工具扫描 ~/.pi/agent/sessions/ 下各项目的 jsonl 会话日志，输出每个会话的
 * 停止诊断：时间、模型、消息规模、最后状态与可能原因，便于事后排查。
 *
 * 用法：
 *   node scripts/session-stops.mjs                # 扫描最近 7 天会话，控制台摘要
 *   node scripts/session-stops.mjs --days 1       # 只看最近 1 天
 *   node scripts/session-stops.mjs --all          # 全部会话
 *   node scripts/session-stops.mjs --json         # 输出 JSON 到 ~/.pi/agent/session-stops.json
 *
 * 原因分类（基于可观测信号，非逐字节判定）：
 *   transport-error  : 会话日志出现 error / terminated / fetch failed 事件
 *   compaction       : 最后消息是大工具输出/assistant 回合且无后续 user 消息，
 *                      上下文估算接近触发阈值（reserveTokens 逻辑），回合在压缩点断裂
 *   awaiting-user    : 最后是 user 消息，正常等待回复（非异常）
 *   completed        : 会话有明确的结束信号（如主动 /exit 或关闭事件）
 *   interrupted      : 最后是 assistant/toolResult，无后续消息且未结束（异常，多为 compaction 或传输中断）
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");
const OUTPUT_FILE = join(homedir(), ".pi", "agent", "session-stops.json");

const args = new Set(process.argv.slice(2));
const DAYS = args.has("--all") ? Infinity : Number((process.argv[process.argv.indexOf("--days") + 1] ?? 7));
const WANT_JSON = args.has("--json");

/** transport 错误关键词：与 pi-ai 的 isTransientNetworkError 对齐。 */
const TRANSPORT_ERROR_RE = /fetch failed|terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|other side closed|network error|connection (?:error|refused|lost)|timed ?out|timeout|UND_ERR_/i;

/** 估算 token 数：中文/英文混合按字符数 /3 粗估（上下文中实际更接近字符/3.5~4）。 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 3));
}

function parseLines(file) {
  return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((ln) => {
    try { return JSON.parse(ln); } catch { return null; }
  }).filter(Boolean);
}

function analyzeFile(file) {
  const lines = parseLines(file);
  if (lines.length === 0) return null;

  const modelChanges = [];
  const first = lines[0];
  const last = lines[lines.length - 1];
  const ts = (j) => j.timestamp || j.ts || "";
  const firstTs = ts(first), lastTs = ts(last);

  let chars = 0, errors = 0, lastRole = null, lastKind = null;
  const errorSamples = [];
  for (const j of lines) {
    const t = j.type || "";
    if (t === "model_change" && j.provider) {
      modelChanges.push(`${j.provider}/${j.modelId}`);
    }
    const raw = JSON.stringify(j);
    chars += raw.length;
    if (j.message?.role) lastRole = j.message.role;
    if (t === "message") lastKind = j.message?.role ?? "message";
    // Pi 把 transport 错误包装成 assistant 回合 stopReason=error + errorMessage，
    // 必须显式识别，否则被误判为 interrupted（2026-08-01 2.2M GPT 会话分析：
    // 14 次 fetch failed/terminated 全部被漏判）。
    const msg = j.message;
    if (t === "message" && msg?.stopReason === "error" && typeof msg.errorMessage === "string") {
      if (TRANSPORT_ERROR_RE.test(msg.errorMessage)) {
        errors++;
        if (errorSamples.length < 3) errorSamples.push(`stop=error ${msg.errorMessage.slice(0, 160)}`);
      }
    }
    if (/error|terminated|fetch failed|disconnect|ECONNRESET/i.test(raw)) {
      if (/toolResult|thinking|content/.test(raw)) continue; // 消息正文提到这些词不算
      const isEvent = /"type"\s*:\s*"(error|system|event)"/.test(raw);
      if (isEvent) { errors++; if (errorSamples.length < 3) errorSamples.push(raw.slice(0, 180)); }
    }
  }

  const model = modelChanges.length ? modelChanges[modelChanges.length - 1] : "unknown";
  const tokens = Math.round(chars / 3);
  const now = Date.now();
  const lastTsMs = Date.parse(lastTs || "");
  const idleMin = lastTsMs ? Math.round((now - lastTsMs) / 60000) : -1;

  let reason;
  if (errors > 0) reason = "transport-error";
  else if (idleMin >= 0 && idleMin < 5) reason = "active";
  else if (lastRole === "user") reason = "awaiting-user";
  else if (lastKind === "custom_message" && /exit|shutdown|end/i.test(JSON.stringify(last))) reason = "completed";
  else if (lastRole === "assistant" || lastRole === "tool" || lastRole === "toolResult") reason = "interrupted";
  else reason = "unknown";

  return {
    file: basename(file),
    startedAt: firstTs,
    endedAt: lastTs,
    idleMin,
    model,
    messages: lines.length,
    estTokens: tokens,
    lastRole,
    reason,
    errors,
    errorSamples,
  };
}

function main() {
  if (!existsSync(SESSIONS_ROOT)) {
    console.error(`✗ 未找到会话目录：${SESSIONS_ROOT}`);
    process.exit(1);
  }
  const cutoff = Date.now() - DAYS * 24 * 3600 * 1000;
  const results = [];

  for (const projectDir of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const dir = join(SESSIONS_ROOT, projectDir.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = join(dir, f);
      try {
        if (statSync(full).mtimeMs < cutoff) continue;
      } catch { continue; }
      const r = analyzeFile(full);
      if (r) results.push(r);
    }
  }

  results.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

  if (WANT_JSON) {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    const prev = existsSync(OUTPUT_FILE) ? JSON.parse(readFileSync(OUTPUT_FILE, "utf8") || "[]") : [];
    const merged = [...results.filter((r) => r.reason !== "awaiting-user"), ...prev.filter((p) => !results.some((r) => r.file === p.file))];
    writeFileSync(OUTPUT_FILE, JSON.stringify(merged.slice(0, 200), null, 2));
    console.log(`✓ 已写入 ${OUTPUT_FILE}（${merged.length} 条停止/中断记录）`);
  }

  console.log(`\n会话停止诊断（最近 ${DAYS === Infinity ? "全部" : DAYS + " 天"}，共 ${results.length} 个会话）：`);
  const byReason = {};
  for (const r of results) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  console.log("原因分布:", JSON.stringify(byReason));

  const abnormal = results.filter((r) => r.reason === "interrupted" || r.reason === "transport-error");
  if (abnormal.length === 0) {
    console.log("✓ 未发现异常停止会话（active 为进行中，awaiting-user 为正常等待，completed 为正常结束）");
  }
  for (const r of abnormal.slice(0, 12)) {
    console.log(`\n⚠ [${r.reason}] ${r.file}`);
    console.log(`  时间: ${r.startedAt} → ${r.endedAt}  闲置 ${r.idleMin} 分钟  模型: ${r.model}`);
    console.log(`  消息数: ${r.messages}  估算 tokens: ${r.estTokens}  最后角色: ${r.lastRole}`);
    if (r.errorSamples.length) console.log(`  错误样本: ${r.errorSamples.join(" | ")}`);
  }
}

main();
