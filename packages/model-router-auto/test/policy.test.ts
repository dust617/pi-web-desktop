/**
 * test/policy.test.ts
 * 阶段 C 验收（报告 §7 阶段 C）：
 * - request_replan 后下一边界必到 planner
 * - 达到普通切换上限后，高风险任务仍进入 VERIFY（熔断不绕过安全/复核）
 * - thinking 配置注入 ModelRef
 * - 合法 phase 转移表
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decideRoute, toThinkingRef, legalPhase, LEGAL_PHASE_TRANSITIONS } from "../.pi/extensions/auto-orchestrator/policy.js";
import { createInitialState } from "../.pi/extensions/auto-orchestrator/state-reducer.js";
import type { Situation } from "../.pi/extensions/auto-orchestrator/types.js";
import type { OrchestratorConfig } from "../.pi/extensions/auto-orchestrator/config.js";

const config: OrchestratorConfig = {
  virtualModel: { provider: "orchestrator", id: "auto", name: "Auto", contextWindow: 200000, maxTokens: 32000 },
  models: {
    fast: "p/fast",
    executor: "p/executor",
    planner: "p/planner",
    diagnostician: "p/diag",
    reviewers: ["p/r1"],
  },
  fallback: [],
  limits: { maxSwitchesPerTurn: 2, maxRetriesPerError: 2, maxReviewers: 3, modelStickinessTurns: 3 },
  thinking: { planner: "high", diagnostician: "high", executor: "minimal", fast: "minimal" },
};

function sit(over: Partial<Situation> = {}): Situation {
  return {
    phase: "discovery",
    complexity: 0.5,
    risk: 0.3,
    confidence: 0.5,
    needsPlanning: false,
    needsDiagnosis: false,
    needsConsensus: false,
    isStalled: false,
    hasProgress: false,
    requiredCapabilities: [],
    reasons: [],
    ...over,
  };
}

test("replan 请求后下一边界必到 planner（PLAN）", () => {
  const state = createInitialState("s");
  state.phase = "execution";
  state.plan = { goal: "g", steps: ["s1"] };
  state.replanRequested = { reason: "assumption broken", at: 1 };

  const d = decideRoute(sit(), state, config.models, config);
  assert.equal(d.action, "PLAN");
  assert.equal(d.target.ref, "p/planner");
  assert.equal(d.phase, "planning");
  assert.ok(d.injectPlanInstruction);
});

test("切换熔断后，高风险任务仍进入 VERIFY（安全不被成本熔断绕过）", () => {
  const state = createInitialState("s");
  state.switchCount = 5; // 远超 maxSwitchesPerTurn=2
  state.currentModel = "p/executor";

  const d = decideRoute(sit({ needsConsensus: true, risk: 0.9 }), state, config.models, config);
  assert.equal(d.action, "VERIFY", "熔断不得绕过 consensus/安全分支");
  assert.equal(d.target.ref, "p/planner");
});

test("切换熔断后，停滞诊断仍进入 DIAGNOSE", () => {
  const state = createInitialState("s");
  state.switchCount = 5;
  state.currentModel = "p/executor";

  const d = decideRoute(sit({ needsDiagnosis: true, isStalled: true }), state, config.models, config);
  assert.equal(d.action, "DIAGNOSE");
  assert.equal(d.target.ref, "p/diag");
});

test("切换熔断后，成本型分支黏在当前模型（KEEP）", () => {
  const state = createInitialState("s");
  state.switchCount = 5;
  state.currentModel = "p/executor";

  const d = decideRoute(sit({ complexity: 0.2 }), state, config.models, config);
  assert.equal(d.action, "KEEP");
  assert.equal(d.target.ref, "p/executor", "熔断应黏在当前模型而非 fast");
});

test("未熔断的简单任务 DOWNSHIFT 到 fast", () => {
  const state = createInitialState("s");
  const d = decideRoute(sit({ complexity: 0.2 }), state, config.models, config);
  assert.equal(d.action, "DOWNSHIFT");
  assert.equal(d.target.ref, "p/fast");
});

test("toThinkingRef 注入 config.thinking", () => {
  assert.deepEqual(toThinkingRef("p/planner", config.models, config), { ref: "p/planner", thinking: "high" });
  assert.deepEqual(toThinkingRef("p/executor", config.models, config), { ref: "p/executor", thinking: "minimal" });
  // 未知角色不注入
  assert.deepEqual(toThinkingRef("p/unknown", config.models, config), { ref: "p/unknown" });
});

test("legalPhase：合法转移放行，非法转移回退当前阶段", () => {
  assert.equal(legalPhase("discovery", "planning"), "planning");
  assert.equal(legalPhase("discovery", "completed"), "discovery", "discovery→completed 非法，应回退");
  assert.equal(legalPhase("execution", "debugging"), "debugging");
  // 转移表自洽：每个 phase 至少能停留在自身
  for (const [phase, targets] of Object.entries(LEGAL_PHASE_TRANSITIONS)) {
    assert.ok(targets.includes(phase as any), `${phase} 必须能停留在自身`);
  }
});

test("已有计划且未 replan：EXECUTE_PLAN 到 executor", () => {
  const state = createInitialState("s");
  state.phase = "planning";
  state.plan = { goal: "g", steps: ["s1"] };
  const d = decideRoute(sit(), state, config.models, config);
  assert.equal(d.action, "EXECUTE_PLAN");
  assert.equal(d.target.ref, "p/executor");
  assert.equal(d.phase, "execution");
});
