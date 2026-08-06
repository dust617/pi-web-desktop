import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@earendil-works/pi-ai";

type StreamEvent = {
  type?: unknown;
  reason?: unknown;
  error?: unknown;
  message?: unknown;
  partial?: unknown;
  delta?: unknown;
  content?: unknown;
  [key: string]: unknown;
};

export type EmptyAbortRetryStream = AsyncIterable<StreamEvent> & {
  result?: () => Promise<unknown>;
};

export type EmptyAbortRetryEvent =
  | "scheduled"
  | "started"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "setup_failed";

export type EmptyAbortRetryObserver = (
  event: EmptyAbortRetryEvent,
  details?: Record<string, unknown>,
) => void;

export interface EmptyAbortRetryOptions {
  retryDelayMs?: number;
  maxRetries?: number;
  /**
   * Max bytes of plain thinking content buffered as discardable before the
   * stream is committed (forwarded live, retry disabled). Bounds memory and
   * avoids discarding very large reasoning. Default 64 KiB.
   */
  thinkingBufferCapBytes?: number;
}

function messageView(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function contentPartHasOutput(value: unknown): boolean {
  const part = messageView(value);
  if (!part) return true;
  if (part.type === "text") return typeof part.text === "string" && part.text.length > 0;
  if (part.type === "thinking") {
    return (typeof part.thinking === "string" && part.thinking.length > 0)
      || part.redacted === true
      || (typeof part.thinkingSignature === "string" && part.thinkingSignature.length > 0);
  }
  // A tool-call block can lead to an externally visible tool execution, so it
  // is always treated as committed output even if its arguments are incomplete.
  if (part.type === "toolCall") return true;
  return true;
}

function messageHasOutput(value: Record<string, unknown> | undefined): boolean {
  const usage = messageView(value?.usage);
  return (Array.isArray(value?.content) && value.content.some(contentPartHasOutput))
    || (typeof usage?.totalTokens === "number" && usage.totalTokens > 0);
}

const DEFAULT_THINKING_BUFFER_CAP_BYTES = 64 * 1024;

/**
 * A plain thinking part carries regenerable reasoning text. Redacted thinking
 * and signed thinking blocks cannot be regenerated, so they count as
 * committed output.
 */
function partIsPlainThinking(value: unknown): boolean {
  const part = messageView(value);
  if (!part || part.type !== "thinking") return false;
  if (part.redacted === true) return false;
  if (typeof part.thinkingSignature === "string" && part.thinkingSignature.length > 0) return false;
  return typeof part.thinking === "string";
}

function partialIsPlainThinkingOnly(value: Record<string, unknown> | undefined): boolean {
  if (!value) return false;
  const usage = messageView(value.usage);
  if (typeof usage?.totalTokens === "number" && usage.totalTokens > 0) return false;
  if (!Array.isArray(value.content) || value.content.length === 0) return false;
  return value.content.every(partIsPlainThinking);
}

type EventVerdict = "structural" | "thinking" | "commit";

/**
 * Classify a provider stream event for retry safety:
 * - "structural": empty boundary event, always safe to buffer and discard
 * - "thinking":   plain thinking content, safe to discard up to the cap
 * - "commit":     real output (text, tool calls, usage, opaque events);
 *                 forwarding it disables retry
 */
function classifyEvent(event: StreamEvent, partial: Record<string, unknown> | undefined): EventVerdict {
  switch (event.type) {
    case "start":
    case "thinking_start":
      if (!messageHasOutput(partial)) return "structural";
      return partialIsPlainThinkingOnly(partial) ? "thinking" : "commit";
    case "text_start":
      return messageHasOutput(partial) ? "commit" : "structural";
    case "thinking_delta": {
      if (typeof event.delta !== "string" || event.delta.length === 0) {
        return messageHasOutput(partial) ? "commit" : "structural";
      }
      return !partial || partialIsPlainThinkingOnly(partial) ? "thinking" : "commit";
    }
    case "text_delta":
      return (typeof event.delta === "string" && event.delta.length > 0) || messageHasOutput(partial)
        ? "commit"
        : "structural";
    case "thinking_end": {
      if (typeof event.content !== "string" || event.content.length === 0) {
        return messageHasOutput(partial) ? "commit" : "structural";
      }
      return !partial || partialIsPlainThinkingOnly(partial) ? "thinking" : "commit";
    }
    case "text_end":
      return (typeof event.content === "string" && event.content.length > 0) || messageHasOutput(partial)
        ? "commit"
        : "structural";
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
      return "commit";
    default:
      // Unknown provider events are forwarded conservatively and disable retry.
      return "commit";
  }
}

function thinkingEventByteSize(event: StreamEvent): number {
  if (typeof event.delta === "string") return event.delta.length;
  if (typeof event.content === "string") return event.content.length;
  return 0;
}

function hasThinkingContent(event: StreamEvent): boolean {
  return (
    (event.type === "thinking_delta" && typeof event.delta === "string" && event.delta.length > 0) ||
    (event.type === "thinking_end" && typeof event.content === "string" && event.content.length > 0)
  );
}

export function isRetryableEmptyAbort(
  event: StreamEvent,
  signal: AbortSignal | undefined,
  outputCommitted: boolean,
): boolean {
  if (outputCommitted || signal?.aborted || event.type !== "error" || event.reason !== "aborted") return false;
  const message = messageView(event.error);
  const usage = messageView(message?.usage);
  return message?.stopReason === "aborted"
    && Array.isArray(message.content)
    && message.content.length === 0
    && usage?.totalTokens === 0;
}

function terminalSummary(event: StreamEvent): Record<string, unknown> {
  const message = messageView(event.type === "error" ? event.error : event.message);
  return {
    streamEventType: typeof event.type === "string" ? event.type : "unknown",
    ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
    ...(typeof message?.stopReason === "string" ? { stopReason: message.stopReason } : {}),
  };
}

function pushEvent(output: AssistantMessageEventStream, event: StreamEvent): void {
  output.push(event as Parameters<AssistantMessageEventStream["push"]>[0]);
}

function flushEvents(output: AssistantMessageEventStream, events: StreamEvent[], dropThinkingContent = false): void {
  for (const event of events) {
    if (dropThinkingContent && hasThinkingContent(event)) continue;
    pushEvent(output, event as Parameters<AssistantMessageEventStream["push"]>[0]);
  }
  events.length = 0;
}

function finishWithEvent(
  output: AssistantMessageEventStream,
  pendingEvents: StreamEvent[],
  event: StreamEvent,
): void {
  // Cancelled / setup-failed paths never earned the buffered thinking content.
  flushEvents(output, pendingEvents, true);
  pushEvent(output, event);
  output.end();
}

function syntheticStreamError(partial: Record<string, unknown> | undefined): StreamEvent {
  const usage = messageView(partial?.usage) ?? {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return {
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: Array.isArray(partial?.content) ? partial.content : [],
      api: typeof partial?.api === "string" ? partial.api : "unknown",
      provider: typeof partial?.provider === "string" ? partial.provider : "unknown",
      model: typeof partial?.model === "string" ? partial.model : "unknown",
      usage,
      stopReason: "error",
      errorMessage: "Provider stream ended without a terminal result.",
      timestamp: Date.now(),
    },
  };
}

/**
 * Hide provider-generated empty aborted terminals and retry the identical
 * request up to maxRetries times. Structural text/thinking boundary events are
 * buffered until real output arrives, so an empty aborted attempt remains safe
 * to discard. Plain thinking content is likewise buffered (up to
 * thinkingBufferCapBytes) because a thinking-only attempt has no user-visible
 * output and no side effects; exceeding the cap commits the stream and
 * disables retry. Text content, tool-call events, non-zero usage, real
 * cancellation and non-aborted failures are never retried.
 */
export function withEmptyAbortRetries(
  firstStream: EmptyAbortRetryStream,
  retryFactory: () => EmptyAbortRetryStream | Promise<EmptyAbortRetryStream>,
  signal?: AbortSignal,
  observer?: EmptyAbortRetryObserver,
  options: EmptyAbortRetryOptions = {},
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
  const thinkingCapBytes = Math.max(
    0,
    Math.floor(options.thinkingBufferCapBytes ?? DEFAULT_THINKING_BUFFER_CAP_BYTES),
  );
  let originalAbortEvent: StreamEvent | undefined;
  let latestPartial: Record<string, unknown> | undefined;
  let pendingEvents: StreamEvent[] = [];
  let anyOutputForwarded = false;

  void (async () => {
    let source = firstStream;
    let attempt = 1;

    while (true) {
      pendingEvents = [];
      let outputCommitted = false;
      let switchedToRetry = false;
      let bufferedThinkingBytes = 0;

      for await (const event of source) {
        const partial = messageView(event.partial);
        if (partial) latestPartial = partial;

        if (event.type === "done" || event.type === "error") {
          if (attempt <= maxRetries && isRetryableEmptyAbort(event, signal, outputCommitted)) {
            originalAbortEvent ??= event;
            const nextAttempt = attempt + 1;
            // A short stepped delay avoids immediately re-entering the same
            // transient transport state: 250ms, then 750ms by default.
            const delayMs = retryDelayMs * (2 * attempt - 1);
            observer?.("scheduled", { ...terminalSummary(event), attempt, nextAttempt, delayMs, bufferedThinkingBytes });
            if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
            if (signal?.aborted) {
              observer?.("cancelled", { attempt, nextAttempt, signalAborted: true });
              finishWithEvent(output, pendingEvents, event);
              return;
            }
            try {
              observer?.("started", { attempt: nextAttempt });
              source = await retryFactory();
              attempt = nextAttempt;
              switchedToRetry = true;
              break;
            } catch {
              observer?.("setup_failed", { attempt: nextAttempt });
              finishWithEvent(output, pendingEvents, event);
              return;
            }
          }

          // On a final failed attempt drop buffered thinking content so the
          // visible outcome matches the pre-fix empty aborted shape; a
          // successful terminal keeps the buffered events of its own attempt.
          flushEvents(output, pendingEvents, event.type === "error");
          pushEvent(output, event);
          if (attempt > 1) {
            observer?.(event.type === "done" ? "succeeded" : "failed", {
              ...terminalSummary(event),
              attempt,
            });
          }
          output.end();
          return;
        }

        const verdict = classifyEvent(event, partial);
        if (verdict === "structural") {
          pendingEvents.push(event);
          continue;
        }
        if (verdict === "thinking") {
          bufferedThinkingBytes += thinkingEventByteSize(event);
          if (bufferedThinkingBytes <= thinkingCapBytes) {
            pendingEvents.push(event);
            continue;
          }
          // Cap exceeded: commit everything and forward live from here on.
        }

        flushEvents(output, pendingEvents);
        pushEvent(output, event);
        outputCommitted = true;
        anyOutputForwarded = true;
      }

      if (switchedToRetry) continue;

      // A conforming provider emits done/error. Preserve an explicit result if
      // a custom stream instead ends without a terminal event.
      const result = typeof source.result === "function" ? await source.result() : undefined;
      flushEvents(output, pendingEvents);
      if (result !== undefined) {
        output.end(result as Parameters<AssistantMessageEventStream["end"]>[0]);
      } else {
        pushEvent(output, syntheticStreamError(latestPartial));
        output.end();
      }
      return;
    }
  })().catch(() => {
    // Keep the stream contract settled even if a custom iterator throws. If no
    // output escaped, restore the first suppressed terminal instead of hanging.
    flushEvents(output, pendingEvents, true);
    if (originalAbortEvent && !anyOutputForwarded) {
      pushEvent(output, originalAbortEvent);
      output.end();
      return;
    }
    pushEvent(output, syntheticStreamError(latestPartial));
    output.end();
  });

  return output;
}
