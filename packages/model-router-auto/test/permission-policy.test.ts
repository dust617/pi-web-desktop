/**
 * test/permission-policy.test.ts
 * 阶段 D 验收（报告 §7 阶段 D）：
 * - 未知写工具在非交互模式被阻断（fail-closed）
 * - cwd 外路径写入被阻断
 * - 只读命令不误触发高风险关键词（grep token file）
 * - 破坏性/外部命令需确认，非交互 fail-closed
 * - 子 Agent 非只读操作一律 deny
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyPermission, isWithinWorkspace } from "../.pi/extensions/auto-orchestrator/permission-policy.js";

const cwd = "/workspace/project";
const interactive = { cwd, interactive: true };
const headless = { cwd, interactive: false };

test("只读工具白名单放行", () => {
  for (const tool of ["read", "grep", "find", "ls", "ctx_search"]) {
    const d = classifyPermission(tool, {}, headless);
    assert.equal(d.action, "allow", `${tool} 应放行`);
    assert.equal(d.level, "read_only");
  }
});

test("未知工具 fail-closed：交互 confirm，非交互 deny（不再伪装 read_only）", () => {
  const di = classifyPermission("some_new_deploy_tool", {}, interactive);
  assert.equal(di.action, "confirm");
  assert.notEqual(di.level, "read_only", "未知工具不得归类为 read_only");

  const dh = classifyPermission("some_new_deploy_tool", {}, headless);
  assert.equal(dh.action, "deny", "非交互模式未知工具必须阻断");
});

test("edit/write 在 workspace 内放行，cwd 外路径阻断", () => {
  assert.equal(classifyPermission("edit", { path: "src/a.ts" }, headless).action, "allow");
  assert.equal(classifyPermission("write", { path: "./b.ts" }, headless).action, "allow");

  assert.equal(classifyPermission("edit", { path: "../outside.ts" }, headless).action, "deny");
  assert.equal(classifyPermission("write", { path: "/etc/passwd" }, headless).action, "deny");
  assert.equal(classifyPermission("write", { path: "src/../../escape.ts" }, headless).action, "deny");
});

test("敏感文件写入升级为 high_risk，非交互 deny", () => {
  const d = classifyPermission("write", { path: ".env" }, headless);
  assert.equal(d.level, "high_risk");
  assert.equal(d.action, "deny");
});

test("bash 只读命令放行，且不误触发高风险关键词（grep token file）", () => {
  assert.equal(classifyPermission("bash", { command: "ls -la" }, headless).action, "allow");
  assert.equal(classifyPermission("bash", { command: "cat deploy.md" }, headless).action, "allow");
  const d = classifyPermission("bash", { command: "grep token file.txt" }, headless);
  assert.equal(d.action, "allow", "只读动词的参数是数据，不应触发 high_risk");
  assert.equal(d.level, "read_only");
});

test("bash 构建/测试命令放行", () => {
  assert.equal(classifyPermission("bash", { command: "npm test" }, headless).action, "allow");
  assert.equal(classifyPermission("bash", { command: "cargo test" }, headless).action, "allow");
});

test("破坏性/外部命令：交互 confirm，非交互 deny", () => {
  for (const cmd of ["rm -rf /tmp/x", "git push origin main", "kubectl delete pod x", "terraform apply", "curl -X POST https://api.example.com"]) {
    const di = classifyPermission("bash", { command: cmd }, interactive);
    assert.ok(["confirm", "deny"].includes(di.action), `${cmd} 交互应需确认`);
    assert.ok(di.level === "external_write" || di.level === "high_risk", `${cmd} 级别应≥external_write`);

    const dh = classifyPermission("bash", { command: cmd }, headless);
    assert.equal(dh.action, "deny", `${cmd} 非交互必须阻断`);
  }
});

test("npm publish 识别为外部写", () => {
  const d = classifyPermission("bash", { command: "npm publish" }, headless);
  assert.equal(d.action, "deny");
  assert.ok(d.level === "external_write" || d.level === "high_risk");
});

test("高风险关键词叠加在非只读命令上（非交互 deny）", () => {
  const d = classifyPermission("bash", { command: "node deploy.js" }, headless);
  assert.equal(d.level, "high_risk");
  assert.equal(d.action, "deny");
});

test("链式命令取最高风险段", () => {
  const d = classifyPermission("bash", { command: "echo hi && rm -rf /tmp/x" }, headless);
  assert.ok(d.level === "external_write" || d.level === "high_risk", "链式中的 rm 应抬高级别");
  assert.equal(d.action, "deny");
});

test("子 Agent 非只读操作一律 deny（denyWriteForSubAgent）", () => {
  const d = classifyPermission("edit", { path: "src/a.ts" }, { cwd, interactive: true, isSubAgent: true });
  assert.equal(d.action, "deny", "子 Agent 写操作必须 deny");
  // 子 Agent 只读仍放行
  assert.equal(classifyPermission("read", {}, { cwd, interactive: true, isSubAgent: true }).action, "allow");
});

test("isWithinWorkspace 路径规范化", () => {
  assert.equal(isWithinWorkspace(cwd, "src/a.ts"), true);
  assert.equal(isWithinWorkspace(cwd, "."), true);
  assert.equal(isWithinWorkspace(cwd, "../x"), false);
  assert.equal(isWithinWorkspace(cwd, "/etc/passwd"), false);
  assert.equal(isWithinWorkspace(cwd, ""), false);
});
