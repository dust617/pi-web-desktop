import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-copy.ts");
}

test("formats labelled session ID and JSONL path for clipboard", async () => {
  const { formatSessionCopyDetails } = await loadSubject();
  assert.equal(
    formatSessionCopyDetails({
      id: "019f9e47-edc9-7b90-b8be-1b0652d842d2",
      path: "C:/Users/<USER>/.pi/agent/sessions/project/session.jsonl",
    }),
    "Session ID: 019f9e47-edc9-7b90-b8be-1b0652d842d2\nSession file: C:/Users/<USER>/.pi/agent/sessions/project/session.jsonl",
  );
});
