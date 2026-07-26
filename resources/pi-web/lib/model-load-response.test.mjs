import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./model-load-response.ts");
}

test("returns a safe model-load error without preserving raw failure text", async () => {
  const { MODEL_LOAD_FAILURE_MESSAGE, withSafeModelLoadFailure } = await loadSubject();
  const result = withSafeModelLoadFailure({
    models: {}, modelList: [], defaultModel: null, thinkingLevels: {}, thinkingLevelMaps: {},
  });
  assert.equal(result.modelError, MODEL_LOAD_FAILURE_MESSAGE);
  assert.equal(JSON.stringify(result).includes("secret path or token"), false);
});
