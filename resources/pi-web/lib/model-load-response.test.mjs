import assert from "node:assert/strict";
import test from "node:test";
import { modelLoadResponse } from "./model-load-response.ts";

const sample = {
  models: { "provider:model": "Model" },
  modelList: [{ provider: "provider", id: "model", name: "Model" }],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
};

test("model load response returns successful registry data", async () => {
  const response = await modelLoadResponse(async () => sample);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sample);
});

test("model load response exposes a generic 500 and logs only error kind", async () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const response = await modelLoadResponse(async () => {
      throw new TypeError("FAULT_SENTINEL sensitive local detail");
    });
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: "Failed to load model configuration" });
    assert.equal(text.includes("FAULT_SENTINEL"), false);
    assert.deepEqual(logs, ["[models] failed to load model configuration (TypeError)"]);
  } finally {
    console.error = originalError;
  }
});
