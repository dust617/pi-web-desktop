/**
 * Pi Router telemetry companion.
 *
 * Observes the existing pi-model-auto virtual model (pi-router/auto) without
 * registering a provider or calling pi.setModel(), so it cannot replace the
 * user's selected Pi Router (Auto) model.  It writes compatible telemetry v2
 * records to the active project's .pi/orchestrator-telemetry.v2.jsonl.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import {
  Telemetry,
  type RouteIntentEntry,
  type RouteOutcomeEntry,
} from "../auto-orchestrator/telemetry.js";

const ROUTER_PROVIDER = "pi-router";
const ROUTER_MODEL = "auto";

export type PendingRoute = {
  decisionId: string;
  taskId: string;
  attemptId: string;
  startedAt: number;
};

export function isPiRouterAuto(model: Model<any> | undefined): boolean {
  return model?.provider === ROUTER_PROVIDER && model.id === ROUTER_MODEL;
}

type AssistantLike = {
  role: string;
  provider?: string;
  model?: string;
  responseModel?: string;
  stopReason?: string;
  errorMessage?: string;
};

function asAssistant(message: unknown): AssistantLike | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as AssistantLike;
  return candidate.role === "assistant" ? candidate : undefined;
}

export function modelRef(message: unknown): string | undefined {
  const assistant = asAssistant(message);
  if (!assistant?.provider || !(assistant.responseModel ?? assistant.model)) return undefined;
  return `${assistant.provider}/${assistant.responseModel ?? assistant.model}`;
}

function outcomeStatus(message: unknown): "success" | "failed" | "aborted" {
  const assistant = asAssistant(message);
  if (!assistant) return "failed";
  if (assistant.stopReason === "aborted") return "aborted";
  return assistant.stopReason === "error" ? "failed" : "success";
}

/**
 * 仅在收到真实 turn_end 时构造成对事件。slash command 可能有 turn_start 而没有
 * provider 响应/turn_end；这类交互不应污染可审计样本，也不应留下孤儿 intent。
 */
export function completedRouteRecords(
  pending: PendingRoute,
  sessionId: string,
  turnIndex: number,
  message: unknown,
  endedAt = Date.now(),
): { intent: RouteIntentEntry; outcome: RouteOutcomeEntry } {
  const status = outcomeStatus(message);
  return {
    intent: {
      decisionId: pending.decisionId,
      taskId: pending.taskId,
      attemptId: pending.attemptId,
      sessionId,
      turnId: String(turnIndex),
      plannedModel: "pi-router/auto",
      fallbacks: [],
      phase: "ROUTE",
      action: "DELEGATE",
      reason: "pi-model-auto virtual router selected",
      strategy: "adaptive",
    },
    outcome: {
      decisionId: pending.decisionId,
      taskId: pending.taskId,
      attemptId: pending.attemptId,
      status,
      actualModel: modelRef(message),
      fallbackIndex: 0,
      errorCategory: status === "failed" ? "unknown" : undefined,
      errorMessage: asAssistant(message)?.errorMessage,
      latencyMs: Math.max(0, endedAt - pending.startedAt),
      committed: status === "success",
    },
  };
}

/** Global-safe companion: never calls pi.setModel and never registers pi-router. */
export default function piRouterTelemetry(pi: ExtensionAPI): void {
  const telemetryByCwd = new Map<string, Telemetry>();
  const pendingByTurn = new Map<string, PendingRoute>();
  let taskSequence = 0;
  let activeTask: { cwd: string; sessionId: string; taskId: string } | undefined;
  let observedModelChanges = 0;
  let lastObservedModel = "unknown";

  const telemetryFor = (cwd: string): Telemetry => {
    let telemetry = telemetryByCwd.get(cwd);
    if (!telemetry) {
      telemetry = new Telemetry(cwd);
      telemetryByCwd.set(cwd, telemetry);
    }
    return telemetry;
  };

  pi.on("model_select", (event) => {
    observedModelChanges += 1;
    lastObservedModel = `${event.model.provider}/${event.model.id}`;
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!isPiRouterAuto(ctx.model)) {
      activeTask = undefined;
      return;
    }
    taskSequence += 1;
    const sessionId = ctx.sessionManager.getSessionId();
    activeTask = {
      cwd: ctx.cwd,
      sessionId,
      taskId: `pi-router:${sessionId}:${taskSequence}`,
    };
  });

  pi.on("turn_start", (event, ctx) => {
    if (!isPiRouterAuto(ctx.model)) return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (!activeTask || activeTask.cwd !== ctx.cwd || activeTask.sessionId !== sessionId) {
      taskSequence += 1;
      activeTask = { cwd: ctx.cwd, sessionId, taskId: `pi-router:${sessionId}:${taskSequence}` };
    }

    const decisionId = `${activeTask.taskId}:turn:${event.turnIndex}`;
    const pending: PendingRoute = {
      decisionId,
      taskId: activeTask.taskId,
      attemptId: `${decisionId}:attempt:0`,
      startedAt: event.timestamp,
    };
    pendingByTurn.set(`${sessionId}:${event.turnIndex}`, pending);
  });

  pi.on("turn_end", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const key = `${sessionId}:${event.turnIndex}`;
    const pending = pendingByTurn.get(key);
    if (!pending) return;
    pendingByTurn.delete(key);

    const records = completedRouteRecords(pending, sessionId, event.turnIndex, event.message);
    const telemetry = telemetryFor(ctx.cwd);
    telemetry.logRouteIntent(records.intent);
    telemetry.logRouteOutcome(records.outcome);
  });

  // 某些 slash command 触发 turn_start 后会直接 settled，不会产生 provider 响应。
  // 它们不会写 telemetry；此处释放尚未终结的内存 pending，避免长期会话累积。
  pi.on("agent_settled", (_event, ctx) => {
    const prefix = `${ctx.sessionManager.getSessionId()}:`;
    for (const key of pendingByTurn.keys()) {
      if (key.startsWith(prefix)) pendingByTurn.delete(key);
    }
  });

  pi.registerCommand("router-telemetry-status", {
    description: "Show Pi Router telemetry companion status without changing the selected model",
    handler: async (_args, ctx: ExtensionContext) => {
      const current = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
      const health = telemetryFor(ctx.cwd).getHealth();
      ctx.ui.notify(
        [
          `current model: ${current}`,
          `Pi Router (Auto) active: ${isPiRouterAuto(ctx.model) ? "yes" : "no"}`,
          `observed model_select: ${observedModelChanges} (last: ${lastObservedModel})`,
          `telemetry writes: ${health.entriesWritten}, failures: ${health.writeFailures}`,
          "This companion never calls pi.setModel or registers a provider.",
        ].join("\n"),
        "info",
      );
    },
  });
}
