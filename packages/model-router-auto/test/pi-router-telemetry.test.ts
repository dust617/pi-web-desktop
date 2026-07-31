import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  completedRouteRecords,
  isPiRouterAuto,
  modelRef,
} from "../.pi/extensions/pi-router-telemetry/index.js";

test("Pi Router companion only identifies the pi-router/auto virtual model", () => {
  assert.equal(isPiRouterAuto({ provider: "pi-router", id: "auto" } as any), true);
  assert.equal(isPiRouterAuto({ provider: "openai", id: "gpt" } as any), false);
  assert.equal(isPiRouterAuto(undefined), false);
});

test("Pi Router companion records the concrete response model without changing selection", () => {
  const assistant = {
    role: "assistant",
    provider: "aliyun-token-plan",
    model: "router-alias",
    responseModel: "qwen3.6-flash",
  } as any;
  assert.equal(modelRef(assistant), "aliyun-token-plan/qwen3.6-flash");
  assert.equal(modelRef({ role: "toolResult" } as any), undefined);
});

test("Pi Router companion only creates paired telemetry after a completed turn", () => {
  const records = completedRouteRecords(
    { decisionId: "d-1", taskId: "task-1", attemptId: "attempt-1", startedAt: 100 },
    "session-1",
    3,
    {
      role: "assistant",
      provider: "openai-codex",
      responseModel: "gpt-5.6-luna",
      stopReason: "stop",
    },
    250,
  );

  assert.equal(records.intent.decisionId, records.outcome.decisionId);
  assert.equal(records.intent.plannedModel, "pi-router/auto");
  assert.equal(records.outcome.actualModel, "openai-codex/gpt-5.6-luna");
  assert.equal(records.outcome.status, "success");
  assert.equal(records.outcome.latencyMs, 150);
});

test("Pi Router companion completed records preserve aborted status", () => {
  const { outcome } = completedRouteRecords(
    { decisionId: "d-2", taskId: "task-2", attemptId: "attempt-2", startedAt: 100 },
    "session-1",
    4,
    { role: "assistant", provider: "pi-router", model: "auto", stopReason: "aborted" },
    120,
  );
  assert.equal(outcome.status, "aborted");
  assert.equal(outcome.committed, false);
});

test("Pi Router companion never takes over model selection or provider registration", () => {
  const source = fs.readFileSync(path.join(process.cwd(), ".pi/extensions/pi-router-telemetry/index.ts"), "utf8");
  const executable = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(executable, /\bsetModel\s*\(/);
  assert.doesNotMatch(executable, /\bregisterProvider\s*\(/);
});
