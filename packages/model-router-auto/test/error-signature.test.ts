/**
 * test/error-signature.test.ts
 * 错误签名归一化的边界行为（纯函数）。
 * 覆盖：空串、超长截断、数字→N、空白归一、大小写折叠、调用稳定性、同因归一。
 *
 * 已修复：原正则 ['"\\/][^'"\\/]*['"\\/]/g 把斜杠当配对分隔符，对含反斜杠的
 * Windows 路径（"C:\\a.ts"）拆碎、残留文件名片段，导致同类错误（仅路径不同）
 * 未归一为相同签名，压低 sameErrorSignatureCount、stalledByErrorSig 跨路径
 * 重复漏触发。现改为引号串整体匹配（"..." / '...' 整体→X），斜杠退出配对集。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeErrorSignature } from "../.pi/extensions/auto-orchestrator/error-signature.js";

test("空字符串归一为空", () => {
  assert.equal(normalizeErrorSignature(""), "");
});

test("超长错误签名截断到 120 字符", () => {
  const out = normalizeErrorSignature("a".repeat(200));
  assert.equal(out.length, 120);
  assert.equal(out, "a".repeat(120));
});

test("短串原样保留（仅小写化）", () => {
  assert.equal(normalizeErrorSignature("short"), "short");
});

test("数字归一为 N", () => {
  assert.equal(normalizeErrorSignature("404 Not Found"), "n not found");
});

test("连续数字合并为单个 N", () => {
  assert.equal(normalizeErrorSignature("port 8080 and 3000"), "port n and n");
});

test("空白（含换行/制表）归一为单空格", () => {
  assert.equal(normalizeErrorSignature("Multiple    spaces\n\nand\ttabs"), "multiple spaces and tabs");
});

test("大小写折叠为小写", () => {
  assert.equal(normalizeErrorSignature("UPPER CASE Error"), "upper case error");
});

test("ECONNREFUSED 归一保留类型特征", () => {
  assert.equal(normalizeErrorSignature("ECONNREFUSED 127.0.0.1:8080"), "econnrefused n.n.n.n:n");
});

test("同一输入多次调用结果稳定（幂等性）", () => {
  const input = "TypeError: cannot read property x of undefined at line 42";
  const first = normalizeErrorSignature(input);
  const second = normalizeErrorSignature(first); // 对已归一结果再归一应不变
  assert.equal(first, second);
});

test("截断发生在归一化之后（数字不跨截断边界）", () => {
  // 130 个 'a' + 数字：先归一（无数字变化）再截断 120
  const out = normalizeErrorSignature("a".repeat(130) + "999");
  assert.equal(out.length, 120);
  assert.ok(out.startsWith("a".repeat(120)));
});

test("同因错误（仅路径/数字不同）归一为相同签名", () => {
  const a = normalizeErrorSignature('Error in "C:\\a.ts" line 1');
  const b = normalizeErrorSignature('Error in "D:\\b.ts" line 999');
  assert.equal(a, b, "双引号路径应整体归一，使同因错误累加 sameErrorSignatureCount");
});

test("单引号路径同样归一", () => {
  const a = normalizeErrorSignature("Cannot find module 'C:\\x\\y' at 12");
  const b = normalizeErrorSignature("Cannot find module 'D:\\z\\w' at 99");
  assert.equal(a, b);
});
