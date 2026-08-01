import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { createInitialState } from "../.pi/extensions/auto-orchestrator/state-reducer.js";
import {
  ROUTER_SUPERVISOR_HINT_SCHEMA_VERSION,
  clearOwnRouteHint,
  hintFile,
  recommendRouteHint,
  writeRouteHint,
} from "../.pi/extensions/auto-orchestrator/router-supervisor.js";

function context(text: string) {
  return {
    systemPrompt: "",
    messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }],
  } as any;
}

test("普通任务不生成 supervisor hint，模型选择仍交给 Pi Router", () => {
  const result = recommendRouteHint(context("帮我解释这段代码"), createInitialState("s"), "s", "t0", 1_000);
  assert.equal(result.hint, undefined);
});

test("架构/重构任务只抬高到 high，不指定具体模型", () => {
  const result = recommendRouteHint(context("请为整个项目做架构重构方案"), createInitialState("s"), "s", "t1", 1_000);
  assert.equal(result.hint?.mode, "high");
  assert.deepEqual(result.hint?.reasonCodes, ["planning_required"]);
  assert.ok(result.score >= 0.52);
  assert.equal(result.hint?.expiresAt, 121_000);
});

test("连续工具失败会自适应抬高到 high", () => {
  const state = createInitialState("s");
  state.toolFailuresThisAttempt = 2;
  state.progressScore = 0.2;
  const result = recommendRouteHint(context("继续处理"), state, "s", "t-fail", 1_000);
  assert.equal(result.hint?.mode, "high");
  assert.ok(result.reasonCodes.includes("stalled_or_diagnosis"));
});

test("中等风险请求触发 high，但仍不指定具体模型", () => {
  const result = recommendRouteHint(context("这涉及安全，请核实后再改"), createInitialState("s"), "s", "t-risk", 1_000);
  assert.equal(result.hint?.mode, "high");
  assert.ok(result.reasonCodes.includes("elevated_risk"));
});

test("累计风险很高时抬高到 ultra，且 hint 不包含用户原文", () => {
  const state = createInitialState("s");
  state.riskScore = 0.6;
  const result = recommendRouteHint(context("这是高风险生产环境安全修改，请核实"), state, "session-a", "t2", 1_000);
  assert.equal(result.hint?.mode, "ultra");
  assert.equal(result.hint?.schemaVersion, ROUTER_SUPERVISOR_HINT_SCHEMA_VERSION);
  assert.ok(result.hint?.reasonCodes.includes("high_risk_or_consensus"));
  assert.equal(JSON.stringify(result.hint).includes("生产环境"), false);
});

test("hint 原子写入；只允许清理本 session 的提示", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "router-supervisor-"));
  try {
    const state = createInitialState("s");
    state.riskScore = 0.6;
    const hint = recommendRouteHint(context("高风险安全问题"), state, "session-a", "t3", 1_000).hint;
    assert.ok(hint);
    writeRouteHint(cwd, hint);
    assert.deepEqual(JSON.parse(fs.readFileSync(hintFile(cwd), "utf8")), hint);

    clearOwnRouteHint(cwd, "session-b");
    assert.equal(fs.existsSync(hintFile(cwd)), true, "不得删除其他会话的提示");
    clearOwnRouteHint(cwd, "session-a");
    assert.equal(fs.existsSync(hintFile(cwd)), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("pi-model-auto 补丁可从未补丁 fixture 重复应用，并保留 supervisor/user forced-route 边界", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-model-auto-patch-"));
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.2.0" }), "utf8");
    fs.writeFileSync(path.join(root, "src", "index.ts"), `
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
type CapabilityMode = "low" | "medium" | "high" | "ultra";
type ForcedRoute = { mode: CapabilityMode };
const CONFIG_DIR_NAME = ".pi";
type QuotaPlanLookup = Map<string, { planKey: string; auth: Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>> }>;
function decide(a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown) { return {}; }
function register(pi: any) {
  let forcedRoute: ForcedRoute | undefined;
  pi.on("session_shutdown", async () => {
    forcedRoute = undefined;
  });
  pi.on("input", async (event: any, ctx: ExtensionContext) => {
    const parsed = parseForcedRoute(event.text);
    const parsedForThisTurn = parsed && isInitialUserTurn(ctx) ? parsed : undefined;
    if (parsed && !parsedForThisTurn) {
      ctx.ui.notify("Pi Router: @low/@medium/@high/@ultra/@model hints only apply at the start of a conversation. Start a new session to pin a mode without carrying existing history.", "warning");
    }
    forcedRoute = parsedForThisTurn?.route;
    decide(context, options, forcedRoute, cfg, cache);
    decide(context, undefined, forcedRoute, cfg, cache);
    if (cfg.quota.enabled && !forcedRoute) quota();
    if (forcedRoute || !cfg.classifier.enabled) return undefined;
    if (!forcedRoute && decision.cls !== "model") classify();
  });
}
function parseForcedRoute(_text: string): { route: ForcedRoute } | undefined { return undefined; }
function isInitialUserTurn(_ctx: ExtensionContext): boolean { return true; }
`, "utf8");

    const script = path.resolve("scripts/apply-pi-model-auto-supervisor-patch.mjs");
    const first = spawnSync(process.execPath, [script, "--dir", root], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, [script, "--dir", root], { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    const check = spawnSync(process.execPath, [script, "--check", "--dir", root], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);

    const patched = fs.readFileSync(path.join(root, "src", "index.ts"), "utf8");
    assert.match(patched, /const supervisorHint = !parsed \? readSupervisorHint\(ctx\) : undefined;/);
    assert.match(patched, /let supervisorForcedMode: \{ mode: CapabilityMode \} \| undefined;/);
    assert.match(patched, /forcedRoute \?\? supervisorForcedMode/);
    assert.match(patched, /cfg\.quota\.enabled && !forcedRoute/);
    assert.match(patched, /if \(forcedRoute \|\| supervisorForcedMode \|\| !cfg\.classifier\.enabled\) return undefined;/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
