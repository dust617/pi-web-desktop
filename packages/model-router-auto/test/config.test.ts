/**
 * test/config.test.ts
 * 阶段 E 验收（报告 §7 阶段 E）：非法 limits/thinking/model ref 在启动时给出可操作错误；
 * 缺失可选字段填默认值；未知字段告警。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findConfigFile, validateConfig, isValidModelRef } from "../.pi/extensions/auto-orchestrator/config.js";

const validRaw = {
  virtualModel: { provider: "orchestrator", id: "auto", name: "Auto", contextWindow: 200000, maxTokens: 32000 },
  models: { fast: "p/fast", executor: "p/exec", planner: "p/plan", diagnostician: "p/diag", reviewers: ["p/r1"] },
  fallback: ["p/exec"],
  limits: { maxSwitchesPerTurn: 2, maxRetriesPerError: 2, maxReviewers: 3, modelStickinessTurns: 3 },
  thinking: { planner: "high" },
};

test("合法配置通过，可选字段填默认值", () => {
  const { config, warnings } = validateConfig(validRaw);
  assert.equal(config.models.planner, "p/plan");
  assert.equal(config.limits.maxSwitchesPerTurn, 2);
  assert.equal(warnings.length, 0);
});

test("缺失 limits/thinking 时填默认值", () => {
  const raw = { ...validRaw };
  delete (raw as any).limits;
  delete (raw as any).thinking;
  const { config } = validateConfig(raw);
  assert.equal(config.limits.maxSwitchesPerTurn, 2);
  assert.equal(config.limits.maxReviewers, 3);
  assert.equal(config.thinking, undefined);
});

test("非法 model ref 抛可操作错误", () => {
  assert.throws(() => validateConfig({ ...validRaw, models: { ...validRaw.models, fast: "no-slash" } }), /models\.fast/);
  assert.throws(() => validateConfig({ ...validRaw, models: { ...validRaw.models, reviewers: ["bad"] } }), /reviewers\[0\]/);
});

test("limits 超范围抛错", () => {
  assert.throws(() => validateConfig({ ...validRaw, limits: { ...validRaw.limits, maxSwitchesPerTurn: 999 } }), /maxSwitchesPerTurn/);
  assert.throws(() => validateConfig({ ...validRaw, limits: { ...validRaw.limits, maxReviewers: 0 } }), /maxReviewers/);
  assert.throws(() => validateConfig({ ...validRaw, limits: { ...validRaw.limits, maxRetriesPerError: 1.5 } }), /整数/);
});

test("非法 thinking 值抛错", () => {
  assert.throws(() => validateConfig({ ...validRaw, thinking: { planner: "ultra" } }), /thinking\.planner/);
});

test("缺少必需角色抛错", () => {
  const m = { ...validRaw.models } as any;
  delete m.planner;
  assert.throws(() => validateConfig({ ...validRaw, models: m }), /models\.planner/);
});

test("未知顶层字段产生告警但不致命", () => {
  const { warnings } = validateConfig({ ...validRaw, experimental: true });
  assert.ok(warnings.some((w) => w.includes("experimental")));
});

test("verifier 超时范围校验", () => {
  const { config } = validateConfig({ ...validRaw, verifier: { perReviewerTimeoutMs: 60000, overallTimeoutMs: 90000 } });
  assert.equal(config.verifier?.perReviewerTimeoutMs, 60000);
  assert.throws(() => validateConfig({ ...validRaw, verifier: { perReviewerTimeoutMs: 10 } }), /perReviewerTimeoutMs/);
});

test("isValidModelRef 边界", () => {
  assert.equal(isValidModelRef("p/m"), true);
  assert.equal(isValidModelRef("/m"), false);
  assert.equal(isValidModelRef("p/"), false);
  assert.equal(isValidModelRef("pm"), false);
  assert.equal(isValidModelRef(42 as any), false);
});

test("findConfigFile：项目配置优先，否则回退全局 Pi 配置", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-config-"));
  const project = path.join(root, "project");
  const global = path.join(root, "global");
  fs.mkdirSync(path.join(project, ".pi"), { recursive: true });
  fs.mkdirSync(path.join(global, "auto-orchestrator"), { recursive: true });
  const projectFile = path.join(project, ".pi", "orchestrator.json");
  const globalFile = path.join(global, "auto-orchestrator", "orchestrator.json");
  fs.writeFileSync(projectFile, "{}");
  fs.writeFileSync(globalFile, "{}");
  const previous = process.env.PI_CONFIG_DIR;
  process.env.PI_CONFIG_DIR = global;
  try {
    assert.equal(findConfigFile(project), projectFile);
    fs.unlinkSync(projectFile);
    assert.equal(findConfigFile(project), globalFile);
  } finally {
    if (previous === undefined) delete process.env.PI_CONFIG_DIR;
    else process.env.PI_CONFIG_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
