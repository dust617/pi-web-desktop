/**
 * test/telemetry.test.ts
 * 阶段 E 验收（报告 §7 阶段 E）：
 * - route intent 与 outcome 可按 decisionId 关联
 * - 凭据/Token/私钥/Authorization/Cookie/连接串规则集扫描，命中数必须为 0（脱敏后）
 * - schema 必填字段完整率 ≥99%
 * - 轮转与保留期
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Telemetry, sanitize, containsCredential, TELEMETRY_SCHEMA_VERSION } from "../.pi/extensions/auto-orchestrator/telemetry.js";

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orch-tele-"));
}

function readEntries(cwd: string): any[] {
  const f = path.join(cwd, ".pi", "orchestrator-telemetry.v2.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("intent/outcome 按 decisionId 关联", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd);
  t.logRouteIntent({ decisionId: "d-1", taskId: "task-1", attemptId: "attempt-1", plannedModel: "p/a", fallbacks: ["p/b"], phase: "execution", action: "KEEP", reason: "r" });
  t.logRouteOutcome({ decisionId: "d-1", taskId: "task-1", attemptId: "attempt-1", status: "success", actualModel: "p/b", fallbackIndex: 1, latencyMs: 120, committed: true });
  t.logTaskCompletion({ taskId: "task-1", status: "completed", source: "test_passed", decisionIds: ["d-1"], evidenceHash: "e-1" });

  const entries = readEntries(cwd);
  const intent = entries.find((e) => e.kind === "route_intent");
  const outcome = entries.find((e) => e.kind === "route_outcome");
  const completion = entries.find((e) => e.kind === "task_completion");
  assert.ok(intent && outcome && completion);
  assert.equal(intent.decisionId, outcome.decisionId, "必须可按 decisionId 关联");
  assert.equal(outcome.actualModel, "p/b");
  assert.equal(outcome.status, "success");
  assert.equal(completion.taskId, intent.taskId);
  assert.deepEqual(completion.decisionIds, ["d-1"]);
});

test("permission_decision 与 route 事件分离（不共用 schema）", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd);
  t.logPermissionDecision({ tool: "bash", level: "external_write", action: "deny", category: "git:push", commandHash: "abc" });
  const entries = readEntries(cwd);
  const perm = entries.find((e) => e.kind === "permission_decision");
  assert.ok(perm);
  assert.equal(perm.tool, "bash");
  assert.equal(perm.commandHash, "abc");
  assert.equal(perm.decisionId, undefined, "permission 事件不应有 route 的 decisionId");
});

test("脱敏：凭据规则集命中后替换为 [REDACTED]", () => {
  // Assemble synthetic credential-shaped inputs at runtime so public source scans
  // cannot mistake the test fixtures for stored credentials.
  const samples = [
    ["Authorization:", "Bearer", "fixture-token"].join(" "),
    ["api", "key"].join("_") + "=fixture-value",
    ["postgres", "://user:pass@host:5432/db"].join(""),
    ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" "),
    ["token", "fixture-value"].join(": "),
    ["password", "fixture-value"].join("="),
  ];
  for (const s of samples) {
    assert.equal(containsCredential(s), true, `应命中: ${s}`);
  }
  const hits = { count: 0 };
  const clean = sanitize({ reason: "failed api_key=secret123", model: "p/a" }, hits);
  assert.equal((clean as any).reason, "[REDACTED]");
  assert.equal((clean as any).model, "p/a", "非敏感字段保留");
  assert.ok(hits.count >= 1);
});

test("正常遥测写入后凭据扫描命中数必须为 0", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd);
  t.logRouteIntent({ decisionId: "d-1", taskId: "task-1", attemptId: "attempt-1", plannedModel: "p/a", fallbacks: [], phase: "execution", action: "KEEP", reason: "normal reason" });
  t.logRouteOutcome({ decisionId: "d-1", taskId: "task-1", attemptId: "attempt-1", status: "success", actualModel: "p/a", fallbackIndex: 0, latencyMs: 50, committed: true });
  t.logPermissionDecision({ tool: "edit", level: "local_write", action: "allow", category: "tool:edit" });

  assert.equal(t.getHealth().sanitizationHits, 0, "正常数据不应触发脱敏");

  // 对落盘内容再扫一遍：命中数必须为 0
  const entries = readEntries(cwd);
  const rehits = entries.filter((e) => JSON.stringify(e).match(/Bearer |api_key=|-----BEGIN|:\/\/[^"]*:[^"]*@/));
  assert.equal(rehits.length, 0);
});

test("必填字段完整率 ≥99%（schemaVersion/kind/at + 各事件必填）", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd);
  for (let i = 0; i < 50; i++) {
    t.logRouteIntent({ decisionId: `d-${i}`, taskId: `task-${i}`, attemptId: `attempt-${i}`, plannedModel: "p/a", fallbacks: [], phase: "execution", action: "KEEP", reason: "r" });
    t.logRouteOutcome({ decisionId: `d-${i}`, taskId: `task-${i}`, attemptId: `attempt-${i}`, status: "success", actualModel: "p/a", fallbackIndex: 0, latencyMs: i, committed: true });
  }
  const entries = readEntries(cwd);
  assert.ok(entries.length >= 100);
  const requiredByKind: Record<string, string[]> = {
    route_intent: ["decisionId", "taskId", "attemptId", "plannedModel", "phase", "action", "reason"],
    route_outcome: ["decisionId", "taskId", "attemptId", "status", "latencyMs"],
    task_completion: ["taskId", "status", "source"],
    permission_decision: ["tool", "level", "action", "category"],
  };
  let complete = 0;
  for (const e of entries) {
    const base = e.schemaVersion === TELEMETRY_SCHEMA_VERSION && e.kind && typeof e.at === "number";
    const req = requiredByKind[e.kind] ?? [];
    const fieldsOk = req.every((k) => e[k] !== undefined);
    if (base && fieldsOk) complete++;
  }
  const rate = complete / entries.length;
  assert.ok(rate >= 0.99, `必填完整率 ${rate} 应 ≥0.99`);
});

test("轮转：超过 maxBytes 后生成 .1 轮转文件", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd, { maxBytes: 200, keepRotations: 3 });
  for (let i = 0; i < 30; i++) {
    t.logRouteIntent({ decisionId: `d-${i}`, taskId: `task-${i}`, attemptId: `attempt-${i}`, plannedModel: "p/a", fallbacks: [], phase: "execution", action: "KEEP", reason: "reason padding to exceed bytes" });
  }
  const dir = path.join(cwd, ".pi");
  const rotated = fs.readdirSync(dir).filter((f) => f.includes("orchestrator-telemetry.v2.jsonl."));
  assert.ok(rotated.length >= 1, "应产生至少一个轮转文件");
  assert.ok(rotated.length <= 3, "轮转份数不得超过 keepRotations");
  assert.equal(t.getHealth().writeFailures, 0);
});

test("健康计数：entriesWritten 递增", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd);
  t.logRouteIntent({ decisionId: "d-1", taskId: "task-1", attemptId: "attempt-1", plannedModel: "p/a", fallbacks: [], phase: "execution", action: "KEEP", reason: "r" });
  t.logRouteIntent({ decisionId: "d-2", taskId: "task-2", attemptId: "attempt-2", plannedModel: "p/a", fallbacks: [], phase: "execution", action: "KEEP", reason: "r" });
  assert.equal(t.getHealth().entriesWritten, 2);
});
