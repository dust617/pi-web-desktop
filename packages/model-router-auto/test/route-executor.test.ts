/**
 * test/route-executor.test.ts
 * 阶段 C 验收（报告 §7 阶段 C）：
 * - 首选失败、fallback 成功 → actualModel=fallback，外部流只有一次 start 和一个终止事件
 * - 首包后失败 → terminal，不 fallback
 * - 用户取消 → aborted，不 fallback
 * - 容量不足候选被跳过
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { executeRoute, makeRouteIntent, type DelegateFn, type ModelRegistryLike } from "../.pi/extensions/auto-orchestrator/route-executor.js";
import { OrchestratorStore } from "../.pi/extensions/auto-orchestrator/state.js";
import { StateRepository } from "../.pi/extensions/auto-orchestrator/state-repository.js";
import { Telemetry } from "../.pi/extensions/auto-orchestrator/telemetry.js";

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orch-exec-"));
}

function makeStore(): OrchestratorStore {
  const cwd = tmpCwd();
  const store = new OrchestratorStore(cwd, new StateRepository(cwd));
  store.bind("test-session");
  return store;
}

function makeTelemetry(): Telemetry {
  return new Telemetry(tmpCwd());
}

const registry: ModelRegistryLike = {
  find: (_p: string, id: string) => ({ id, reasoning: true, contextWindow: 100000 }),
  getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
};

async function* gen(events: any[]): AsyncIterable<any> {
  for (const e of events) yield e;
}

function collect(stream: AsyncIterable<any>): Promise<any[]> {
  return (async () => {
    const out: any[] = [];
    for await (const e of stream) out.push(e);
    return out;
  })();
}

const start = { type: "start", message: { role: "assistant" } };
const delta = (t: string) => ({ type: "text_delta", delta: t });
const done = (stopReason = "stop") => ({ type: "done", message: { role: "assistant", stopReason } });

test("首选首包前失败 + fallback 成功：actualModel=fallback，外部流一次 start 一个终止", async () => {
  const store = makeStore();
  const calls: string[] = [];
  const delegate: DelegateFn = (model: any) => {
    calls.push(model.id);
    if (model.id === "bad") {
      return gen([start, { type: "error", error: { errorMessage: "boom before content" } }]);
    }
    return gen([start, delta("hi"), done("stop")]);
  };

  const intent = makeRouteIntent({
    target: { ref: "p/bad" },
    fallbacks: [{ ref: "p/good" }],
    phase: "execution",
    action: "KEEP",
    reason: "test",
  });

  const stream = executeRoute(intent, { messages: [] } as any, undefined, {
    store, telemetry: makeTelemetry(), registry, delegate,
  });
  const events = await collect(stream);

  assert.deepEqual(calls, ["bad", "good"], "应先试首选再 fallback");
  const starts = events.filter((e) => e.type === "start");
  const terminals = events.filter((e) => e.type === "done" || e.type === "error");
  assert.equal(starts.length, 1, "外部流只能有一次 start");
  assert.equal(terminals.length, 1, "外部流只能有一个终止事件");
  assert.equal(terminals[0].type, "done");

  const snap = store.snapshot();
  assert.equal(snap.currentModel, "p/good", "currentModel 必须是实际成功的 fallback");
  assert.equal(snap.switchCount, 0, "首次提交不计 switch");
});

test("首包后失败：terminal，禁止 fallback", async () => {
  const store = makeStore();
  const calls: string[] = [];
  const delegate: DelegateFn = (model: any) => {
    calls.push(model.id);
    if (model.id === "primary") {
      // 先有内容（触发 commit），再 done(error)
      return gen([start, delta("partial"), done("error")]);
    }
    return gen([start, delta("should not run"), done("stop")]);
  };

  const intent = makeRouteIntent({
    target: { ref: "p/primary" },
    fallbacks: [{ ref: "p/backup" }],
    phase: "execution",
    action: "KEEP",
    reason: "test",
  });

  const stream = executeRoute(intent, { messages: [] } as any, undefined, {
    store, telemetry: makeTelemetry(), registry, delegate,
  });
  const events = await collect(stream);

  assert.deepEqual(calls, ["primary"], "已提交后不得 fallback 到 backup");
  const terminals = events.filter((e) => e.type === "done" || e.type === "error");
  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].type, "done", "已提交的 done(error) 透传为终止事件");
  assert.equal(terminals[0].message.stopReason, "error");

  const snap = store.snapshot();
  assert.equal(snap.currentModel, "p/primary", "commit 后 currentModel 为 primary");
  assert.ok(snap.sameFailureCount >= 1, "terminal 失败应计入 sameFailureCount");
});

test("用户取消：aborted，不再 fallback", async () => {
  const store = makeStore();
  const calls: string[] = [];
  const controller = new AbortController();
  const delegate: DelegateFn = (model: any) => {
    calls.push(model.id);
    controller.abort();
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };

  const intent = makeRouteIntent({
    target: { ref: "p/a" },
    fallbacks: [{ ref: "p/b" }],
    phase: "execution",
    action: "KEEP",
    reason: "test",
  });

  const stream = executeRoute(intent, { messages: [] } as any, { signal: controller.signal } as any, {
    store, telemetry: makeTelemetry(), registry, delegate,
  });
  const events = await collect(stream);

  assert.deepEqual(calls, ["a"], "abort 后不得尝试 fallback");
  const errEvents = events.filter((e) => e.type === "error");
  assert.equal(errEvents.length, 1);
  assert.equal(errEvents[0].reason, "aborted");
});

test("done(stopReason=aborted)：结果为 aborted 且透传 done", async () => {
  const store = makeStore();
  const delegate: DelegateFn = () => gen([start, delta("x"), done("aborted")]);
  const intent = makeRouteIntent({
    target: { ref: "p/a" },
    fallbacks: [{ ref: "p/b" }],
    phase: "execution",
    action: "KEEP",
    reason: "test",
  });
  const stream = executeRoute(intent, { messages: [] } as any, undefined, {
    store, telemetry: makeTelemetry(), registry, delegate,
  });
  const events = await collect(stream);
  const terminals = events.filter((e) => e.type === "done" || e.type === "error");
  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].type, "done");
  assert.equal(terminals[0].message.stopReason, "aborted");
});

test("容量准入：contextWindow 不足的候选被跳过（retryable），fallback 成功", async () => {
  const store = makeStore();
  const smallRegistry: ModelRegistryLike = {
    find: (_p: string, id: string) =>
      id === "small" ? { id, reasoning: true, contextWindow: 100 } : { id, reasoning: true, contextWindow: 100000 },
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
  };
  const calls: string[] = [];
  const delegate: DelegateFn = (model: any) => {
    calls.push(model.id);
    return gen([start, delta("ok"), done("stop")]);
  };

  const intent = makeRouteIntent({
    target: { ref: "p/small" },
    fallbacks: [{ ref: "p/big" }],
    phase: "execution",
    action: "KEEP",
    reason: "test",
    requiredContextTokens: 5000,
  });

  const stream = executeRoute(intent, { messages: [] } as any, undefined, {
    store, telemetry: makeTelemetry(), registry: smallRegistry, delegate,
  });
  const events = await collect(stream);

  assert.deepEqual(calls, ["big"], "容量不足的首选必须被跳过");
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.equal(store.snapshot().currentModel, "p/big");
});

test("header-only auth 视为认证成功（不强制 apiKey）", async () => {
  const store = makeStore();
  const headerRegistry: ModelRegistryLike = {
    find: (_p: string, id: string) => ({ id, reasoning: true, contextWindow: 100000 }),
    getApiKeyAndHeaders: async () => ({ ok: true, headers: { Authorization: "Bearer x" } }),
  };
  const delegate: DelegateFn = () => gen([start, delta("ok"), done("stop")]);
  const intent = makeRouteIntent({
    target: { ref: "p/a" },
    fallbacks: [],
    phase: "execution",
    action: "KEEP",
    reason: "test",
  });
  const stream = executeRoute(intent, { messages: [] } as any, undefined, {
    store, telemetry: makeTelemetry(), registry: headerRegistry, delegate,
  });
  const events = await collect(stream);
  assert.equal(events.filter((e) => e.type === "done").length, 1, "header-only auth 应成功");
});

test("意外异常也写入 failed outcome，避免留下孤儿 intent", async () => {
  const store = makeStore();
  const cwd = tmpCwd();
  const telemetry = new Telemetry(cwd);
  const throwingRegistry: ModelRegistryLike = {
    find: () => { throw new Error("registry exploded"); },
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
  };
  const intent = makeRouteIntent({
    target: { ref: "p/a" },
    fallbacks: [],
    phase: "execution",
    action: "KEEP",
    reason: "test",
    taskId: "task-unexpected",
    attemptId: "attempt-unexpected",
  });

  const events = await collect(executeRoute(intent, { messages: [] } as any, undefined, {
    store, telemetry, registry: throwingRegistry,
  }));
  const file = path.join(cwd, ".pi", "orchestrator-telemetry.v2.jsonl");
  const entries = fs.readFileSync(file, "utf8").trim().split("\\n").map((line) => JSON.parse(line));
  const outcome = entries.find((entry) => entry.kind === "route_outcome");

  assert.equal(events.filter((event) => event.type === "error").length, 1);
  assert.equal(outcome?.status, "failed");
  assert.equal(outcome?.taskId, "task-unexpected");
  assert.match(outcome?.errorMessage ?? "", /registry exploded/);
});

test("makeRouteIntent 生成不可变意图", () => {
  const intent = makeRouteIntent({
    target: { ref: "p/a" },
    fallbacks: [],
    phase: "execution",
    action: "KEEP",
    reason: "r",
  });
  assert.ok(Object.isFrozen(intent));
  assert.throws(() => {
    (intent as any).reason = "tampered";
  });
});
