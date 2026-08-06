#!/usr/bin/env node
/**
 * 在人工/测试验证任务确实完成后，写入 task_completion 标签。
 * 该脚本不是模型可调用工具，避免把模型自评当作真值。
 *
 * 示例：
 *   node scripts/label-task-complete.mjs \
 *     --task-id 0123456789abcdef01234567 \
 *     --source user_confirmed \
 *     --decision-id <decisionId>
 *
 * 允许 source：test_passed | user_confirmed | explicit_state
 * 不接受原始任务文本、命令或凭据，只保存 taskId/decisionId/evidenceHash。
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function options(name) {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : []);
}
function fail(message) {
  console.error(`[label-task-complete] ${message}`);
  process.exit(1);
}

const taskId = option("--task-id");
const source = option("--source");
const status = option("--status") ?? "completed";
const evidenceHash = option("--evidence-hash");
const decisionIds = options("--decision-id");
const input = option("--file") ?? path.join(process.cwd(), ".pi", "orchestrator-telemetry.v2.jsonl");

if (!taskId || !/^[A-Za-z0-9._:-]{8,200}$/.test(taskId)) fail("--task-id 必须是稳定的匿名任务标识");
if (!["test_passed", "user_confirmed", "explicit_state"].includes(source)) {
  fail("--source 必须是 test_passed、user_confirmed 或 explicit_state");
}
if (!["completed", "failed", "unknown"].includes(status)) fail("--status 非法");
if (evidenceHash !== undefined && !/^[a-f0-9]{16,128}$/i.test(evidenceHash)) {
  fail("--evidence-hash 必须是十六进制摘要，不接受原始证据");
}
if (decisionIds.some((id) => !/^[A-Za-z0-9._:-]{8,200}$/.test(id))) {
  fail("--decision-id 必须是匿名标识");
}

const file = path.resolve(input);
fs.mkdirSync(path.dirname(file), { recursive: true });
const record = {
  schemaVersion: 2,
  kind: "task_completion",
  at: Date.now(),
  taskId,
  status,
  source,
  ...(decisionIds.length ? { decisionIds: [...new Set(decisionIds)] } : {}),
  ...(evidenceHash ? { evidenceHash: evidenceHash.toLowerCase() } : {}),
};
fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
console.log(`[label-task-complete] 已写入 ${file}`);
console.log(`[label-task-complete] taskId=${taskId} source=${source} status=${status} decisionIds=${decisionIds.length}`);
