import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./prompt-failure.ts");
}

test("only a known event-stream failure is treated as definitely unsent", async () => {
  const { getPromptFailureRecovery } = await loadSubject();
  assert.deepEqual(getPromptFailureRecovery(true), {
    definitelyNotSent: true,
    notice: "连接中断，消息未发送；已恢复到输入框。",
  });
  assert.deepEqual(getPromptFailureRecovery(false), {
    definitelyNotSent: false,
    notice: "发送状态未确认。请刷新会话确认消息是否已送达后再重试。",
  });
});
