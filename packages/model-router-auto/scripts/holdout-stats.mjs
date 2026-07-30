/**
 * telemetry v2 / holdout 基线对照统计。
 *
 * 完整样本口径：
 *   route_intent + route_outcome + task_completion(status=completed)
 *   且 taskId、attemptId、decisionId 能够关联。
 *
 * 用法：
 *   node scripts/holdout-stats.mjs
 *   node scripts/holdout-stats.mjs --check
 *   node scripts/holdout-stats.mjs D:/项目A/.pi D:/项目B/.pi/orchestrator-telemetry.v2.jsonl
 *   --check：准入线未全部满足时返回非 0；默认仅输出报告，不改变退出码。
 *
 * 传入目录时会自动读取当前文件及 .1 至 .5 轮转文件，支持多个项目汇总。
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "orchestrator-telemetry.v2.jsonl";
const ROTATIONS = 5;
const VALID_COMPLETION_SOURCES = new Set(["test_passed", "user_confirmed", "explicit_state"]);
const rawInputs = process.argv.slice(2);
const checkMode = rawInputs.includes("--check");
const inputs = rawInputs.filter((input) => input !== "--check");

function expandInput(input) {
  const absolute = path.resolve(input);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return expandBaseFile(absolute);
  if (!stat.isDirectory()) return [];

  const candidates = [
    path.join(absolute, BASE),
    path.join(absolute, ".pi", BASE),
  ];
  const base = candidates.find((file) => fs.existsSync(file));
  return base ? expandBaseFile(base) : [];
}

function expandBaseFile(file) {
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.\d+$/, "");
  const files = [];
  const current = path.join(dir, base);
  if (fs.existsSync(current)) files.push(current);
  for (let i = 1; i <= ROTATIONS; i++) {
    const rotated = `${current}.${i}`;
    if (fs.existsSync(rotated)) files.push(rotated);
  }
  return files;
}

const requested = inputs.length ? inputs : [path.join(process.cwd(), ".pi", BASE)];
const files = [...new Set(requested.flatMap(expandInput))].sort();
const byId = new Map();
const completionsByTask = new Map();
const lineCount = { total: 0, parseFail: 0, ignored: 0 };
let duplicateEvents = 0;
let conflictingEvents = 0;

function recordRoute(rec) {
  if (!rec.decisionId) {
    lineCount.ignored++;
    return;
  }
  if (!byId.has(rec.decisionId)) byId.set(rec.decisionId, {});
  const entry = byId.get(rec.decisionId);
  const key = rec.kind === "route_intent" ? "intent" : "outcome";
  if (entry[key]) {
    duplicateEvents++;
    if (JSON.stringify(entry[key]) !== JSON.stringify(rec)) conflictingEvents++;
  }
  entry[key] = rec;
}

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    lineCount.total++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      lineCount.parseFail++;
      continue;
    }
    if (rec.kind === "route_intent" || rec.kind === "route_outcome") {
      recordRoute(rec);
    } else if (rec.kind === "task_completion") {
      if (!rec.taskId || !VALID_COMPLETION_SOURCES.has(rec.source)) {
        lineCount.ignored++;
        continue;
      }
      if (!completionsByTask.has(rec.taskId)) completionsByTask.set(rec.taskId, []);
      completionsByTask.get(rec.taskId).push(rec);
    } else {
      lineCount.ignored++;
    }
  }
}

function completionFor(intent, decisionId) {
  const labels = completionsByTask.get(intent?.taskId) ?? [];
  return labels.find((label) =>
    label.status === "completed" &&
    (!Array.isArray(label.decisionIds) || label.decisionIds.includes(decisionId)),
  );
}

function statsFor(strategyFilter) {
  const stats = {
    samples: 0,
    labelledSamples: 0,
    completeSamples: 0,
    completedTasks: new Set(),
    hasOutcome: 0,
    success: 0,
    failed: 0,
    aborted: 0,
    committed: 0,
    fallbackUsed: 0,
    latencySum: 0,
  };

  for (const [decisionId, { intent, outcome }] of byId) {
    if (!intent) continue;
    const strategy = intent.strategy || "adaptive";
    if (strategy !== strategyFilter) continue;
    stats.samples++;
    if (!outcome) continue;
    stats.hasOutcome++;
    if (outcome.status === "success") stats.success++;
    else if (outcome.status === "failed") stats.failed++;
    else if (outcome.status === "aborted") stats.aborted++;
    if (outcome.committed) stats.committed++;
    if ((outcome.fallbackIndex ?? 0) > 0) stats.fallbackUsed++;
    stats.latencySum += Number(outcome.latencyMs) || 0;

    const linked = outcome.taskId === intent.taskId && outcome.attemptId === intent.attemptId;
    const label = linked ? completionFor(intent, decisionId) : undefined;
    if (label) {
      stats.labelledSamples++;
      stats.completeSamples++;
      stats.completedTasks.add(intent.taskId);
    }
  }

  return {
    ...stats,
    completedTasks: stats.completedTasks.size,
    outcomeUsableRate: stats.samples ? stats.hasOutcome / stats.samples : 0,
    labelledRate: stats.samples ? stats.labelledSamples / stats.samples : 0,
    successRate: stats.hasOutcome ? stats.success / stats.hasOutcome : 0,
    avgLatencyMs: stats.hasOutcome ? Math.round(stats.latencySum / stats.hasOutcome) : 0,
  };
}

const groups = ["adaptive", "holdout"].map(statsFor);
const [adaptive, holdout] = groups;

console.log("=".repeat(78));
console.log(`telemetry 文件数: ${files.length}`);
if (files.length) console.log(files.map((file) => `  - ${file}`).join("\n"));
else console.log("  （未找到 v2 telemetry 文件；当前计数为 0）");
console.log(`记录行: ${lineCount.total}（解析失败 ${lineCount.parseFail}，忽略 ${lineCount.ignored}）`);
console.log(`唯一 decisionId: ${byId.size}；task_completion: ${[...completionsByTask.values()].reduce((n, v) => n + v.length, 0)}`);
console.log(`重复事件: ${duplicateEvents}；冲突事件: ${conflictingEvents}`);
console.log("=".repeat(78));
console.log("按 strategy 分组（完整样本必须有完成标签）");
console.log("指标".padEnd(25) + "adaptive（动态）".padEnd(25) + "holdout（基线）");
console.log("-".repeat(78));
function row(label, getter, format = String) {
  console.log(label.padEnd(25) + format(getter(adaptive)).padEnd(25) + format(getter(holdout)));
}
row("原始 route 样本", (g) => g.samples);
row("有 outcome", (g) => g.hasOutcome);
row("完成标签样本", (g) => g.completeSamples);
row("完成任务数", (g) => g.completedTasks);
row("outcome 可用率", (g) => g.outcomeUsableRate, (v) => `${(v * 100).toFixed(1)}%`);
row("标签覆盖率", (g) => g.labelledRate, (v) => `${(v * 100).toFixed(1)}%`);
row("成功率", (g) => g.successRate, (v) => `${(v * 100).toFixed(1)}%`);
row("success", (g) => g.success);
row("failed", (g) => g.failed);
row("aborted", (g) => g.aborted);
row("committed", (g) => g.committed);
row("fallback 使用", (g) => g.fallbackUsed);
row("平均延迟 ms", (g) => g.avgLatencyMs);
console.log("-".repeat(78));
console.log("阶段 5 准入线检查");
const checks = [
  ["adaptive 完成样本 ≥500", adaptive.completeSamples >= 500, `${adaptive.completeSamples}/500`],
  ["holdout 完成样本 ≥500", holdout.completeSamples >= 500, `${holdout.completeSamples}/500`],
  ["adaptive outcome 可用率 ≥95%", adaptive.outcomeUsableRate >= 0.95, `${(adaptive.outcomeUsableRate * 100).toFixed(1)}%`],
  ["标签覆盖率 ≥99%", adaptive.labelledRate >= 0.99 && holdout.labelledRate >= 0.99, `adaptive ${(adaptive.labelledRate * 100).toFixed(1)}% / holdout ${(holdout.labelledRate * 100).toFixed(1)}%`],
  ["动态成功率不低于基线", adaptive.samples > 0 && holdout.samples > 0 && adaptive.successRate >= holdout.successRate, `adaptive ${(adaptive.successRate * 100).toFixed(1)}% vs holdout ${(holdout.successRate * 100).toFixed(1)}%`],
];
for (const [label, pass, detail] of checks) {
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${label}（${detail}）`);
}
if (checkMode && !checks.every(([, pass]) => pass)) {
  process.exitCode = 1;
}
console.log("=".repeat(78));
