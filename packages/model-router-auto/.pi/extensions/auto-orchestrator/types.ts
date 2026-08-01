/**
 * auto-orchestrator / types.ts
 * 公共类型定义。阶段2扩展:action/complexity/needsPlanning/PlanPacket。
 * 类型最终以本机 node_modules/@earendil-works/pi-ai/dist 与 pi-coding-agent/dist 为准。
 */

export type Phase =
  | "discovery"
  | "planning"
  | "execution"
  | "debugging"
  | "verification"
  | "review"
  | "consensus"
  | "stalled"
  | "completed";

/** 路由动作 */
export type RouteAction =
  | "VERIFY"
  | "DIAGNOSE"
  | "PLAN"
  | "EXECUTE_PLAN"
  | "DOWNSHIFT"
  | "KEEP"
  | "ESCALATE";

/** 模型引用,格式 "provider/modelId" */
export interface ModelRef {
  ref: string;
  thinking?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

/** 强模型规划产出的结构化计划 */
export interface PlanPacket {
  goal: string;
  assumptions?: string[];
  steps: string[];
  files?: string[];
  acceptanceCriteria?: string[];
  risks?: string[];
}

/** 路由决策 */
export interface RouteDecision {
  action: RouteAction;
  phase: Phase;
  target: ModelRef;
  fallback: ModelRef[];
  reason: string;
  injectPlanInstruction?: boolean;
  injectVerificationInstruction?: boolean;
}

/** 局势分析结果 */
export interface Situation {
  phase: Phase;
  complexity: number;
  risk: number;
  confidence: number;
  needsPlanning: boolean;
  needsDiagnosis: boolean;
  needsConsensus: boolean;
  isStalled: boolean;
  hasProgress: boolean;
  requiredCapabilities: string[];
  reasons: string[];
}

/** 展证据(阶段3 进展账本) */
export interface ProgressEvidence {
  newEvidenceFound: boolean;
  hypothesisEliminated: boolean;
  failureCountBefore?: number;
  failureCountAfter?: number;
  newErrorSignature?: string;
  filesChanged: number;
  testsAdded: number;
  testsPassedDelta: number;
  repeatedToolCalls: number;
  repeatedHypotheses: number;
}

/** 进展账本条目（阶段3启用；阶段B扩展 action/phase 便于遥测关联） */
export interface DecisionRecord {
  at: number;
  ref: string;
  reason: string;
  outcome?: "success" | "failure" | "partial";
  action?: RouteAction;
  phase?: Phase;
}
