import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isRetryableEmptyAbort, withEmptyAbortRetries } = await jiti.import("./empty-abort-retry.ts");

function message(stopReason, content = [], totalTokens = 0) {
  return {
    role: "assistant",
    content,
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamEvents(events) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    for (const event of events) stream.push(event);
    stream.end();
  });
  return stream;
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return { events, result: await stream.result() };
}

const start = { type: "start", partial: { ...message("pending"), stopReason: "pending" } };
const emptyAbort = { type: "error", reason: "aborted", error: message("aborted") };
const done = { type: "done", reason: "stop", message: message("stop", [{ type: "text", text: "ok" }], 3) };
const noDelay = { retryDelayMs: 0 };

test("retries an empty provider abort and exposes only the successful terminal", async () => {
  let retries = 0;
  const observed = [];
  const output = withEmptyAbortRetries(
    streamEvents([start, emptyAbort]),
    () => {
      retries += 1;
      return streamEvents([start, done]);
    },
    undefined,
    (event, details) => observed.push({ event, details }),
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.equal(retries, 1);
  assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(observed.map((item) => item.event), ["scheduled", "started", "succeeded"]);
  assert.equal(observed[0].details.nextAttempt, 2);
  assert.equal(observed[2].details.attempt, 2);
});

test("does not retry a real AbortSignal cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let retries = 0;
  const output = withEmptyAbortRetries(
    streamEvents([start, emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    controller.signal,
    undefined,
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.equal(retries, 0);
  assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
  assert.equal(result.stopReason, "aborted");
});

test("does not retry after substantive provider output", async () => {
  let retries = 0;
  const textStart = {
    type: "text_start",
    contentIndex: 0,
    partial: { ...start.partial, content: [{ type: "text", text: "" }] },
  };
  const textDelta = {
    type: "text_delta",
    contentIndex: 0,
    delta: "x",
    partial: { ...start.partial, content: [{ type: "text", text: "x" }] },
  };
  const output = withEmptyAbortRetries(
    streamEvents([start, textStart, textDelta, emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    undefined,
    undefined,
    noDelay,
  );

  const { events } = await collect(output);
  assert.equal(retries, 0);
  assert.deepEqual(events.map((event) => event.type), ["start", "text_start", "text_delta", "error"]);
});

test("discards empty text/thinking boundary events before retry", async () => {
  let retries = 0;
  const textStart = {
    type: "text_start",
    contentIndex: 0,
    partial: { ...start.partial, content: [{ type: "text", text: "" }] },
  };
  const thinkingStart = {
    type: "thinking_start",
    contentIndex: 0,
    partial: { ...start.partial, content: [{ type: "thinking", thinking: "" }] },
  };
  const output = withEmptyAbortRetries(
    streamEvents([start, textStart, thinkingStart, emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    undefined,
    undefined,
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.equal(retries, 1);
  assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
  assert.equal(result.stopReason, "stop");
});

test("does not retry when the start partial already contains output", async () => {
  let retries = 0;
  const nonemptyStart = {
    type: "start",
    partial: { ...start.partial, content: [{ type: "text", text: "partial" }] },
  };
  const output = withEmptyAbortRetries(
    streamEvents([nonemptyStart, emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    undefined,
    undefined,
    noDelay,
  );

  const { events } = await collect(output);
  assert.equal(retries, 0);
  assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
});

test("requires zero usage and empty content", () => {
  const nonzero = { ...emptyAbort, error: message("aborted", [], 1) };
  const content = { ...emptyAbort, error: message("aborted", [{ type: "text", text: "partial" }], 0) };
  assert.equal(isRetryableEmptyAbort(nonzero, undefined, false), false);
  assert.equal(isRetryableEmptyAbort(content, undefined, false), false);
  assert.equal(isRetryableEmptyAbort(emptyAbort, undefined, false), true);
});

test("uses a second retry after two consecutive empty aborts", async () => {
  let retries = 0;
  const observed = [];
  const output = withEmptyAbortRetries(
    streamEvents([start, emptyAbort]),
    () => {
      retries += 1;
      return retries === 1 ? streamEvents([start, emptyAbort]) : streamEvents([start, done]);
    },
    undefined,
    (event) => observed.push(event),
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.equal(retries, 2);
  assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(observed, ["scheduled", "started", "scheduled", "started", "succeeded"]);
});

test("forwards the third abort after exhausting two retries", async () => {
  let retries = 0;
  const observed = [];
  const output = withEmptyAbortRetries(
    streamEvents([start, emptyAbort]),
    () => { retries += 1; return streamEvents([start, emptyAbort]); },
    undefined,
    (event) => observed.push(event),
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.equal(retries, 2);
  assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(observed, ["scheduled", "started", "scheduled", "started", "failed"]);
});

test("restores the current abort if retry setup throws", async () => {
  const observed = [];
  const output = withEmptyAbortRetries(
    streamEvents([start, emptyAbort]),
    () => { throw new Error("setup failed"); },
    undefined,
    (event) => observed.push(event),
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(observed, ["scheduled", "started", "setup_failed"]);
});

test("settles with a synthetic error if a custom iterator throws", async () => {
  const throwing = {
    async *[Symbol.asyncIterator]() {
      yield start;
      throw new Error("iterator failed");
    },
  };
  const output = withEmptyAbortRetries(throwing, () => streamEvents([start, done]), undefined, undefined, noDelay);
  const { events, result } = await collect(output);
  assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
  assert.equal(result.stopReason, "error");
});

// ── thinking-only 缓冲（2026-08-05 覆盖缺口修复）──────────────────────

function thinkingPartial(text) {
  return { ...start.partial, content: [{ type: "thinking", thinking: text }] };
}
const thinkingStart = { type: "thinking_start", contentIndex: 0, partial: thinkingPartial("") };
const thinkingDelta = (text) => ({ type: "thinking_delta", contentIndex: 0, delta: text, partial: thinkingPartial(text) });

test("retries a thinking-only abort and never forwards the discarded thinking", async () => {
  let retries = 0;
  const observed = [];
  const output = withEmptyAbortRetries(
    streamEvents([start, thinkingStart, thinkingDelta("hmm..."), emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    undefined,
    (event, details) => observed.push({ event, details }),
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.equal(retries, 1);
  assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
  assert.equal(result.stopReason, "stop");
  assert.equal(observed[0].event, "scheduled");
  assert.equal(observed[0].details.bufferedThinkingBytes, "hmm...".length);
});

test("commits and skips retry once the thinking buffer cap is exceeded", async () => {
  let retries = 0;
  const output = withEmptyAbortRetries(
    streamEvents([start, thinkingStart, thinkingDelta("12345"), emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    undefined,
    undefined,
    { ...noDelay, thinkingBufferCapBytes: 4 },
  );

  const { events } = await collect(output);
  assert.equal(retries, 0);
  assert.deepEqual(events.map((event) => event.type), ["start", "thinking_start", "thinking_delta", "error"]);
});

test("drops buffered thinking on final failure after exhausting retries", async () => {
  let retries = 0;
  const output = withEmptyAbortRetries(
    streamEvents([start, thinkingStart, thinkingDelta("abc"), emptyAbort]),
    () => { retries += 1; return streamEvents([start, thinkingStart, thinkingDelta("abc"), emptyAbort]); },
    undefined,
    undefined,
    noDelay,
  );

  const { events, result } = await collect(output);
  assert.equal(retries, 2);
  assert.deepEqual(events.map((event) => event.type), ["start", "thinking_start", "error"]);
  assert.equal(events.some((event) => event.type === "thinking_delta"), false);
  assert.equal(result.stopReason, "aborted");
});

test("does not retry after redacted thinking (non-regenerable)", async () => {
  let retries = 0;
  const redactedStart = {
    type: "thinking_start",
    contentIndex: 0,
    partial: { ...start.partial, content: [{ type: "thinking", redacted: true }] },
  };
  const output = withEmptyAbortRetries(
    streamEvents([start, redactedStart, emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    undefined,
    undefined,
    noDelay,
  );

  const { events } = await collect(output);
  assert.equal(retries, 0);
  assert.deepEqual(events.map((event) => event.type), ["start", "thinking_start", "error"]);
});

test("still commits immediately when text follows thinking", async () => {
  let retries = 0;
  const textDelta = {
    type: "text_delta",
    contentIndex: 1,
    delta: "answer",
    partial: { ...thinkingPartial("hmm"), content: [...thinkingPartial("hmm").content, { type: "text", text: "answer" }] },
  };
  const output = withEmptyAbortRetries(
    streamEvents([start, thinkingStart, thinkingDelta("hmm"), textDelta, emptyAbort]),
    () => { retries += 1; return streamEvents([start, done]); },
    undefined,
    undefined,
    noDelay,
  );

  const { events } = await collect(output);
  assert.equal(retries, 0);
  assert.deepEqual(events.map((event) => event.type), ["start", "thinking_start", "thinking_delta", "text_delta", "error"]);
});
