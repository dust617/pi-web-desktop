/**
 * auto-orchestrator / state-reducer.ts
 * 阶段 B（报告 P0-1/P0-3）：唯一状态变更入口。
 *
 * 字段 scope 声明（置位 / 消费 / 衰减 / 重置）：
 *
 * | 字段 | scope | 置位 | 重置/消费 |
 * |---|---|---|---|
 * | goal/phase/plan/constraints/decisions/risk/confidence/progress | task | 对应事件 | 新任务/显式事件 |
 * | escalation | task | ESCALATION_REQUESTED | REVIEW_COMPLETED 或 ESCALATION_CONSUMED 置 consumed |
 * | replanRequested | task | REPLAN_REQUESTED | PLAN_COMMITTED 清除 |
 * | currentModel/previousModel/routeCount/filesModified/history | session | 路由/证据事件 | 不跨 session（分区持久化） |
 * | switchCount/testsPassedDelta/noNewEvidence/repeatedHypothesisCount/filesReadThisTurn/attemptCountThisTurn | turn | turn 内事件 | TURN_STARTED 全部清零；testsPassedDelta 另在 TURN_ENDED 归零 |
 * | toolFailuresThisAttempt/modelFailuresThisAttempt | attempt | 失败事件 | ATTEMPT_STARTED 清零；成功事件清零 |
 * | lastErrorSignature/sameErrorSignatureCount/sameFailureCount | 跨 attempt | 失败事件 | 成功/正测试增量/匹配签名解决 时清零 |
 */
import type { Phase, DecisionRecord, PlanPacket } from "./types.js";
import type { OrchestratorEvent } from "./events.js";
import { normalizeErrorSignature } from "./error-signature.js";

export const STATE_SCHEMA_VERSION = 2;

export interface EscalationRecord {
  reason: string;
  requiredCapabilities?: string[];
  consumed: boolean;
  at: number;
}

export interface OrchestratorState {
  schemaVersion: number;
  revision: number;
  sessionKey: string;
  taskKey: string;

  // —— task scope ——
  goal: string;
  phase: Phase;
  constraints: string[];
  decisions: DecisionRecord[];
  remainingSteps: string[];
  plan?: PlanPacket;
  replanRequested?: { reason: string; failedStep?: string; at: number };
  escalation?: EscalationRecord;
  currentProblem?: string;
  progressScore: number;
  confidence: number;
  riskScore: number;

  // —— session scope ——
  currentModel?: string;
  previousModel?: string;
  routeCount: number;
  lastTestsPassed?: number;
  testRunCount: number;
  filesModified: string[];
  history: DecisionRecord[];

  // —— turn scope（TURN_STARTED 重置）——
  turnId?: string;
  switchCount: number;
  testsPassedDelta: number;
  noNewEvidence: boolean;
  repeatedHypothesisCount: number;
  filesReadThisTurn: string[];
  attemptCountThisTurn: number;

  // —— attempt scope（ATTEMPT_STARTED 重置）——
  attemptId?: string;
  toolFailuresThisAttempt: number;
  modelFailuresThisAttempt: number;

  // —— 跨 attempt 失败 streak ——
  lastErrorSignature?: string;
  sameErrorSignatureCount: number;
  sameFailureCount: number;
}

export function createInitialState(sessionKey: string, taskKey = "default"): OrchestratorState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    revision: 0,
    sessionKey,
    taskKey,
    goal: "",
    phase: "discovery",
    constraints: [],
    decisions: [],
    remainingSteps: [],
    progressScore: 0.5,
    confidence: 0.5,
    riskScore: 0.2,
    routeCount: 0,
    testRunCount: 0,
    filesModified: [],
    history: [],
    switchCount: 0,
    testsPassedDelta: 0,
    noNewEvidence: true,
    repeatedHypothesisCount: 0,
    filesReadThisTurn: [],
    attemptCountThisTurn: 0,
    toolFailuresThisAttempt: 0,
    modelFailuresThisAttempt: 0,
    sameErrorSignatureCount: 0,
    sameFailureCount: 0,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pushCapped(list: DecisionRecord[], record: DecisionRecord): DecisionRecord[] {
  return [...list, record].slice(-100);
}

function dedupePush(list: string[], key: string): string[] {
  if (!key || list.includes(key)) return list;
  return [...list, key];
}

/**
 * 纯函数 reducer：返回新状态，从不原地修改。
 * 未知事件类型原样返回（仍计 revision，便于观测异常派发）。
 */
export function reduce(state: OrchestratorState, event: OrchestratorEvent): OrchestratorState {
  const next: OrchestratorState = { ...state, revision: state.revision + 1 };

  switch (event.type) {
    case "TURN_STARTED": {
      next.turnId = event.turnId;
      next.switchCount = 0;
      next.testsPassedDelta = 0;
      next.noNewEvidence = true;
      next.repeatedHypothesisCount = 0;
      next.filesReadThisTurn = [];
      next.attemptCountThisTurn = 0;
      return next;
    }

    case "TURN_ENDED": {
      // testsPassedDelta 的 scope 为当前 attempt/turn：turn 结束后归零，下一 turn 不得读取旧 delta
      next.testsPassedDelta = 0;
      return next;
    }

    case "ATTEMPT_STARTED": {
      next.attemptId = event.attemptId;
      next.toolFailuresThisAttempt = 0;
      next.modelFailuresThisAttempt = 0;
      next.attemptCountThisTurn += 1;
      return next;
    }

    case "ROUTE_INTENDED": {
      next.routeCount += 1;
      next.phase = event.phase;
      next.history = pushCapped(next.history, {
        at: event.at,
        ref: event.plannedModel,
        reason: event.reason,
        action: event.action,
        phase: event.phase,
      });
      return next;
    }

    case "ROUTE_COMMITTED": {
      if (next.currentModel && next.currentModel !== event.actualModel) {
        next.previousModel = next.currentModel;
        next.switchCount += 1;
      }
      next.currentModel = event.actualModel;
      return next;
    }

    case "MODEL_ATTEMPT_SUCCEEDED": {
      next.sameFailureCount = 0;
      next.sameErrorSignatureCount = 0;
      next.lastErrorSignature = undefined;
      next.modelFailuresThisAttempt = 0;
      next.toolFailuresThisAttempt = 0;
      return next;
    }

    case "MODEL_ATTEMPT_FAILED": {
      next.modelFailuresThisAttempt += 1;
      const sig = normalizeErrorSignature(event.errorMessage);
      if (next.lastErrorSignature === sig) {
        next.sameErrorSignatureCount += 1;
      } else {
        next.lastErrorSignature = sig;
        next.sameErrorSignatureCount = 1;
      }
      // retryable 失败（如首选模型不可用）不计入"同因失败"streak；terminal/unknown 计入
      if (event.errorCategory !== "retryable") {
        next.sameFailureCount += 1;
      }
      return next;
    }

    case "MODEL_ATTEMPT_ABORTED": {
      // 用户取消不是失败：不累加任何失败 streak
      return next;
    }

    case "TOOL_SUCCEEDED": {
      return next;
    }

    case "TOOL_FAILED": {
      next.toolFailuresThisAttempt += 1;
      return next;
    }

    case "TEST_OBSERVED": {
      next.testRunCount += 1;
      if (next.lastTestsPassed !== undefined) {
        const delta = event.passed - next.lastTestsPassed;
        next.testsPassedDelta = delta;
        if (delta > 0) {
          next.progressScore = clamp01(next.progressScore + 0.3);
          next.sameFailureCount = 0;
          next.toolFailuresThisAttempt = 0;
          next.noNewEvidence = false;
        } else if (delta < 0) {
          next.progressScore = clamp01(next.progressScore - 0.15);
        }
      } else {
        // 首次运行：仅建立基线，不算 delta
        next.testsPassedDelta = 0;
      }
      next.lastTestsPassed = event.passed;
      return next;
    }

    case "EVIDENCE_OBSERVED": {
      if (event.kind === "file_modified") {
        next.filesModified = dedupePush(next.filesModified, event.key);
      } else {
        next.filesReadThisTurn = dedupePush(next.filesReadThisTurn, event.key);
        next.noNewEvidence = false;
      }
      return next;
    }

    case "HYPOTHESIS_REPEATED": {
      next.repeatedHypothesisCount += 1;
      return next;
    }

    case "ESCALATION_REQUESTED": {
      next.escalation = {
        reason: event.reason,
        requiredCapabilities: event.requiredCapabilities,
        consumed: false,
        at: event.at,
      };
      next.currentProblem = event.currentProblem ?? event.reason;
      next.phase = "stalled";
      next.confidence = Math.min(next.confidence, 0.3);
      return next;
    }

    case "ESCALATION_CONSUMED": {
      if (next.escalation) {
        next.escalation = { ...next.escalation, consumed: true };
      }
      return next;
    }

    case "REVIEW_COMPLETED": {
      // 一次 ESCALATION_REQUESTED 最多产生一次有效复核消费
      if (next.escalation && !next.escalation.consumed) {
        next.escalation = { ...next.escalation, consumed: true };
      }
      next.decisions = pushCapped(next.decisions, {
        at: event.at,
        ref: "consensus",
        reason: event.questionSummary ?? `review ${event.outcome}`,
        outcome: event.outcome === "completed" ? "partial" : "failure",
      });
      return next;
    }

    case "PLAN_COMMITTED": {
      next.plan = event.plan;
      next.goal = event.plan.goal;
      next.remainingSteps = event.plan.steps ?? [];
      next.constraints = event.plan.files ?? [];
      next.phase = "execution";
      next.replanRequested = undefined;
      next.progressScore = Math.max(next.progressScore, 0.35);
      return next;
    }

    case "REPLAN_REQUESTED": {
      next.replanRequested = { reason: event.reason, failedStep: event.failedStep, at: event.at };
      next.phase = "planning";
      next.currentProblem = `replan: ${event.reason}`;
      if (event.failedStep) {
        next.decisions = pushCapped(next.decisions, {
          at: event.at,
          ref: next.currentModel ?? "unknown",
          reason: `step failed: ${event.failedStep}`,
          outcome: "failure",
        });
      }
      return next;
    }

    case "PROGRESS_MARKED": {
      next.progressScore = clamp01(event.progressScore);
      next.decisions = pushCapped(next.decisions, {
        at: event.at,
        ref: next.currentModel ?? "unknown",
        reason: event.summary,
        outcome: event.progressScore >= 0.5 ? "success" : "partial",
      });
      // 仅当模型明确解决了当前签名时才清错误 streak（不再无条件清除）
      if (event.resolvedErrorSignature && event.resolvedErrorSignature === next.lastErrorSignature) {
        next.lastErrorSignature = undefined;
        next.sameErrorSignatureCount = 0;
        next.sameFailureCount = 0;
        next.toolFailuresThisAttempt = 0;
      } else if (event.progressScore >= 0.5) {
        next.sameFailureCount = 0;
        next.toolFailuresThisAttempt = 0;
      }
      return next;
    }

    default:
      return next;
  }
}
