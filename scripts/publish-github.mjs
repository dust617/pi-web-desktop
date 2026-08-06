#!/usr/bin/env node
/**
 * publish-github.mjs — 生成「脱敏快照 + 全新干净历史」用于公开发布。
 *
 * 设计原则：
 *   - 本地仓库完全不动（保留未脱敏完整版与完整历史）。
 *   - 从当前 HEAD 的已跟踪文件导出快照到 publish/.tmp/snapshot/。
 *   - 排除内部运维文档（EXCLUDE）。
 *   - 对文本文件应用 publish/desensitize-map.json 的替换（真实值仅存于该 gitignored 文件）。
 *   - 复扫快照，确认 0 个敏感命中后才允许推送。
 *   - 此脚本永不推送 GitHub；公开发布必须从经审阅的快照创建独立分支，
 *     以显式 refspec 进行 fast-forward 更新。
 *
 * 用法：
 *   node scripts/publish-github.mjs            # 构建快照 + 扫描（默认，安全）
 *   node scripts/publish-github.mjs --keep     # 构建后保留快照目录供人工检查
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_FILE = path.join(ROOT, "publish", "desensitize-map.json");
const TMP = path.join(ROOT, "publish", ".tmp");
const SNAP = path.join(TMP, "snapshot");
const args = new Set(process.argv.slice(2));
const KEEP = args.has("--keep");
if (args.has("--push")) {
  console.error("✗ --push 已禁用：请从审阅后的快照创建公开发布分支，禁止此脚本覆盖 main。");
  process.exit(64);
}

// 内部运维/规划文档：不发布（含敏感运维细节，对公开项目无用）
const EXCLUDE_EXACT = new Set([
  "STATUS_HANDOFF.md", "MOBILE_AUDIT_REPORT.md", "UPGRADE_LESSONS.md",
  "PROJECT_PLAN.md", "MEMORY_ARCHITECTURE.md", "AGENTS.md", "session_context.md",
  "findings.md", "progress.md", "task_plan.md",
  "build.log", "build-full.log", "npm-install.log", "nul",
  "docs/release-workflow.md", // 发布流程文档含真实值示例，仅本地参考，不入公开快照
  "scripts/tests/memory-guard.test.mjs", // 含字面假 secret 测试样例，触发 GitHub secret scanning；本地保留，不入公开快照
  "mobile/findings.md", "mobile/progress.md", "mobile/task_plan.md",
  "mobile/MOBILE_PLAN.md", "mobile/OVERNIGHT_RUN.md",
]);
const EXCLUDE_PREFIX = [
  "mobile/gate0b/", "mobile/vps-relay/", ".pi/", ".backup/", ".test/",
  ".pi-subagents/", "archive/", "release/", "dist/", "publish/.tmp/",
  "智能路由模型/",
  // Next.js 构建产物：体积大、含绝对路径、易变，不入公开快照（与 v0.3.3-public 一致）
  "resources/pi-web/.next/",
];

// 仅对这些扩展名做文本替换；其余按二进制原样复制
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
  ".html", ".css", ".txt", ".sh", ".bat", ".toml", ".gitignore", ".npmrc", ".patch",
]);

function git(argsArr, opts = {}) {
  return execFileSync("git", argsArr, { cwd: ROOT, encoding: "utf8", ...opts });
}

function gitBytes(argsArr) {
  // Generated Pi Web chunks can exceed Node's 1 MiB execFileSync default.
  return execFileSync("git", argsArr, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function requireCleanTree() {
  const status = git(["status", "--porcelain", "--untracked-files=all"]).trim();
  if (status) {
    console.error("✗ 工作区不干净：快照只能从已提交的 HEAD 构建。请先提交或清理变更后重试。");
    process.exit(1);
  }
}

function isExcluded(rel) {
  if (EXCLUDE_EXACT.has(rel)) return true;
  return EXCLUDE_PREFIX.some((p) => rel.startsWith(p));
}

function loadMap() {
  if (!fs.existsSync(MAP_FILE)) {
    console.error(`✗ 缺少脱敏映射文件：${MAP_FILE}（本地文件，不入库）`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
}

function desensitize(text, replacements) {
  let out = text;
  for (const { from, to } of replacements) {
    if (!from) continue;
    out = out.split(from).join(to);
  }
  return out;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function build() {
  requireCleanTree();
  const map = loadMap();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(SNAP, { recursive: true });

  const tracked = git(["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").map((s) => s.trim()).filter(Boolean);
  let copied = 0, scrubbed = 0, skipped = 0, binary = 0;

  for (const rel of tracked) {
    if (isExcluded(rel)) { skipped++; continue; }
    const dst = path.join(SNAP, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });

    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel).toLowerCase();
    const isText = TEXT_EXT.has(ext) || base === ".gitignore" || base === ".npmrc";
    const buf = gitBytes(["show", `HEAD:${rel}`]);

    if (isText && !looksBinary(buf)) {
      const out = desensitize(buf.toString("utf8"), map.replacements);
      fs.writeFileSync(dst, out, "utf8");
      scrubbed++;
    } else {
      fs.writeFileSync(dst, buf);
      binary++;
    }
    copied++;
  }

  console.log(`✓ 快照构建完成：复制 ${copied} 个文件（文本脱敏 ${scrubbed}，二进制原样 ${binary}），排除 ${skipped} 个内部文件`);
  return map;
}

const GENERIC_SENSITIVE_PATTERNS = [
  ["private-key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i],
  ["access-token", /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/i],
  ["bearer-token", /\bBearer\s+[A-Za-z0-9._-]{16,}/i],
  ["credential-assignment", /\b(?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*["'][A-Za-z0-9._-]{12,}["']/i],
  ["basic-auth-url", /https?:\/\/[^/\s@]+:[^/\s@]+@/i],
  ["user-home-path", /[A-Za-z]:[\\/]Users[\\/](?!(?:<[^>]+>|user(?:name)?|example|test)(?:[\\/]|$))[^\s"'`\\/]+/i],
  ["private-ip", /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/],
];

function isGenericScanExempt(rel) {
  return rel.startsWith("resources/pi-web/.next/")
    || rel.startsWith("scripts/tests/")
    || /(?:^|\/)test(?:s)?\/|\.test\.[cm]?[jt]sx?$/.test(rel)
    || /(?:^|\/)(?:package-lock\.json|bun\.lock)$/.test(rel);
}

function scan(map) {
  const mappedPatterns = map.scanPatterns || [];
  const hits = new Set();
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const buf = fs.readFileSync(full);
      if (looksBinary(buf)) continue;
      const text = buf.toString("utf8");
      const rel = path.relative(SNAP, full).replace(/\\/g, "/");
      if (mappedPatterns.some((p) => p && text.includes(p))) hits.add(`${rel}: mapped-sensitive-pattern`);
      // Detection rules and generated/test/lock artifacts contain deliberate signatures,
      // not released runtime data; exact local-map scanning still covers every text file.
      if (rel === "scripts/publish-github.mjs" || isGenericScanExempt(rel)) continue;
      for (const [kind, pattern] of GENERIC_SENSITIVE_PATTERNS) {
        if (pattern.test(text)) hits.add(`${rel}: ${kind}`);
      }
    }
  }
  walk(SNAP);
  return [...hits];
}

// ── main ──
const map = build();
const hits = scan(map);
if (hits.length) {
  console.error(`\n✗ 快照仍含 ${hits.length} 处敏感命中，禁止推送：`);
  for (const h of hits) console.error("  - " + h);
  process.exit(2);
}
console.log("✓ 脱敏复扫通过：0 个敏感命中");

console.log(`\n快照就绪于：${SNAP}`);
console.log("请在独立公开 worktree 中审阅快照、执行验证，并用显式 refspec 推送审阅分支；本脚本不会推送。");
if (!KEEP) console.log("提示：下次运行会覆盖此临时快照；需要持续保留时使用 --keep。 ");
