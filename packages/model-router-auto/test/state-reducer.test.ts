/**
 * test/state-reducer.test.ts
 * 阶段 B 验收（报告 §7 阶段 B）：
 * - 每个新 turn 的 switch budget 清零
 * - escalation 单次消费
 * - 失败→成功→失败后对应 streak 为 1
 * - testsPassedDelta 随 TURN_ENDED 归零
 * - 同错误签名累计、成功清零
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createInitialState, reduce, type OrchestratorState } from "../.pi/extensions/auto-orchestrator/state-reducer.js";
import type { OrchestratorEvent } from "../.pi/extensions/auto-orchestrator/events.js";

function apply(state: OrchestratorState, events: OrchestratorEvent[]): OrchestratorState {
  return events.reduce((s, e) => reduce(s, e), state);
}

const at = (n = 0) => 1_700_000_000_000 + n;

test("TURN_STARTED 清零 turn-scope 计数（switch budget 每回合重置）", () => {
  let s = createInitialState("sess-1");
  // 制造一个已切换过的 turn
  s = apply(s, [
    { type: "TURN_STARTED", turnId: "t0", at: at(0) },
    { type: "ROUTE_INTENDED", decisionId: "d1", plannedModel: "p/a", fallbacks: [], phase: "execution", action: "KEEP", reason: "r", at: at(1) },
    { type: "ROUTE_COMMITTED", decisionId: "d1", actualModel: "p/a", fallbackIndex: 0, at: at(2) },
    { type: "ROUTE_COMMITTED", decisionId: "d2", actualModel: "p/b", fallbackIndex: 0, at: at(3) },
  ]);
  assert.equal(s.switchCount, 1);
  assert.equal(s.currentModel, "p/b");

  s = apply(s, [{ type: "TURN_STARTED", turnId: "t1", at: at(4) }]);
  assert.equal(s.switchCount, 0, "新 turn switch budget 必须清零");
  assert.equal(s.testsPassedDelta, 0);
  assert.equal(s.repeatedHypothesisCount, 0);
  assert.equal(s.noNewEvidence, true);
  assert.equal(s.attemptCountThisTurn, 0);
});

test("ROUTE_COMMITTED 只在模型变化时累计 switchCount", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "ROUTE_COMMITTED", decisionId: "d1", actualModel: "p/a", fallbackIndex: 0, at: at(0) },
    { type: "ROUTE_COMMITTED", decisionId: "d2", actualModel: "p/a", fallbackIndex: 0, at: at(1) },
  ]);
  assert.equal(s.switchCount, 0);
  s = apply(s, [{ type: "ROUTE_COMMITTED", decisionId: "d3", actualModel: "p/b", fallbackIndex: 1, at: at(2) }]);
  assert.equal(s.switchCount, 1);
  assert.equal(s.previousModel, "p/a");
});

test("escalation 单次消费：REVIEW_COMPLETED 后不再 active", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "ESCALATION_REQUESTED", reason: "stuck", at: at(0) },
  ]);
  assert.ok(s.escalation && !s.escalation.consumed, "申请后应 active");
  assert.equal(s.phase, "stalled");

  s = apply(s, [{ type: "REVIEW_COMPLETED", outcome: "completed", questionSummary: "q", at: at(1) }]);
  assert.ok(s.escalation?.consumed, "复核完成后应消费");

  // 第二次 REVIEW_COMPLETED 不再改变已消费状态，也不新增 active escalation
  s = apply(s, [{ type: "REVIEW_COMPLETED", outcome: "completed", at: at(2) }]);
  assert.ok(s.escalation?.consumed);
});

test("失败 streak：失败→成功→失败后 sameFailureCount 为 1", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "MODEL_ATTEMPT_FAILED", decisionId: "d1", errorCategory: "terminal", errorMessage: "boom A", at: at(0) },
    { type: "MODEL_ATTEMPT_FAILED", decisionId: "d2", errorCategory: "terminal", errorMessage: "boom B", at: at(1) },
  ]);
  assert.equal(s.sameFailureCount, 2);

  s = apply(s, [{ type: "MODEL_ATTEMPT_SUCCEEDED", decisionId: "d3", at: at(2) }]);
  assert.equal(s.sameFailureCount, 0, "成功必须清零失败 streak");

  s = apply(s, [{ type: "MODEL_ATTEMPT_FAILED", decisionId: "d4", errorCategory: "terminal", errorMessage: "boom C", at: at(3) }]);
  assert.equal(s.sameFailureCount, 1, "成功后的首次失败 streak 应为 1");
});

test("retryable 失败不计入 sameFailureCount，但计错误签名", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "MODEL_ATTEMPT_FAILED", decisionId: "d1", errorCategory: "retryable", errorMessage: "Model not found: p/x", at: at(0) },
    { type: "MODEL_ATTEMPT_FAILED", decisionId: "d2", errorCategory: "retryable", errorMessage: "Model not found: p/x", at: at(1) },
  ]);
  assert.equal(s.sameFailureCount, 0);
  assert.equal(s.sameErrorSignatureCount, 2, "同签名应累计");
});

test("同错误签名累计，成功后清零", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "MODEL_ATTEMPT_FAILED", decisionId: "d1", errorCategory: "terminal", errorMessage: "TypeError: x is not a function at line 12", at: at(0) },
    { type: "MODEL_ATTEMPT_FAILED", decisionId: "d2", errorCategory: "terminal", errorMessage: "TypeError: x is not a function at line 99", at: at(1) },
  ]);
  assert.equal(s.sameErrorSignatureCount, 2, "数字差异被归一化后应视为同签名");
  s = apply(s, [{ type: "MODEL_ATTEMPT_SUCCEEDED", decisionId: "d3", at: at(2) }]);
  assert.equal(s.sameErrorSignatureCount, 0);
  assert.equal(s.lastErrorSignature, undefined);
});

test("testsPassedDelta：正增量提升 progress 并在 TURN_ENDED 归零", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [{ type: "TURN_STARTED", turnId: "t0", at: at(0) }]);
  s = apply(s, [{ type: "TEST_OBSERVED", passed: 5, at: at(1) }]);
  assert.equal(s.testsPassedDelta, 0, "首次运行只建基线");
  assert.equal(s.lastTestsPassed, 5);

  s = apply(s, [{ type: "TEST_OBSERVED", passed: 8, at: at(2) }]);
  assert.equal(s.testsPassedDelta, 3);
  assert.ok(s.progressScore > 0.5, "正增量应提升 progressScore");

  s = apply(s, [{ type: "TURN_ENDED", turnId: "t0", at: at(3) }]);
  assert.equal(s.testsPassedDelta, 0, "turn 结束后 delta 必须归零");
  assert.equal(s.lastTestsPassed, 8, "基线保留到下一 turn");
});

test("测试回归下调 progressScore", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "TEST_OBSERVED", passed: 10, at: at(0) },
    { type: "TEST_OBSERVED", passed: 6, at: at(1) },
  ]);
  assert.equal(s.testsPassedDelta, -4);
  assert.ok(s.progressScore < 0.5);
});

test("ATTEMPT_STARTED 清零 attempt-scope 失败计数", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "ATTEMPT_STARTED", attemptId: "a1", at: at(0) },
    { type: "TOOL_FAILED", toolName: "bash", at: at(1) },
    { type: "TOOL_FAILED", toolName: "bash", at: at(2) },
  ]);
  assert.equal(s.toolFailuresThisAttempt, 2);
  s = apply(s, [{ type: "ATTEMPT_STARTED", attemptId: "a2", at: at(3) }]);
  assert.equal(s.toolFailuresThisAttempt, 0);
  assert.equal(s.attemptCountThisTurn, 2);
});

test("PLAN_COMMITTED 清 replanRequested 并进入 execution", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [{ type: "REPLAN_REQUESTED", reason: "assumption broken", failedStep: "step 2", at: at(0) }]);
  assert.equal(s.phase, "planning");
  assert.ok(s.replanRequested);

  s = apply(s, [{
    type: "PLAN_COMMITTED",
    plan: { goal: "g", steps: ["s1", "s2"], files: ["f.ts"] },
    at: at(1),
  }]);
  assert.equal(s.phase, "execution");
  assert.equal(s.replanRequested, undefined);
  assert.equal(s.goal, "g");
  assert.deepEqual(s.remainingSteps, ["s1", "s2"]);
});

test("PROGRESS_MARKED 仅在签名匹配时清错误 streak", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "MODEL_ATTEMPT_FAILED", decisionId: "d1", errorCategory: "terminal", errorMessage: "conn refused", at: at(0) },
  ]);
  const sig = s.lastErrorSignature!;
  assert.ok(sig);

  // 不匹配的签名：不清除
  s = apply(s, [{ type: "PROGRESS_MARKED", summary: "x", progressScore: 0.6, resolvedErrorSignature: "other-sig", at: at(1) }]);
  assert.equal(s.lastErrorSignature, sig, "不匹配签名不应清除");

  // 匹配的签名：清除
  s = apply(s, [{ type: "PROGRESS_MARKED", summary: "fixed", progressScore: 0.7, resolvedErrorSignature: sig, at: at(2) }]);
  assert.equal(s.lastErrorSignature, undefined);
  assert.equal(s.sameFailureCount, 0);
});

test("MODEL_ATTEMPT_ABORTED 不累加任何失败 streak", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "MODEL_ATTEMPT_ABORTED", decisionId: "d1", at: at(0) },
    { type: "MODEL_ATTEMPT_ABORTED", decisionId: "d2", at: at(1) },
  ]);
  assert.equal(s.sameFailureCount, 0);
  assert.equal(s.modelFailuresThisAttempt, 0);
});

test("ROUTE_INTENDED 记录 history 并递增 routeCount", () => {
  let s = createInitialState("sess-1");
  s = apply(s, [
    { type: "ROUTE_INTENDED", decisionId: "d1", plannedModel: "p/a", fallbacks: ["p/b"], phase: "execution", action: "KEEP", reason: "r1", at: at(0) },
    { type: "ROUTE_INTENDED", decisionId: "d2", plannedModel: "p/b", fallbacks: [], phase: "planning", action: "PLAN", reason: "r2", at: at(1) },
  ]);
  assert.equal(s.routeCount, 2);
  assert.equal(s.history.length, 2);
  assert.equal(s.history[1].action, "PLAN");
});
