/**
 * test/holdout.test.ts
 * 阶段0 验收：holdout 配置校验 + holdout 路由策略 + strategy 字段写入 telemetry。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { validateConfig } from "../.pi/extensions/auto-orchestrator/config.js";
import { makeRouteIntent } from "../.pi/extensions/auto-orchestrator/route-executor.js";
import { Telemetry } from "../.pi/extensions/auto-orchestrator/telemetry.js";
import type { OrchestratorConfig } from "../.pi/extensions/auto-orchestrator/config.js";

const validRaw = {
  virtualModel: { provider: "orchestrator", id: "auto", name: "Auto", contextWindow: 200000, maxTokens: 32000 },
  models: { fast: "p/fast", executor: "p/exec", planner: "p/plan", diagnostician: "p/diag", reviewers: ["p/r1"] },
  fallback: ["p/exec"],
  limits: { maxSwitchesPerTurn: 2, maxRetriesPerError: 2, maxReviewers: 3, modelStickinessTurns: 3 },
};

function tmpCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-holdout-"));
  fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
  return dir;
}

test("holdout 配置：合法段通过", () => {
  const { config, warnings } = validateConfig({
    ...validRaw,
    holdout: { enabled: false, model: "p/exec", fallback: ["p/fast"] },
  });
  assert.equal(config.holdout?.enabled, false);
  assert.equal(config.holdout?.model, "p/exec");
  assert.deepEqual(config.holdout?.fallback, ["p/fast"]);
  assert.equal(warnings.length, 0, "holdout 是已知字段，不应告警");
});

test("holdout 配置：缺失时不注入（向后兼容）", () => {
  const { config } = validateConfig({ ...validRaw });
  assert.equal(config.holdout, undefined);
});

test("holdout 配置：model ref 非法抛错", () => {
  assert.throws(
    () => validateConfig({ ...validRaw, holdout: { enabled: true, model: "no-slash" } }),
    /holdout\.model/,
  );
});

test("holdout 配置：enabled 非布尔抛错", () => {
  assert.throws(
    () => validateConfig({ ...validRaw, holdout: { enabled: "yes", model: "p/exec" } }),
    /holdout\.enabled/,
  );
});

test("holdout 配置：fallback ref 非法抛错", () => {
  assert.throws(
    () => validateConfig({ ...validRaw, holdout: { enabled: true, model: "p/exec", fallback: ["bad"] } }),
    /holdout\.fallback\[0\]/,
  );
});

test("makeRouteIntent：默认 strategy=adaptive", () => {
  const intent = makeRouteIntent({
    target: { ref: "p/exec" },
    fallbacks: [],
    phase: "execution",
    action: "KEEP",
    reason: "r",
  });
  assert.equal(intent.strategy, undefined, "未传 strategy 时为 undefined，由 telemetry 填默认");
});

test("makeRouteIntent：holdout strategy 透传", () => {
  const intent = makeRouteIntent({
    target: { ref: "p/exec" },
    fallbacks: [],
    phase: "execution",
    action: "KEEP",
    reason: "holdout 基线",
    strategy: "holdout",
  });
  assert.equal(intent.strategy, "holdout");
  assert.equal(intent.plannedModel, "p/exec");
  // 不可变
  assert.ok(Object.isFrozen(intent));
});

test("telemetry：holdout strategy 写入 route_intent 记录", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd);
  t.logRouteIntent({
    decisionId: "d-ho",
    taskId: "task-ho",
    attemptId: "attempt-ho",
    plannedModel: "p/exec",
    fallbacks: [],
    phase: "execution",
    action: "KEEP",
    reason: "holdout 基线",
    strategy: "holdout",
  });
  t.logRouteOutcome({
    decisionId: "d-ho",
    taskId: "task-ho",
    attemptId: "attempt-ho",
    status: "success",
    actualModel: "p/exec",
    fallbackIndex: 0,
    latencyMs: 42,
    committed: true,
  });

  const lines = fs.readFileSync(path.join(cwd, ".pi", "orchestrator-telemetry.v2.jsonl"), "utf8").trim().split("\n");
  const intent = JSON.parse(lines[0]);
  assert.equal(intent.kind, "route_intent");
  assert.equal(intent.strategy, "holdout", "strategy 必须写入");
  assert.equal(intent.decisionId, "d-ho");
  const outcome = JSON.parse(lines[1]);
  assert.equal(outcome.kind, "route_outcome");
  assert.equal(outcome.status, "success");
});

test("telemetry：旧式调用（无 strategy）向后兼容", () => {
  const cwd = tmpCwd();
  const t = new Telemetry(cwd);
  // 不传 strategy，模拟旧调用方
  t.logRouteIntent({
    decisionId: "d-adp",
    taskId: "task-adp",
    attemptId: "attempt-adp",
    plannedModel: "p/plan",
    fallbacks: ["p/exec"],
    phase: "planning",
    action: "PLAN",
    reason: "动态路由",
  });
  const line = fs.readFileSync(path.join(cwd, ".pi", "orchestrator-telemetry.v2.jsonl"), "utf8").trim();
  const rec = JSON.parse(line);
  assert.equal(rec.strategy, undefined, "不传 strategy 时记录中无该字段，旧数据兼容");
});
