/**
 * test/state-repository.test.ts
 * 阶段 B 验收（报告 §7 阶段 B）：同 cwd 两个 session 的 plan/phase/测试基线互不可见；
 * 原子持久化往返；非法 schema 回退初始状态。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { StateRepository } from "../.pi/extensions/auto-orchestrator/state-repository.js";
import { createInitialState, STATE_SCHEMA_VERSION } from "../.pi/extensions/auto-orchestrator/state-reducer.js";
import { OrchestratorStore } from "../.pi/extensions/auto-orchestrator/state.js";

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orch-repo-"));
}

test("双 session 隔离：同 cwd 下 plan/phase/测试基线互不可见", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);

  const storeA = new OrchestratorStore(cwd, repo);
  storeA.bind("session-A");
  storeA.dispatch({ type: "PLAN_COMMITTED", plan: { goal: "A goal", steps: ["a1"] }, at: 1 });
  storeA.dispatch({ type: "TEST_OBSERVED", passed: 42, at: 2 });

  const storeB = new OrchestratorStore(cwd, repo);
  storeB.bind("session-B");

  const b = storeB.snapshot();
  assert.equal(b.plan, undefined, "session B 不得看见 session A 的 plan");
  assert.equal(b.goal, "");
  assert.equal(b.lastTestsPassed, undefined, "session B 不得继承 A 的测试基线");
  assert.equal(b.phase, "discovery");

  // A 自身仍可见
  const a = storeA.snapshot();
  assert.equal(a.goal, "A goal");
  assert.equal(a.lastTestsPassed, 42);
});

test("持久化往返：重新绑定同 session 恢复任务语义字段", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);

  const s1 = new OrchestratorStore(cwd, repo);
  s1.bind("sess-persist");
  s1.dispatch({ type: "PLAN_COMMITTED", plan: { goal: "g", steps: ["x"] }, at: 1 });
  s1.dispatch({ type: "ESCALATION_REQUESTED", reason: "stuck", at: 2 });

  const s2 = new OrchestratorStore(cwd, repo);
  s2.bind("sess-persist");
  const snap = s2.snapshot();
  assert.equal(snap.goal, "g");
  assert.equal(snap.phase, "stalled");
  assert.ok(snap.escalation && !snap.escalation.consumed);
});

test("load：缺失文件返回 fresh 初始状态", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);
  const r = repo.load("no-such-session");
  assert.equal(r.source, "fresh");
  assert.equal(r.state.schemaVersion, STATE_SCHEMA_VERSION);
});

test("load：schema 版本不符回退初始状态（不静默接受旧数据）", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);
  const file = repo.fileFor("sess-old", "default");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, goal: "legacy", phase: "completed" }), "utf8");

  const r = repo.load("sess-old");
  assert.equal(r.source, "invalid-schema");
  assert.equal(r.state.goal, "", "旧 schema 数据不得混入");
  assert.equal(r.state.phase, "discovery");
});

test("load：损坏 JSON 回退初始状态并报 parse-error", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);
  const file = repo.fileFor("sess-corrupt", "default");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ not json", "utf8");

  const r = repo.load("sess-corrupt");
  assert.equal(r.source, "parse-error");
  assert.equal(r.state.sessionKey, "sess-corrupt");
});

test("persist 原子写入：目标文件存在且无残留 tmp", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);
  const state = createInitialState("sess-atomic");
  state.goal = "atomic";
  const r = repo.persist(state);
  assert.equal(r.ok, true);

  const dir = path.join(cwd, ".pi", "orchestrator-state");
  const files = fs.readdirSync(dir);
  assert.ok(files.includes("sess-atomic__default.json"));
  assert.equal(files.filter((f) => f.endsWith(".tmp")).length, 0, "不应残留 tmp 文件");

  const round = repo.load("sess-atomic");
  assert.equal(round.state.goal, "atomic");
});

test("prune：清理过期 session 状态且保留新状态", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);
  const oldFile = repo.fileFor("sess-old", "default");
  const freshFile = repo.fileFor("sess-fresh", "default");
  fs.mkdirSync(path.dirname(oldFile), { recursive: true });
  fs.writeFileSync(oldFile, "{}", "utf8");
  fs.writeFileSync(freshFile, "{}", "utf8");
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldFile, old, old);

  assert.equal(repo.prune(), 1);
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(freshFile), true);
});

test("key 净化：非法字符被替换，路径不逃逸", () => {
  const cwd = tmpCwd();
  const repo = new StateRepository(cwd);
  const file = repo.fileFor("../../evil/../session", "task/x");
  assert.ok(file.startsWith(path.join(cwd, ".pi", "orchestrator-state")), "状态文件必须在 .pi/orchestrator-state 内");
  assert.ok(!file.includes(".."));
});

test("snapshot 不可变：修改快照不影响内部状态", () => {
  const cwd = tmpCwd();
  const store = new OrchestratorStore(cwd, new StateRepository(cwd));
  store.bind("sess-immut");
  store.dispatch({ type: "PLAN_COMMITTED", plan: { goal: "g", steps: ["s"] }, at: 1 });

  const snap = store.snapshot();
  snap.goal = "tampered";
  snap.remainingSteps.push("injected");

  const fresh = store.snapshot();
  assert.equal(fresh.goal, "g", "快照修改不得污染内部状态");
  assert.deepEqual(fresh.remainingSteps, ["s"]);
});
