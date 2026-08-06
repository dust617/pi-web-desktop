/**
 * test/test-signal.test.ts
 * 阶段 A 持久测试：test-signal 纯函数（isTestCommand / parseTestsPassed）。
 * 报告 §8.1：test-signal 八类框架及边界输入。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isTestCommand, parseTestsPassed } from "../.pi/extensions/auto-orchestrator/test-signal.js";

test("isTestCommand: 识别常见测试运行命令", () => {
  assert.equal(isTestCommand("npm test"), true);
  assert.equal(isTestCommand("npm run test:unit"), true);
  assert.equal(isTestCommand("pnpm test"), true);
  assert.equal(isTestCommand("cargo test"), true);
  assert.equal(isTestCommand("go test ./..."), true);
  assert.equal(isTestCommand("node --test"), true);
  assert.equal(isTestCommand("npx vitest run"), true);
  assert.equal(isTestCommand("pytest -q"), true);
  assert.equal(isTestCommand("mvn test"), true);
});

test("isTestCommand: 不误伤文件名与无关命令", () => {
  assert.equal(isTestCommand("cat jest.config.js"), false);
  assert.equal(isTestCommand("ls"), false);
  assert.equal(isTestCommand("echo hello"), false);
  assert.equal(isTestCommand(""), false);
});

test("parseTestsPassed: 各框架汇总行", () => {
  assert.equal(parseTestsPassed("test result: ok. 10 passed; 0 failed; 0 ignored"), 10);
  assert.equal(parseTestsPassed("# pass 5\n# tests 8"), 5);
  assert.equal(parseTestsPassed("Tests:  2 failed, 5 passed, 7 total"), 5);
  assert.equal(parseTestsPassed("  5 passing (12ms)"), 5);
  assert.equal(parseTestsPassed("Passed! - Failed: 0, Passed: 5, Skipped: 0, Total: 5"), 5);
  assert.equal(parseTestsPassed("===== 5 passed, 2 failed in 1.23s ====="), 5);
});

test("parseTestsPassed: go test 数 --- PASS 行", () => {
  const out = "--- PASS: TestA (0.00s)\n--- PASS: TestB (0.01s)\nok pkg 0.02s";
  assert.equal(parseTestsPassed(out), 2);
});

test("parseTestsPassed: 解析失败返回 null 而非 0（不臆测）", () => {
  assert.equal(parseTestsPassed(""), null);
  assert.equal(parseTestsPassed("some random output without summary"), null);
});
