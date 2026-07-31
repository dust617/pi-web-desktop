/**
 * auto-orchestrator / policy.ts
 * 路由策略（纯函数）。宗旨三：工作模型可申请升级，但最终路由由 policy 决定。
 *
 * 优先级链（按设计稿）：硬能力 > 上下文 > 安全 > 停滞升级 > 阶段 > 黏性 > 成本。
 *
 * 阶段 C（报告 P1-6）：
 * - 合法 phase 转移表：非法目标阶段回退到当前阶段；
 * - thinking 配置注入 ModelRef（toThinkingRef），planner/diagnostician 的 high 生效；
 * - 熔断（maxSwitchesPerTurn）只限制成本型切换（DOWNSHIFT/KEEP），
 *   不绕过安全/复核（VERIFY/DIAGNOSE/PLAN 不受熔断影响）。
 */
import type { OrchestratorConfig } from "./config.js";
import type { RouteDecision, Situation, ModelRef, Phase } from "./types.js";
import type { OrchestratorState } from "./state-reducer.js";

export type ModelConfig = OrchestratorConfig["models"];

/** 合法 phase 转移表（报告 P1-6）。未列出的转移视为非法。 */
export const LEGAL_PHASE_TRANSITIONS: Record<Phase, Phase[]> = {
  discovery: ["discovery", "planning", "execution", "consensus", "stalled", "debugging"],
  planning: ["planning", "execution", "consensus", "stalled", "debugging"],
  execution: ["execution", "debugging", "verification", "review", "consensus", "stalled", "planning", "completed"],
  debugging: ["debugging", "execution", "consensus", "stalled", "planning"],
  verification: ["verification", "execution", "review", "consensus", "completed"],
  review: ["review", "execution", "consensus", "completed", "verification"],
  consensus: ["consensus", "execution", "planning", "debugging", "review", "completed"],
  stalled: ["stalled", "debugging", "planning", "consensus", "execution"],
  completed: ["completed", "discovery", "planning"],
};

/** 目标阶段非法时回退到当前阶段。 */
export function legalPhase(current: Phase, desired: Phase): Phase {
  return LEGAL_PHASE_TRANSITIONS[current]?.includes(desired) ? desired : current;
}

/** 角色 -> 模型引用表 */
const ROLE_OF_REF = (models: ModelConfig, ref: string): string | undefined => {
  if (ref === models.fast) return "fast";
  if (ref === models.executor) return "executor";
  if (ref === models.planner) return "planner";
  if (ref === models.diagnostician) return "diagnostician";
  return undefined;
};

const VALID_THINKING = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * 把 config.thinking 注入 ModelRef（报告 P2-1：thinking 配置此前未生效）。
 * 仅当引用能映射到已知角色且 thinking 值合法时注入。
 */
export function toThinkingRef(ref: string, models: ModelConfig, config: OrchestratorConfig): ModelRef {
  const role = ROLE_OF_REF(models, ref);
  const level = role ? config.thinking?.[role] : undefined;
  if (level && VALID_THINKING.has(level)) {
    return { ref, thinking: level as ModelRef["thinking"] };
  }
  return { ref };
}

function toRef(s: string): ModelRef {
  return { ref: s };
}

export function decideRoute(
  situation: Situation,
  state: OrchestratorState,
  models: ModelConfig,
  config: OrchestratorConfig,
): RouteDecision {
  // 熔断：同回合切换超上限。仅限制成本型切换，不绕过安全/复核（报告 P1-6）
  const maxSwitch = config.limits.maxSwitchesPerTurn;
  const fused = state.switchCount >= maxSwitch && !!state.currentModel;
  const fusedRef = state.currentModel as string | undefined;

  // —— 安全/复核：不受熔断影响 ——
  if (situation.needsConsensus) {
    return {
      action: "VERIFY",
      target: toRef(models.planner),
      fallback: [toRef(models.diagnostician), toRef(models.executor)],
      phase: legalPhase(state.phase, "consensus"),
      reason: "问题风险较高或存在明显不确定性，需要多模型独立复核",
      injectVerificationInstruction: true,
    };
  }

  if (situation.needsDiagnosis) {
    return {
      action: "DIAGNOSE",
      target: toRef(models.diagnostician),
      fallback: [toRef(models.planner), toRef(models.executor)],
      phase: legalPhase(state.phase, "debugging"),
      reason: "当前任务已经停滞，需要更强模型重新诊断根因",
    };
  }

  // —— 规划：显式 replan 优先于启发式 ——
  if (state.replanRequested && !fused) {
    return {
      action: "PLAN",
      target: toRef(models.planner),
      fallback: [toRef(models.diagnostician), toRef(models.executor)],
      phase: legalPhase(state.phase, "planning"),
      reason: `执行模型申请重新规划：${state.replanRequested.reason}`,
      injectPlanInstruction: true,
    };
  }

  if (situation.needsPlanning && !fused) {
    return {
      action: "PLAN",
      target: toRef(models.planner),
      fallback: [toRef(models.diagnostician), toRef(models.executor)],
      phase: legalPhase(state.phase, "planning"),
      reason: "任务范围较大，先由强模型生成结构化执行计划",
      injectPlanInstruction: true,
    };
  }

  if (state.plan && !fused) {
    return {
      action: "EXECUTE_PLAN",
      target: toRef(models.executor),
      fallback: [toRef(models.planner), toRef(models.fast)],
      phase: legalPhase(state.phase, "execution"),
      reason: "计划已经确定，降级到执行模型完成具体工作",
    };
  }

  // —— 成本型切换：受熔断限制 ——
  if (situation.complexity < 0.35 || fused) {
    const ref = fused ? (fusedRef as string) : models.fast;
    return {
      action: fused ? "KEEP" : "DOWNSHIFT",
      target: toRef(ref),
      fallback: [toRef(models.executor)],
      phase: fused ? state.phase : legalPhase(state.phase, "discovery"),
      reason: fused
        ? `模型黏性熔断（switchCount=${state.switchCount}>=${maxSwitch}），黏在当前模型`
        : "任务简单，可由快速模型完成",
    };
  }

  return {
    action: "KEEP",
    target: toRef(models.executor),
    fallback: [toRef(models.planner), toRef(models.fast)],
    phase: legalPhase(state.phase, "execution"),
    reason: "普通复杂度任务，使用默认执行模型",
  };
}
