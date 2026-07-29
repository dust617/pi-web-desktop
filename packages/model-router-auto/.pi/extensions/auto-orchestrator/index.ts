/**
 * Auto Orchestrator 的监督模式入口。
 *
 * 用户只选择 pi-router/auto；本扩展不注册 Provider、工具或权限拦截。
 * 它只维护会话状态，在必要时生成短时、绑定 session 的 high/ultra 能力下限，
 * 由已打补丁的 pi-model-auto 读取后完成具体模型的成本/能力选择。
 */
import { createHash } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";

import { findConfigFile, loadConfig } from "./config.js";
import { OrchestratorStore } from "./state.js";
import { Telemetry } from "./telemetry.js";
import { clearOwnRouteHint, recommendRouteHint, writeRouteHint, type SupervisorRecommendation } from "./router-supervisor.js";
import { isTestCommand, parseTestsPassed } from "./test-signal.js";

const ROUTER_PROVIDER = "pi-router";
const ROUTER_MODEL = "auto";

function stableKey(toolName: string, input: unknown): string {
  let serialized = "";
  try {
    serialized = JSON.stringify(input ?? {});
  } catch {
    serialized = String(input);
  }
  const hash = createHash("sha256").update(serialized).digest("hex").slice(0, 12);
  return `${toolName}:${hash}`;
}

function isRouterAuto(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === ROUTER_PROVIDER && ctx.model.id === ROUTER_MODEL;
}

function contextForInput(text: string): Context {
  return {
    systemPrompt: "",
    messages: [{
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    }],
  } as Context;
}

function hasExplicitRoutePrefix(text: string): boolean {
  return /^@(low|medium|high|ultra|model:[^\s]+)/i.test(text.trim());
}

function recommendationSummary(value: SupervisorRecommendation | undefined): string {
  if (!value) return "auto（尚无评分）";
  const score = value.score.toFixed(2);
  if (!value.hint) return `auto（score=${score}，未提高能力下限）`;
  return `${value.hint.mode} (score=${score}; ${value.hint.reasonCodes.join(", ")})`;
}

export default function autoOrchestratorSupervisor(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  // 全局安装时，未配置的项目静默不激活；项目配置优先于全局配置。
  if (!findConfigFile(cwd)) return;
  loadConfig(cwd); // 保留既有严格配置校验；监督模式目前不使用 legacy provider roles。

  const store = new OrchestratorStore(cwd);
  const telemetry = new Telemetry(cwd);
  const hypothesisCounts = new Map<string, number>();
  const reportedHypotheses = new Set<string>();
  let latestRecommendation: SupervisorRecommendation | undefined;

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      store.bind(sessionId, "default");
      clearOwnRouteHint(ctx.cwd, sessionId);
    } catch {
      store.bind(`anon-${process.pid}`, "default");
    }
    ctx.ui?.setStatus?.("orchestrator", "🧠 supervisor ready");
  });

  // 此 hook 必须先于 pi-model-auto 的 input hook 注册/加载；全局 packages 已按该顺序配置。
  pi.on("input", async (event: any, ctx: ExtensionContext) => {
    if (event?.source === "extension" || !isRouterAuto(ctx) || !store.isBound()) return { action: "continue" as const };

    const sessionId = ctx.sessionManager.getSessionId();
    if (hasExplicitRoutePrefix(String(event?.text ?? ""))) {
      clearOwnRouteHint(ctx.cwd, sessionId);
      latestRecommendation = undefined;
      return { action: "continue" as const };
    }

    try {
      const turnId = `t${event?.turnIndex ?? "pending"}`;
      latestRecommendation = recommendRouteHint(contextForInput(String(event?.text ?? "")), store.snapshot(), sessionId, turnId);
      if (latestRecommendation.hint) {
        writeRouteHint(ctx.cwd, latestRecommendation.hint);
        telemetry.logSupervisorHint({
          sessionId,
          turnId,
          mode: latestRecommendation.hint.mode,
          score: latestRecommendation.score,
          reasonCodes: latestRecommendation.hint.reasonCodes,
          expiresAt: latestRecommendation.hint.expiresAt,
        });
        ctx.ui?.setStatus?.("orchestrator", `🧠 ${latestRecommendation.hint.mode}`);
      } else {
        clearOwnRouteHint(ctx.cwd, sessionId);
        ctx.ui?.setStatus?.("orchestrator", "🧠 auto");
      }
    } catch {
      // 监督器不可用时必须回退到原生 pi-router/auto，绝不阻塞真实请求。
      latestRecommendation = undefined;
      clearOwnRouteHint(ctx.cwd, sessionId);
    }
    return { action: "continue" as const };
  });

  // 每个用户回合重置 turn/attempt scope；input 已先读取上一回合的停滞证据。
  pi.on("turn_start", async (event: any) => {
    const at = event?.timestamp ?? Date.now();
    const turnId = `t${event?.turnIndex ?? 0}`;
    store.dispatch({ type: "TURN_STARTED", turnId, at });
    store.dispatch({ type: "ATTEMPT_STARTED", attemptId: `supervisor:${store.snapshot().sessionKey}:${turnId}`, turnId, at });
    hypothesisCounts.clear();
    reportedHypotheses.clear();
  });

  pi.on("turn_end", async (event: any) => {
    store.dispatch({ type: "TURN_ENDED", turnId: `t${event?.turnIndex ?? 0}`, at: Date.now() });
  });

  // 仅采集客观进展，不注册任何会调用额外模型的 orchestrator 工具，也不拦截权限。
  pi.on("tool_result", async (event: any) => {
    const toolName: string = event?.toolName ?? "";
    const isError: boolean = !!event?.isError;
    const at = Date.now();

    if (isError) store.dispatch({ type: "TOOL_FAILED", toolName, at });
    else store.dispatch({ type: "TOOL_SUCCEEDED", toolName, at });

    const input = event?.input as { path?: unknown; file?: unknown; pattern?: unknown; command?: unknown } | undefined;
    if (!isError && (toolName === "edit" || toolName === "write")) {
      const target = input?.path ?? input?.file;
      if (target) store.dispatch({ type: "EVIDENCE_OBSERVED", kind: "file_modified", key: String(target), at });
    }
    if (!isError && (toolName === "read" || toolName === "grep" || toolName === "find")) {
      const target = input?.path ?? input?.pattern;
      if (target) store.dispatch({ type: "EVIDENCE_OBSERVED", kind: "file_read", key: String(target), at });
    }
    if (!isError && toolName === "bash" && isTestCommand(String(input?.command ?? ""))) {
      const output = Array.isArray(event?.content)
        ? event.content.map((item: unknown) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : "").join("\n")
        : "";
      const passed = parseTestsPassed(output);
      if (passed !== null) store.dispatch({ type: "TEST_OBSERVED", passed, at });
    }

    const key = stableKey(toolName, event?.input);
    const count = (hypothesisCounts.get(key) ?? 0) + 1;
    hypothesisCounts.set(key, count);
    if (count >= 3 && !reportedHypotheses.has(key)) {
      reportedHypotheses.add(key);
      store.dispatch({ type: "HYPOTHESIS_REPEATED", at });
    }
  });

  pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
    try {
      clearOwnRouteHint(ctx.cwd, ctx.sessionManager.getSessionId());
    } catch {
      // session manager unavailable during shutdown; the router additionally validates TTL/session.
    }
  });

  pi.registerCommand("orchestrator", {
    description: "Show Pi Router supervisor state; this command never changes the selected model",
    handler: async (_args, ctx) => {
      const state = store.snapshot();
      ctx.ui?.notify?.(
        [
          "Mode: supervisor (Pi Router remains the only model entry)",
          `Session: ${state.sessionKey} / ${state.taskKey} (bound=${store.isBound()})`,
          `Last recommendation: ${recommendationSummary(latestRecommendation)}`,
          `Phase: ${state.phase}; progress: ${state.progressScore}`,
          `Tool failures (last attempt): ${state.toolFailuresThisAttempt}; repeated failures: ${state.sameFailureCount}`,
          `Tests: ${state.lastTestsPassed ?? "n/a"} passed (Δ ${state.testsPassedDelta}, runs ${state.testRunCount})`,
          `Persist failures: ${store.getPersistFailureCount()}; telemetry writes: ${telemetry.getHealth().entriesWritten}`,
        ].join("\n"),
        "info",
      );
    },
  });
}
