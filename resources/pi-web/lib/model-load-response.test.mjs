import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./model-load-response.ts");
}

test("returns a safe model-load error without preserving raw failure text", async () => {
  const { withSafeModelLoadFailure, MODEL_LOAD_FAILURE_MESSAGE } = await loadSubject();
  const safe = withSafeModelLoadFailure({ models: [], thinkingLevels: [] });
  assert.equal(safe.modelError, MODEL_LOAD_FAILURE_MESSAGE);
});
