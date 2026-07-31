/**
 * auto-orchestrator / test-signal.ts
 * testsPassedDelta 客观进展信号(阶段3 进展账本最后一块客观信号)。
 * 宗旨四:判断停滞优先看测试/错误/工具结果,不只看对话轮数。
 *
 * 职责:
 *   1. isTestCommand  —— 判断 bash 命令是否在跑测试
 *   2. parseTestsPassed —— 从测试输出解析"通过的测试用例数",解析不出返回 null(不臆测)
 *
 * 设计:解析失败返回 null 而非 0,避免把"无法解析"误当成"0 个通过"污染 delta。
 */

/** 常见测试运行器命令。裸运行器名用 (?![\w.]) 排除文件名误伤(jest.config.js);npm test:unit 允许冒号后缀 */
const TEST_CMD_RE = new RegExp(
  "(^|[\\s&|;`])(?:npx\\s+)?" +
    "(?:" +
    "(?:npm|yarn|pnpm|bun)\\s+(?:run\\s+)?test(?:s|:[\\w-]+)?" + // npm test / npm run test:unit
    "|(?:cargo|go|dotnet)\\s+test" +
    "|node\\s+--test" +
    "|(?:mvn|gradle)\\s+(?:-[\\w.]+\\s+)*test" +
    "|(?:vitest|jest|mocha|ava|tape|pytest|py\\.test|phpunit|rspec)(?![\\w.])" + // 裸运行器,排除 jest.config.js
    ")",
);

export function isTestCommand(cmd: string): boolean {
  if (!cmd) return false;
  return TEST_CMD_RE.test(cmd);
}

/** 各框架"通过数"解析规则,按特异性从高到低排列,取第一个命中 */
const PASSED_PATTERNS: RegExp[] = [
  // cargo:  test result: ok. 10 passed; 0 failed; 0 ignored
  /test result:\s*\w+\.\s*(\d+)\s+passed/i,
  // node:test:  # pass 5   /   # tests 8
  /^#\s+pass\s+(\d+)/im,
  // jest / vitest 汇总行(锚定行首 "Tests",兼容冒号/逗号/竖线分隔,不误伤 "Test Files" 行):
  //   Tests:  2 failed, 5 passed, 7 total   /   Tests  4 failed | 6 passed (10)
  /^\s*Tests:?\s+.*?(\d+)\s+passed/im,
  // mocha:  5 passing
  /(\d+)\s+passing\b/i,
  // dotnet:  Passed! - Failed: 0, Passed: 5, Skipped: 0, Total: 5
  /Passed:\s*(\d+)/i,
  // pytest:  ===== 5 passed, 2 failed in 1.23s =====  /  3 passed
  /(\d+)\s+passed\b/i,
];

export function parseTestsPassed(output: string): number | null {
  if (!output) return null;

  // go test:无汇总数字,数 "--- PASS:" 行;出现 FAIL 则输出里通常也有 "--- FAIL"
  if (/^--- PASS:/m.test(output)) {
    const passLines = (output.match(/^--- PASS:/gm) ?? []).length;
    if (passLines > 0) return passLines;
  }

  for (const re of PASSED_PATTERNS) {
    const m = output.match(re);
    if (m && m[1] !== undefined) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}
