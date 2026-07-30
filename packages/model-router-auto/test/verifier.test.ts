/**
 * test/verifier.test.ts
 * 阶段 D 验收（报告 §7 阶段 D）：
 * - 超时 reviewer 标记 timeout（假时钟），其余已完成结果仍返回
 * - 空白回复标记 empty_response，不得为成功
 * - finally 退订订阅并 dispose 会话
 * - 汇总保留分歧（非投票）
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reviewWithSession,
  withTimeout,
  summarizeResults,
  TimeoutError,
  type SessionLike,
  type ReviewerResult,
} from "../.pi/extensions/auto-orchestrator/verifier.js";

function makeFakeSession(opts: {
  deltas?: string[];
  promptDelayMs?: number;
  onPrompt?: () => void;
}): SessionLike & { unsubscribed: boolean; disposed: boolean } {
  const fake = {
    unsubscribed: false,
    disposed: false,
    subscribe(listener: (e: any) => void) {
      // 立即推送文本增量
      for (const d of opts.deltas ?? []) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: d } });
      }
      return () => {
        fake.unsubscribed = true;
      };
    },
    async prompt(_text: string) {
      opts.onPrompt?.();
      if (opts.promptDelayMs) {
        await new Promise((r) => setTimeout(r, opts.promptDelayMs));
      }
    },
    dispose() {
      fake.disposed = true;
    },
  };
  return fake;
}

test("withTimeout：超时抛 TimeoutError（假时钟，不真实等待）", async () => {
  const timers = {
    setTimeout: (fn: () => void, _ms: number) => {
      fn(); // 立即触发超时
      return 0 as any;
    },
    clearTimeout: (_t: any) => {},
  };
  const never = new Promise<void>(() => {});
  await assert.rejects(() => withTimeout(never, 1000, timers as any), TimeoutError);
});

test("withTimeout：正常完成不触发超时", async () => {
  const result = await withTimeout(Promise.resolve(42), 1000);
  assert.equal(result, 42);
});

test("空白回复标记 empty_response，不得为成功", async () => {
  const session = makeFakeSession({ deltas: ["", "   "] });
  const r = await reviewWithSession(session, { ref: "p/a", role: "primary" }, { question: "q", evidence: "e" });
  assert.equal(r.status, "empty_response");
  assert.equal(r.ok, false);
});

test("正常回复 ok 且 trim", async () => {
  const session = makeFakeSession({ deltas: ["  conclusion: yes  ", "\nconfidence 0.9"] });
  const r = await reviewWithSession(session, { ref: "p/a", role: "primary" }, { question: "q", evidence: "e" });
  assert.equal(r.status, "ok");
  assert.equal(r.ok, true);
  assert.ok(r.response.startsWith("conclusion: yes"));
});

test("finally 退订订阅并 dispose 会话（成功路径）", async () => {
  const session = makeFakeSession({ deltas: ["ok"] });
  await reviewWithSession(session, { ref: "p/a", role: "primary" }, { question: "q", evidence: "e" });
  assert.equal(session.unsubscribed, true, "必须退订");
  assert.equal(session.disposed, true, "必须 dispose");
});

test("finally 退订并 dispose（prompt 抛错路径）", async () => {
  const session = makeFakeSession({ deltas: [] });
  (session as any).prompt = async () => {
    throw new Error("boom");
  };
  await assert.rejects(() => reviewWithSession(session, { ref: "p/a", role: "primary" }, { question: "q", evidence: "e" }));
  assert.equal(session.unsubscribed, true);
  assert.equal(session.disposed, true);
});

test("超时 reviewer 标记 timeout，其余已完成结果仍返回", async () => {
  // 模拟：一个 reviewer 正常，一个 reviewer 超时（用 withTimeout 包裹）
  const fast = makeFakeSession({ deltas: ["fast answer"] });
  const fastResult = await reviewWithSession(fast, { ref: "p/fast", role: "primary" }, { question: "q", evidence: "e" });

  const timers = {
    setTimeout: (fn: () => void, _ms: number) => {
      fn();
      return 0 as any;
    },
    clearTimeout: (_t: any) => {},
  };
  const slow = makeFakeSession({ deltas: [] });
  const slowPromise = reviewWithSession(slow, { ref: "p/slow", role: "adversarial" }, { question: "q", evidence: "e" });
  let slowResult: ReviewerResult;
  try {
    await withTimeout(slowPromise, 1000, timers as any);
    slowResult = { role: "adversarial", ref: "p/slow", status: "ok", response: "", ok: true };
  } catch (e) {
    assert.ok(e instanceof TimeoutError);
    slowResult = { role: "adversarial", ref: "p/slow", status: "timeout", response: "timed out", ok: false };
  }

  const results = [fastResult, slowResult];
  assert.equal(results.filter((r) => r.ok).length, 1, "超时的 reviewer 不算成功，但快 reviewer 结果保留");
  assert.equal(slowResult.status, "timeout");
});

test("汇总保留分歧，不做多数票", () => {
  const results: ReviewerResult[] = [
    { role: "primary", ref: "p/a", status: "ok", response: "conclusion: safe", ok: true },
    { role: "adversarial", ref: "p/b", status: "ok", response: "conclusion: unsafe, counter-evidence found", ok: true },
    { role: "skeptical", ref: "p/c", status: "timeout", response: "timed out", ok: false },
  ];
  const summary = summarizeResults(results);
  assert.match(summary, /2\/3 reviewers/, "应标注可用 reviewer 数");
  assert.match(summary, /disagreements preserved/, "应声明保留分歧");
  assert.match(summary, /conclusion: safe/);
  assert.match(summary, /conclusion: unsafe/);
  assert.match(summary, /\[timeout\]/, "应标注超时 reviewer 状态");
});
