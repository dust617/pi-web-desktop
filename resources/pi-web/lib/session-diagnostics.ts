import { appendFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * Best-effort, per-session diagnostics for intermittent agent termination.
 * Records metadata only: no prompt text, response text, tool arguments, keys,
 * or provider error messages are written to disk.
 */
const TRACE_DIRECTORY = join(homedir(), ".pi", "agent", "abort-traces");
const MAX_PENDING_WRITES = 4_096;

type WriterState = {
  tail: Promise<void>;
  pending: number;
  initialized: boolean;
  dropped: boolean;
};

const writers = new Map<string, WriterState>();
const signalOwners = new WeakMap<AbortSignal, string>();
const observedSignals = new WeakSet<AbortSignal>();
const instrumentedProviderStreams = new WeakSet<object>();
let abortPatchInstalled = false;

function writerFor(sessionId: string): WriterState {
  let state = writers.get(sessionId);
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0, initialized: false, dropped: false };
    writers.set(sessionId, state);
  }
  return state;
}

function stackFrames(skip = 2): string[] {
  return (new Error().stack ?? "")
    .split(/\r?\n/)
    .slice(skip, skip + 12)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));
}

export function diagnosticError(error: unknown): Record<string, unknown> {
  const value = error as { name?: unknown; code?: unknown; stack?: unknown } | null;
  const stack = typeof value?.stack === "string"
    ? value.stack.split(/\r?\n/).slice(1, 13).map((line) => line.trim()).filter((line) => line.startsWith("at "))
    : [];
  return {
    errorType: typeof value?.name === "string" ? value.name : typeof error,
    ...(typeof value?.code === "string" || typeof value?.code === "number" ? { errorCode: value.code } : {}),
    ...(stack.length ? { stack } : {}),
  };
}

/** Queue a JSONL record without ever blocking or failing an agent run. */
export function recordSessionDiagnostic(sessionId: string, kind: string, details: Record<string, unknown> = {}): void {
  const state = writerFor(sessionId);
  if (state.pending >= MAX_PENDING_WRITES) {
    if (!state.dropped) {
      state.dropped = true;
      console.warn(`[pi-web] diagnostic trace queue saturated for session ${sessionId}`);
    }
    return;
  }

  const line = `${JSON.stringify({ ts: new Date().toISOString(), sessionId, kind, ...details })}\n`;
  state.pending += 1;
  state.tail = state.tail
    .then(async () => {
      if (!state.initialized) {
        await mkdir(TRACE_DIRECTORY, { recursive: true });
        state.initialized = true;
      }
      await appendFile(join(TRACE_DIRECTORY, `${sessionId}.jsonl`), line, "utf8");
    })
    .catch(() => {
      // Diagnostics must never affect a normal run. Errors are intentionally not re-logged.
    })
    .finally(() => { state.pending -= 1; });
}

export function getDiagnosticTracePath(sessionId: string): string {
  return join(TRACE_DIRECTORY, `${sessionId}.jsonl`);
}

/** Associate the core run signal with a session before it reaches the provider. */
export function trackAbortSignal(sessionId: string, signal: unknown): void {
  if (!signal || typeof signal !== "object" || !("aborted" in signal)) return;
  const abortSignal = signal as AbortSignal;
  signalOwners.set(abortSignal, sessionId);
  installAbortPatch();
  if (!observedSignals.has(abortSignal)) {
    observedSignals.add(abortSignal);
    abortSignal.addEventListener("abort", () => {
      recordSessionDiagnostic(sessionId, "stream_signal_abort_event", {
        signalAborted: abortSignal.aborted,
        reasonType: abortSignal.reason === null ? "null" : typeof abortSignal.reason,
      });
    }, { once: true });
  }
  recordSessionDiagnostic(sessionId, "stream_signal_observed", { signalAborted: abortSignal.aborted });
}

type ProviderStreamLike = {
  push?: (event: unknown) => unknown;
  end?: (result?: unknown) => unknown;
  result?: () => Promise<unknown>;
};

function providerMessageSummary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const message = value as Record<string, unknown>;
  const usage = message.usage as Record<string, unknown> | undefined;
  return {
    ...(typeof message.stopReason === "string" ? { stopReason: message.stopReason } : {}),
    ...(Array.isArray(message.content) ? {
      contentPartCount: message.content.length,
      contentTypes: message.content
        .map((part) => part && typeof part === "object" ? (part as { type?: unknown }).type : undefined)
        .filter((type): type is string => typeof type === "string"),
    } : {}),
    hasErrorMessage: typeof message.errorMessage === "string" && message.errorMessage.length > 0,
    ...(usage && typeof usage.totalTokens === "number" ? { totalTokens: usage.totalTokens } : {}),
  };
}

/** Trace the actual provider EventStream boundary without consuming or replacing it. */
export function instrumentProviderStream(sessionId: string, stream: unknown, signal: unknown): unknown {
  if (!stream || typeof stream !== "object" || instrumentedProviderStreams.has(stream)) return stream;
  instrumentedProviderStreams.add(stream);
  const target = stream as ProviderStreamLike;
  const abortSignal = signal && typeof signal === "object" && "aborted" in signal ? signal as AbortSignal : undefined;
  const signalState = () => ({ signalAborted: abortSignal?.aborted ?? false });

  if (typeof target.push === "function") {
    const originalPush = target.push;
    target.push = function diagnosticPush(this: ProviderStreamLike, event: unknown): unknown {
      const value = event && typeof event === "object" ? event as Record<string, unknown> : undefined;
      const eventType = typeof value?.type === "string" ? value.type : "unknown";
      if (eventType === "start") {
        recordSessionDiagnostic(sessionId, "provider_stream_start", signalState());
      } else if (eventType === "done" || eventType === "error") {
        const message = eventType === "error" ? value?.error : value?.message;
        recordSessionDiagnostic(sessionId, "provider_stream_terminal_event", {
          streamEventType: eventType,
          ...(typeof value?.reason === "string" ? { reason: value.reason } : {}),
          ...signalState(),
          ...providerMessageSummary(message),
        });
      }
      return originalPush.call(this, event);
    };
  }

  if (typeof target.end === "function") {
    const originalEnd = target.end;
    target.end = function diagnosticEnd(this: ProviderStreamLike, result?: unknown): unknown {
      recordSessionDiagnostic(sessionId, "provider_stream_end", {
        ...signalState(),
        hasExplicitResult: arguments.length > 0,
        ...providerMessageSummary(result),
      });
      return originalEnd.call(this, result);
    };
  }

  if (typeof target.result === "function") {
    const originalResult = target.result;
    target.result = function diagnosticResult(this: ProviderStreamLike): Promise<unknown> {
      try {
        return Promise.resolve(originalResult.call(this)).then(
          (result) => {
            recordSessionDiagnostic(sessionId, "provider_stream_result", {
              ...signalState(),
              ...providerMessageSummary(result),
            });
            return result;
          },
          (error) => {
            recordSessionDiagnostic(sessionId, "provider_stream_result_rejected", {
              ...signalState(),
              ...diagnosticError(error),
            });
            throw error;
          },
        );
      } catch (error) {
        recordSessionDiagnostic(sessionId, "provider_stream_result_threw", {
          ...signalState(),
          ...diagnosticError(error),
        });
        throw error;
      }
    };
  }

  return stream;
}

/**
 * The core API exposes an AbortSignal but not its controller. Patching the
 * standard controller only emits a stack for signals explicitly associated
 * above, so unrelated server operations have no trace impact.
 */
function installAbortPatch(): void {
  if (abortPatchInstalled) return;
  abortPatchInstalled = true;
  const originalAbort = AbortController.prototype.abort;
  AbortController.prototype.abort = function patchedAbort(this: AbortController, reason?: unknown): void {
    const sessionId = signalOwners.get(this.signal);
    if (sessionId) {
      recordSessionDiagnostic(sessionId, "abort_controller_abort", {
        signalWasAborted: this.signal.aborted,
        reasonType: reason === null ? "null" : typeof reason,
        stack: stackFrames(2),
      });
    }
    originalAbort.call(this, reason);
  };
}

export function diagnosticStack(): string[] {
  return stackFrames(2);
}

export function summarizeAgentEvent(event: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = { eventType: String(event.type ?? "unknown") };
  const message = event.message as Record<string, unknown> | undefined;
  if (message && typeof message === "object") {
    summary.role = typeof message.role === "string" ? message.role : "unknown";
    if (typeof message.stopReason === "string") summary.stopReason = message.stopReason;
    summary.hasErrorMessage = typeof message.errorMessage === "string" && message.errorMessage.length > 0;
    if (Array.isArray(message.content)) {
      summary.contentTypes = message.content
        .map((part) => typeof part === "object" && part !== null ? (part as { type?: unknown }).type : undefined)
        .filter((type): type is string => typeof type === "string");
      summary.contentPartCount = message.content.length;
    }
  }
  const streamEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
  if (streamEvent && typeof streamEvent.type === "string") summary.streamEventType = streamEvent.type;
  if (typeof event.toolName === "string") summary.toolName = event.toolName;
  return summary;
}
