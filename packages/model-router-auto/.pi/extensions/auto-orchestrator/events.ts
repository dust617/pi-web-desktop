/**
 * auto-orchestrator / events.ts
 * 阶段 B（报告 P0-3）：统一事件词汇表。所有状态变更必须经由这些事件进入 reducer，
 * 各模块不得直接任意修改共享状态字段。
 *
 * 每个事件对应报告 §4.1 P0-3 建议的事件集合；字段 scope（session/turn/attempt/task）
 * 在 state-reducer.ts 中声明并执行置位/消费/衰减/重置规则。
 */
import type { Phase, RouteAction, PlanPacket } from "./types.js";

export type ErrorCategory = "retryable" | "terminal" | "unknown";

export type OrchestratorEvent =
  | { type: "TURN_STARTED"; turnId: string; at: number }
  | { type: "TURN_ENDED"; turnId: string; at: number }
  | { type: "ATTEMPT_STARTED"; attemptId: string; turnId?: string; at: number }
  | {
      type: "ROUTE_INTENDED";
      decisionId: string;
      attemptId?: string;
      turnId?: string;
      plannedModel: string;
      fallbacks: string[];
      phase: Phase;
      action: RouteAction;
      reason: string;
      at: number;
    }
  | {
      type: "ROUTE_COMMITTED";
      decisionId: string;
      actualModel: string;
      fallbackIndex: number;
      at: number;
    }
  | { type: "MODEL_ATTEMPT_SUCCEEDED"; decisionId: string; at: number }
  | {
      type: "MODEL_ATTEMPT_FAILED";
      decisionId: string;
      errorCategory: ErrorCategory;
      errorMessage: string;
      at: number;
    }
  | { type: "MODEL_ATTEMPT_ABORTED"; decisionId: string; at: number }
  | { type: "TOOL_SUCCEEDED"; toolName: string; turnId?: string; at: number }
  | { type: "TOOL_FAILED"; toolName: string; turnId?: string; errorMessage?: string; at: number }
  | { type: "TEST_OBSERVED"; passed: number; turnId?: string; at: number }
  | {
      type: "EVIDENCE_OBSERVED";
      kind: "file_read" | "file_modified";
      key: string;
      turnId?: string;
      at: number;
    }
  | { type: "HYPOTHESIS_REPEATED"; turnId?: string; at: number }
  | {
      type: "ESCALATION_REQUESTED";
      reason: string;
      requiredCapabilities?: string[];
      currentProblem?: string;
      at: number;
    }
  | { type: "ESCALATION_CONSUMED"; at: number }
  | {
      type: "REVIEW_COMPLETED";
      outcome: "completed" | "timeout" | "failed";
      questionSummary?: string;
      at: number;
    }
  | { type: "PLAN_COMMITTED"; plan: PlanPacket; at: number }
  | { type: "REPLAN_REQUESTED"; reason: string; failedStep?: string; at: number }
  | {
      type: "PROGRESS_MARKED";
      summary: string;
      progressScore: number;
      resolvedErrorSignature?: string;
      at: number;
    };

export type OrchestratorEventType = OrchestratorEvent["type"];
