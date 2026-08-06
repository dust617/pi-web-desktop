/**
 * auto-orchestrator / route-executor.ts
 * 阶段 C（报告 P1-1/P1-2）：路由事务执行器。
 *
 * 事务语义：
 * 1. 先生成不可变 RouteIntent（决策快照）；
 * 2. 逐候选尝试，首个"实质内容事件"（text/thinking/toolcall delta）为 commit boundary：
 *    - commit 前失败 → retryable，可 fallback 到下一候选；
 *    - commit 后失败 → terminal，禁止中途拼接另一个模型；
 * 3. start 事件在 commit 前缓冲，保证外部流只出现一次 start；
 * 4. 用户 abort（signal 或 stopReason=aborted）→ 立即终止，不再 fallback；
 * 5. 终止事件（done/error）只发一次；outcome 在终止后才确定。
 *
 * 容量准入：候选模型 contextWindow 小于 intent.requiredContextTokens 时跳过（retryable）。
 */
import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
  type Context,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple as defaultDelegate } from "@earendil-works/pi-ai/compat";
import { randomUUID } from "node:crypto";

import type { OrchestratorStore } from "./state.js";
import type { Telemetry } from "./telemetry.js";
import type { ModelRef, Phase, RouteAction } from "./types.js";

export interface RouteIntent {
  decisionId: string;
  taskId: string;
  attemptId: string;
  plannedModel: string;
  target: ModelRef;
  fallbacks: ModelRef[];
  phase: Phase;
  action: RouteAction;
  reason: string;
  requiredContextTokens?: number;
  /** 路由策略标记（阶段0）。默认 adaptive；holdout 表示固定策略基线。 */
  strategy?: "adaptive" | "holdout";
  createdAt: number;
}

export function makeRouteIntent(params: {
  target: ModelRef;
  taskId?: string;
  attemptId?: string;
  fallbacks: ModelRef[];
  phase: Phase;
  action: RouteAction;
  reason: string;
  requiredContextTokens?: number;
  strategy?: "adaptive" | "holdout";
  now?: () => number;
}): RouteIntent {
  const intent: RouteIntent = {
    decisionId: randomUUID(),
    taskId: params.taskId ?? "unlabeled-task",
    attemptId: params.attemptId ?? randomUUID(),
    plannedModel: params.target.ref,
    target: params.target,
    fallbacks: params.fallbacks,
    phase: params.phase,
    action: params.action,
    reason: params.reason,
    requiredContextTokens: params.requiredContextTokens,
    strategy: params.strategy,
    createdAt: (params.now ?? Date.now)(),
  };
  return Object.freeze(intent);
}

export type RouteOutcomeStatus = "success" | "failed" | "aborted";

export interface RouteOutcome {
  decisionId: string;
  status: RouteOutcomeStatus;
  actualModel?: string;
  fallbackIndex?: number;
  errorCategory?: "retryable" | "terminal" | "unknown";
  errorMessage?: string;
  latencyMs: number;
  committed: boolean;
}

export interface ModelRegistryLike {
  find?(provider: string, modelId: string): any;
  getApiKeyAndHeaders?(model: any): Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string> } | undefined>;
}

export type DelegateFn = (model: any, context: Context, options?: SimpleStreamOptions) => AsyncIterable<any>;

export interface RouteExecutorDeps {
  store: OrchestratorStore;
  telemetry: Telemetry;
  registry: ModelRegistryLike;
  delegate?: DelegateFn;
  now?: () => number;
}

function parseModelRef(ref: string): { provider: string; modelId: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    throw new Error(`Invalid model reference: ${ref}`);
  }
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  return typeof error === "object" && error !== null && (error as any).aborted === true;
}

const CONTENT_EVENT_TYPES = new Set([
  "text_delta",
  "thinking_delta",
  "toolcall_delta",
  "toolcall_end",
]);

export function executeRoute(
  intent: RouteIntent,
  context: Context,
  options: SimpleStreamOptions | undefined,
  deps: RouteExecutorDeps,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const now = deps.now ?? Date.now;
  const delegate = deps.delegate ?? (defaultDelegate as DelegateFn);
  const { store, telemetry, registry } = deps;

  void (async () => {
    const startedAt = now();
    let outcome: RouteOutcome = {
      decisionId: intent.decisionId,
      status: "failed",
      errorCategory: "unknown",
      errorMessage: "No available model completed the request.",
      latencyMs: 0,
      committed: false,
    };
    let outcomeLogged = false;
    const logOutcome = (value: RouteOutcome): void => {
      outcomeLogged = true;
      telemetry.logRouteOutcome({
        ...value,
        taskId: intent.taskId,
        attemptId: intent.attemptId,
      });
    };
    let startForwarded = false; // 外部流只允许一次 start
    let bufferedStart: any | undefined;
    let terminalEmitted = false;

    const emitTerminalError = (reason: "error" | "aborted", message: string, virtualModelLike?: any) => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      output.push({
        type: "error",
        reason,
        error: {
          role: "assistant",
          content: [],
          api: virtualModelLike?.api ?? "openai-completions",
          provider: virtualModelLike?.provider ?? "orchestrator",
          model: virtualModelLike?.id ?? "auto",
          usage: {
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: reason,
          errorMessage: message,
          timestamp: now(),
        },
      } as any);
      output.end();
    };

    try {
      const candidates: ModelRef[] = [intent.target, ...intent.fallbacks];
      let lastError: unknown;

      for (let idx = 0; idx < candidates.length; idx++) {
        const candidate = candidates[idx];
        const { provider, modelId } = parseModelRef(candidate.ref);
        if (provider === "orchestrator") continue; // 防递归

        // 每个候选前后检查 abort
        if (options?.signal?.aborted) {
          outcome = { ...outcome, status: "aborted", latencyMs: now() - startedAt };
          store.dispatch({ type: "MODEL_ATTEMPT_ABORTED", decisionId: intent.decisionId, at: now() });
          break;
        }

        const attemptId = randomUUID();
        store.dispatch({ type: "ATTEMPT_STARTED", attemptId, at: now() });

        const targetModel = registry.find?.(provider, modelId);
        if (!targetModel) {
          lastError = new Error(`Model not found: ${candidate.ref}`);
          store.dispatch({
            type: "MODEL_ATTEMPT_FAILED",
            decisionId: intent.decisionId,
            errorCategory: "retryable",
            errorMessage: `Model not found: ${candidate.ref}`,
            at: now(),
          });
          continue;
        }

        // 容量准入：真实候选 contextWindow 不足则跳过
        if (
          intent.requiredContextTokens !== undefined &&
          typeof targetModel.contextWindow === "number" &&
          targetModel.contextWindow > 0 &&
          targetModel.contextWindow < intent.requiredContextTokens
        ) {
          lastError = new Error(`Context window too small for ${candidate.ref}`);
          store.dispatch({
            type: "MODEL_ATTEMPT_FAILED",
            decisionId: intent.decisionId,
            errorCategory: "retryable",
            errorMessage: `Context window too small: ${targetModel.contextWindow} < ${intent.requiredContextTokens}`,
            at: now(),
          });
          continue;
        }

        const auth = await registry.getApiKeyAndHeaders?.(targetModel);
        // 认证成功：apiKey 或 headers 任一存在即可（header-only auth 合法）
        const hasAuth = auth?.ok && (auth?.apiKey || (auth?.headers && Object.keys(auth.headers).length > 0));
        if (!hasAuth) {
          lastError = new Error(`Authentication unavailable for ${candidate.ref}`);
          store.dispatch({
            type: "MODEL_ATTEMPT_FAILED",
            decisionId: intent.decisionId,
            errorCategory: "retryable",
            errorMessage: `Authentication unavailable for ${candidate.ref}`,
            at: now(),
          });
          continue;
        }

        let committed = false;
        let failureReported = false;

        try {
          const delegated = delegate(targetModel, context, {
            ...options,
            apiKey: auth?.apiKey,
            headers: auth?.headers,
            reasoning: targetModel.reasoning ? candidate.thinking : undefined,
          });

          for await (const event of delegated) {
            // start 事件缓冲到 commit，保证外部流只有一次 start
            if (event.type === "start") {
              if (!startForwarded) bufferedStart = event;
              continue;
            }

            if (CONTENT_EVENT_TYPES.has(event.type)) {
              if (!committed) {
                committed = true;
                store.dispatch({
                  type: "ROUTE_COMMITTED",
                  decisionId: intent.decisionId,
                  actualModel: candidate.ref,
                  fallbackIndex: idx,
                  at: now(),
                });
                // commit boundary：此刻才把缓冲的 start 发给外部流
                if (!startForwarded && bufferedStart) {
                  startForwarded = true;
                  output.push(bufferedStart);
                }
              }
              output.push(event);
              continue;
            }

            if (event.type === "error" && !committed) {
              // 首包前失败：retryable，丢弃该候选缓冲的 start，允许 fallback
              const errMsg = (event as any).error?.errorMessage ?? "Model failed before output.";
              failureReported = true;
              bufferedStart = undefined;
              store.dispatch({
                type: "MODEL_ATTEMPT_FAILED",
                decisionId: intent.decisionId,
                errorCategory: "retryable",
                errorMessage: errMsg,
                at: now(),
              });
              throw new Error(errMsg);
            }

            if (event.type === "done") {
              const stopReason = (event as any).message?.stopReason;
              if (stopReason === "aborted") {
                store.dispatch({ type: "MODEL_ATTEMPT_ABORTED", decisionId: intent.decisionId, at: now() });
                outcome = {
                  decisionId: intent.decisionId,
                  status: "aborted",
                  actualModel: committed ? candidate.ref : undefined,
                  fallbackIndex: committed ? idx : undefined,
                  latencyMs: now() - startedAt,
                  committed,
                };
                output.push(event);
                output.end();
                terminalEmitted = true;
                logOutcome({
                  decisionId: intent.decisionId,
                  status: "aborted",
                  actualModel: outcome.actualModel,
                  fallbackIndex: outcome.fallbackIndex,
                  latencyMs: outcome.latencyMs,
                  committed,
                });
                return;
              }
              if (stopReason === "error") {
                const errMsg = (event as any).message?.errorMessage ?? "model stop error";
                failureReported = true;
                const category = committed ? "terminal" : "retryable";
                store.dispatch({
                  type: "MODEL_ATTEMPT_FAILED",
                  decisionId: intent.decisionId,
                  errorCategory: category,
                  errorMessage: errMsg,
                  at: now(),
                });
                if (committed) {
                  // 已提交后的错误：终止事务，不 fallback；把 done 事件透传后结束
                  outcome = {
                    decisionId: intent.decisionId,
                    status: "failed",
                    actualModel: candidate.ref,
                    fallbackIndex: idx,
                    errorCategory: "terminal",
                    errorMessage: errMsg,
                    latencyMs: now() - startedAt,
                    committed: true,
                  };
                  output.push(event);
                  output.end();
                  terminalEmitted = true;
                  logOutcome({
                    decisionId: intent.decisionId,
                    status: "failed",
                    actualModel: candidate.ref,
                    fallbackIndex: idx,
                    errorCategory: "terminal",
                    errorMessage: errMsg,
                    latencyMs: now() - startedAt,
                    committed: true,
                  });
                  return;
                }
                // 未提交的 done(error)：丢弃该候选，继续 fallback
                bufferedStart = undefined;
                lastError = new Error(errMsg);
                break; // 跳出事件循环，进入下一候选
              }
              // 成功终止
              store.dispatch({ type: "MODEL_ATTEMPT_SUCCEEDED", decisionId: intent.decisionId, at: now() });
              outcome = {
                decisionId: intent.decisionId,
                status: "success",
                actualModel: candidate.ref,
                fallbackIndex: idx,
                latencyMs: now() - startedAt,
                committed,
              };
              output.push(event);
              output.end();
              terminalEmitted = true;
              logOutcome({
                decisionId: intent.decisionId,
                status: "success",
                actualModel: candidate.ref,
                fallbackIndex: idx,
                latencyMs: now() - startedAt,
                committed,
              });
              return;
            }

            // 其他事件（如 message 元数据）：commit 后透传，commit 前丢弃
            if (committed) output.push(event);
          }

          // 事件流自然结束但没有 done：视为未提交失败，继续 fallback
          if (!terminalEmitted && !committed) {
            lastError = lastError ?? new Error(`Stream ended without terminal event: ${candidate.ref}`);
            continue;
          }
          if (terminalEmitted) return;
        } catch (error) {
          lastError = error;
          if (isAbortError(error) || options?.signal?.aborted) {
            if (!failureReported) {
              store.dispatch({ type: "MODEL_ATTEMPT_ABORTED", decisionId: intent.decisionId, at: now() });
            }
            outcome = {
              decisionId: intent.decisionId,
              status: "aborted",
              actualModel: committed ? candidate.ref : undefined,
              fallbackIndex: committed ? idx : undefined,
              latencyMs: now() - startedAt,
              committed,
            };
            break; // 用户取消：不再 fallback
          }
          if (!failureReported) {
            store.dispatch({
              type: "MODEL_ATTEMPT_FAILED",
              decisionId: intent.decisionId,
              errorCategory: committed ? "terminal" : "retryable",
              errorMessage: error instanceof Error ? error.message : String(error),
              at: now(),
            });
          }
          if (committed) {
            outcome = {
              decisionId: intent.decisionId,
              status: "failed",
              actualModel: candidate.ref,
              fallbackIndex: idx,
              errorCategory: "terminal",
              errorMessage: error instanceof Error ? error.message : String(error),
              latencyMs: now() - startedAt,
              committed: true,
            };
            break; // 已提交后失败：终止
          }
          // 未提交：继续下一个候选
        }
      }

      // 所有候选耗尽或 abort/terminal break
      if (outcome.status === "aborted") {
        emitTerminalError("aborted", "Request aborted by user.");
      } else {
        emitTerminalError(
          "error",
          lastError instanceof Error ? lastError.message : (outcome.errorMessage ?? "No available model completed the request."),
        );
      }
      logOutcome({
        decisionId: intent.decisionId,
        status: outcome.status,
        actualModel: outcome.actualModel,
        fallbackIndex: outcome.fallbackIndex,
        errorCategory: outcome.errorCategory,
        errorMessage: outcome.errorMessage,
        latencyMs: now() - startedAt,
        committed: outcome.committed,
      });
    } catch (error) {
      // 意外异常也必须闭合 intent/outcome，否则会制造无法审计的孤儿 intent。
      // 正常分支已经记录过 outcome 时不重复写入。
      if (!outcomeLogged) {
        const aborted = isAbortError(error) || options?.signal?.aborted === true;
        outcome = {
          ...outcome,
          status: aborted ? "aborted" : "failed",
          errorCategory: aborted ? undefined : "unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
          latencyMs: now() - startedAt,
        };
        if (aborted) {
          store.dispatch({ type: "MODEL_ATTEMPT_ABORTED", decisionId: intent.decisionId, at: now() });
        }
        logOutcome(outcome);
      }
      emitTerminalError(
        outcome.status === "aborted" ? "aborted" : "error",
        outcome.errorMessage ?? "Unexpected route execution error.",
      );
    }
  })();

  return output;
}
