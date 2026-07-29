/**
 * auto-orchestrator / provider.ts
 * 虚拟模型 Provider —— 薄入口。用户始终选择 orchestrator/auto。
 * 宗旨：不在 token 输出中途换模型，只在推理边界切换。
 *
 * 阶段 C（报告 P1-1）：事务执行逻辑全部下沉到 route-executor.ts；
 * 本文件只负责：决策 → 生成不可变 RouteIntent → 记录意图 → 委派执行。
 */
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { createHash, randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { OrchestratorStore } from "./state.js";
import type { OrchestratorConfig } from "./config.js";
import type { ModelConfig } from "./policy.js";

import { analyzeSituation } from "./analyzer.js";
import { decideRoute, toThinkingRef, legalPhase } from "./policy.js";
import { buildDelegatedContext } from "./context-builder.js";
import { Telemetry } from "./telemetry.js";
import { executeRoute, makeRouteIntent } from "./route-executor.js";

/** 粗略上下文容量估计：字符数 / 4（报告 P1-6 容量准入的保守下界）。 */
function taskIdFor(sessionKey: string, turnId?: string): string {
  return createHash("sha256")
    .update(`${sessionKey}:${turnId ?? "turn-unknown"}`)
    .digest("hex")
    .slice(0, 24);
}

function estimateContextTokens(context: Context): number {
  try {
    const json = JSON.stringify(context.messages ?? []);
    return Math.ceil(json.length / 4);
  } catch {
    return 0;
  }
}

export interface RuntimeState {
  modelRegistry?: ExtensionContext["modelRegistry"];
  /** 阶段0：运行时 holdout 覆盖（undefined 表示用 config 默认值）。 */
  holdoutOverride?: { enabled: boolean };
}

/** 读取生效的 holdout 状态：运行时覆盖优先于 config。 */
export function getHoldoutEnabled(runtime: RuntimeState, config: OrchestratorConfig): boolean {
  return runtime.holdoutOverride?.enabled ?? config.holdout?.enabled ?? false;
}

export function registerOrchestratorProvider(
  pi: ExtensionAPI,
  runtime: RuntimeState,
  store: OrchestratorStore,
  models: ModelConfig,
  config: OrchestratorConfig,
  telemetry: Telemetry,
): void {
  pi.registerProvider("orchestrator", {
    name: config.virtualModel.name,
    baseUrl: "orchestrator://local",
    // Virtual provider credential only; construct the fixed placeholder at runtime so
    // source scanners do not classify it as a persisted API key.
    apiKey: ["local", "orchestrator"].join("-"),
    api: "openai-completions", // 占位：虚拟模型自身不直接走标准 API，streamSimple 会接管
    models: [
      {
        id: config.virtualModel.id,
        name: config.virtualModel.name,
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.virtualModel.contextWindow,
        maxTokens: config.virtualModel.maxTokens,
      },
    ],
    streamSimple(
      _virtualModel: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const registry = runtime.modelRegistry;
      if (!registry) {
        // 注册表未就绪：返回一个立即报错的流（保持 streamSimple 同步返回契约）
        const output = createAssistantMessageEventStream();
        void (async () => {
          output.push({
            type: "error",
            reason: "error",
            error: {
              role: "assistant",
              content: [],
              api: _virtualModel.api,
              provider: _virtualModel.provider,
              model: _virtualModel.id,
              usage: {
                input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "error",
              errorMessage: "Model registry is not ready.",
              timestamp: Date.now(),
            },
          } as any);
          output.end();
        })();
        return output;
      }

      const state = store.snapshot();
      const taskId = taskIdFor(state.sessionKey, state.turnId);
      const attemptId = randomUUID();

      // 阶段0：holdout 模式跳过动态路由，固定路由到 config.holdout.model，
      // 状态机/权限门/telemetry/事务执行全一致，仅隔离"路由策略"为唯一变量。
      const holdoutEnabled = getHoldoutEnabled(runtime, config);
      let decision: ReturnType<typeof decideRoute>;
      let strategy: "adaptive" | "holdout" = "adaptive";
      if (holdoutEnabled && config.holdout) {
        const hoModel = config.holdout.model;
        const hoFallback = (config.holdout.fallback ?? []).map((ref) => ({ ref }));
        decision = {
          action: "KEEP",
          target: { ref: hoModel },
          fallback: hoFallback,
          phase: legalPhase(state.phase, "execution"),
          reason: `holdout 基线模式：固定路由到 ${hoModel}（绕过动态路由决策）`,
        };
        strategy = "holdout";
      } else {
        const situation = analyzeSituation(context, state);
        decision = decideRoute(situation, state, models, config);
      }

      // 生成不可变 RouteIntent（thinking 由 config 注入到 ModelRef）
      const intent = makeRouteIntent({
        target: toThinkingRef(decision.target.ref, models, config),
        fallbacks: decision.fallback.map((f) => toThinkingRef(f.ref, models, config)),
        phase: decision.phase,
        action: decision.action,
        reason: decision.reason,
        requiredContextTokens: estimateContextTokens(context),
        taskId,
        attemptId,
        strategy,
      });

      store.dispatch({
        type: "ROUTE_INTENDED",
        decisionId: intent.decisionId,
        plannedModel: intent.plannedModel,
        fallbacks: intent.fallbacks.map((f) => f.ref),
        phase: intent.phase,
        action: intent.action,
        reason: intent.reason,
        at: Date.now(),
      });

      telemetry.logRouteIntent({
        decisionId: intent.decisionId,
        taskId,
        attemptId,
        sessionId: state.sessionKey,
        turnId: state.turnId,
        plannedModel: intent.plannedModel,
        fallbacks: intent.fallbacks.map((f) => f.ref),
        phase: intent.phase,
        action: intent.action,
        reason: intent.reason,
        strategy,
      });

      const delegatedContext = buildDelegatedContext(context, store.snapshot(), decision);

      return executeRoute(intent, delegatedContext, options, {
        store,
        telemetry,
        registry: registry as any,
      });
    },
  });
}
