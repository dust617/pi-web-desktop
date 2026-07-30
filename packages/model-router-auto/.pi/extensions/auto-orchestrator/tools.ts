/**
 * auto-orchestrator / tools.ts
 * 控制工具：commit_plan / request_escalation / consensus_review / request_replan / mark_progress。
 * 宗旨三：工作模型可调用这些工具"申请"，但最终路由仍由 policy 决定。
 *
 * 阶段 B（报告 P0-3）：所有工具只通过 store.dispatch(event) 变更状态，
 * 不再拿到可变状态引用。escalation/replan 的消费语义由 reducer 统一执行。
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { OrchestratorStore } from "./state.js";
import { runConsensus } from "./verifier.js";
import type { OrchestratorConfig } from "./config.js";
import type { Telemetry } from "./telemetry.js";

const CommitPlanParams = Type.Object({
  goal: Type.String({ description: "任务目标" }),
  assumptions: Type.Optional(Type.Array(Type.String(), { description: "假设" })),
  steps: Type.Array(Type.String(), { description: "实施步骤（有序）" }),
  files: Type.Optional(Type.Array(Type.String(), { description: "需要改动的文件" })),
  acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: "验收标准" })),
  risks: Type.Optional(Type.Array(Type.String(), { description: "风险" })),
});

const RequestEscalationParams = Type.Object({
  reason: Type.String({ description: "申请升级的原因" }),
  requiredCapabilities: Type.Optional(Type.Array(Type.String(), { description: "所需能力" })),
  currentProblem: Type.Optional(Type.String({ description: "当前遇到的障碍" })),
});

const MarkProgressParams = Type.Object({
  summary: Type.String({ description: "具体进展证据（做了什么/解决了什么）" }),
  progressScore: Type.Number({ minimum: 0, maximum: 1, description: "进度评分 0-1" }),
  resolvedErrorSignature: Type.Optional(Type.String({ description: "已解决的错误签名" })),
});

const RequestReplanParams = Type.Object({
  reason: Type.String({ description: "为何需要重新规划（计划太抽象/前置假设不成立/遇不可跳过的高风险步骤等）" }),
  failedStep: Type.Optional(Type.String({ description: "失败的步骤" })),
  evidence: Type.Optional(Type.String({ description: "证据" })),
});

export function registerOrchestratorTools(
  pi: ExtensionAPI,
  store: OrchestratorStore,
  config: OrchestratorConfig,
  telemetry?: Telemetry,
  runtime?: { holdoutOverride?: { enabled: boolean } },
): void {
  // commit_plan：强模型产出结构化计划后调用，落库并切换到 execution
  pi.registerTool(defineTool({
    name: "commit_plan",
    label: "Commit Plan",
    description:
      "提交结构化计划（PlanPacket）。仅规划阶段调用，调用后进入 execution 阶段。",
    parameters: CommitPlanParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      store.dispatch({ type: "PLAN_COMMITTED", plan: params as any, at: Date.now() });
      return {
        content: [{ type: "text" as const, text: `plan committed: ${params.steps.length} steps, phase=execution` }],
        details: { phase: "execution", stepCount: params.steps.length },
      };
    },
  }));

  // request_escalation：工作模型申请升级到更强模型（不保证执行）
  pi.registerTool(defineTool({
    name: "request_escalation",
    label: "Request Escalation",
    description:
      "申请升级到更强模型。需说明原因与当前障碍。最终是否升级由 policy 决定。一次申请最多触发一次有效复核消费。",
    parameters: RequestEscalationParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      store.dispatch({
        type: "ESCALATION_REQUESTED",
        reason: params.reason,
        requiredCapabilities: params.requiredCapabilities,
        currentProblem: params.currentProblem,
        at: Date.now(),
      });
      return {
        content: [{ type: "text" as const, text: "escalation recorded; stop repeating the same approach; policy will evaluate at next boundary" }],
        details: { requested: true, phase: "stalled" },
      };
    },
  }));

  // consensus_review：多模型独立复核（宗旨六：独立分析+证据+分歧，非投票）
  // 阶段 D 将把 verifier 结构化结果（超时/空响应/分歧）映射到 REVIEW_COMPLETED.outcome
  pi.registerTool(defineTool({
    name: "consensus_review",
    label: "Consensus Review",
    description:
      "高风险或不确定结论收敛前，调多个独立模型复核。需提供问题与证据包（不提供主模型完整论证，避免带偏）。",
    parameters: Type.Object({
      question: Type.String({ description: "需验证的问题" }),
      evidence: Type.String({ description: "证据包（不含主模型完整论证）" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const reviewers = config.models.reviewers.map((ref, i) => ({
        ref,
        role: ["primary", "adversarial", "skeptical"][i % 3] ?? `reviewer-${i}`,
      })).slice(0, config.limits.maxReviewers);
      const { results, summary } = await runConsensus({ question: params.question, evidence: params.evidence }, reviewers, ctx.cwd);
      // 阶段 D：结构化复核结果映射到 outcome（全 ok=completed；有 timeout=timeout；其余=failed）
      const outcome = results.every((r) => r.ok)
        ? "completed"
        : results.some((r) => r.status === "timeout")
          ? "timeout"
          : "failed";
      store.dispatch({
        type: "REVIEW_COMPLETED",
        outcome,
        questionSummary: params.question.slice(0, 80),
        at: Date.now(),
      });
      telemetry?.logReviewCompleted({
        outcome,
        reviewerCount: reviewers.length,
        statuses: results.map((r) => `${r.role}:${r.status}`),
      });
      return {
        content: [{ type: "text" as const, text: summary }],
        details: {
          reviewerCount: reviewers.length,
          outcome,
          statuses: results.map((r) => `${r.role}:${r.status}`),
        },
      };
    },
  }));

  // request_replan：执行模型遇计划无法执行时回退到规划
  // 宗旨：执行模型不能任意修改计划，遇障碍应 request_replan 而非自行重新设计
  pi.registerTool(defineTool({
    name: "request_replan",
    label: "Request Replan",
    description:
      "当前计划无法继续执行时调用（计划太抽象/前置假设不成立/遇不可跳过的高风险步骤）。回退到 planning 阶段重新规划，而非自行修改计划核心。",
    parameters: RequestReplanParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      store.dispatch({
        type: "REPLAN_REQUESTED",
        reason: params.reason,
        failedStep: params.failedStep,
        at: Date.now(),
      });
      return {
        content: [{ type: "text" as const, text: "replan requested; policy will route to planner at next boundary" }],
        details: { phase: "planning", reason: params.reason },
      };
    },
  }));

  // mark_progress：工作模型主动记录进展（阶段3 进展账本入口）
  pi.registerTool(defineTool({
    name: "mark_progress",
    label: "Mark Progress",
    description:
      "记录具体进展证据。进展≥0.5 时重置失败计数，避免误判停滞。resolvedErrorSignature 需与当前错误签名一致才清除错误 streak。",
    parameters: MarkProgressParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      store.dispatch({
        type: "PROGRESS_MARKED",
        summary: params.summary,
        progressScore: params.progressScore,
        resolvedErrorSignature: params.resolvedErrorSignature,
        at: Date.now(),
      });
      return {
        content: [{ type: "text" as const, text: "progress state updated" }],
        details: { progressScore: params.progressScore },
      };
    },
  }));

  // orchestrator_holdout（阶段0）：运行时切换固定策略 holdout 基线模式
  // 不改 config 文件，只改运行时 override；/reload 或重启后回到 config 默认值
  pi.registerTool(defineTool({
    name: "orchestrator_holdout",
    label: "Holdout Toggle",
    description:
      "查询或切换固定策略 holdout 基线模式。无参数=查状态；{enabled:true}=开 holdout（固定路由到 config.holdout.model）；{enabled:false}=关。阶段0基线采集用。",
    parameters: Type.Object({
      enabled: Type.Optional(Type.Boolean({ description: "true=开 holdout 基线，false=关（恢复动态路由）" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (params.enabled === undefined) {
        const current = runtime?.holdoutOverride?.enabled ?? config.holdout?.enabled ?? false;
        const model = config.holdout?.model ?? "(未配置)";
        return {
          content: [{ type: "text" as const, text: `holdout=${current ? "ON" : "OFF"}, model=${current ? model : "(动态路由)"}` }],
          details: { holdout: current, model: current ? model : undefined, baseline: config.holdout?.model },
        };
      }
      if (runtime) runtime.holdoutOverride = { enabled: params.enabled };
      return {
        content: [{ type: "text" as const, text: `holdout set to ${params.enabled ? "ON" : "OFF"}${params.enabled ? " (基线=" + (config.holdout?.model ?? "?") + ")" : " (恢复动态路由)"}` }],
        details: { holdout: params.enabled },
      };
    },
  }));
}
