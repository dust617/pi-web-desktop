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
 *   - --push 时在快照内 git init 新历史并 force-push 到 origin/main。
 *
 * 用法：
 *   node scripts/publish-github.mjs            # 仅构建快照 + 扫描（默认，安全）
 *   node scripts/publish-github.mjs --push     # 构建 + 扫描通过后 force-push（破坏性，需确认）
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
const REMOTE = "https://github.com/dust617/pi-web-desktop.git";
const BRANCH = "main";

const args = new Set(process.argv.slice(2));
const DO_PUSH = args.has("--push");
const KEEP = args.has("--keep");

// 内部运维/规划文档：不发布（含敏感运维细节，对公开项目无用）
const EXCLUDE_EXACT = new Set([
  "STATUS_HANDOFF.md", "MOBILE_AUDIT_REPORT.md", "UPGRADE_LESSONS.md",
  "PROJECT_PLAN.md", "MEMORY_ARCHITECTURE.md", "AGENTS.md", "session_context.md",
  "findings.md", "progress.md", "task_plan.md",
  "build.log", "build-full.log", "npm-install.log", "nul",
  "mobile/findings.md", "mobile/progress.md", "mobile/task_plan.md",
  "mobile/MOBILE_PLAN.md", "mobile/OVERNIGHT_RUN.md",
]);
const EXCLUDE_PREFIX = [
  "mobile/gate0b/", "mobile/vps-relay/", ".pi/", ".backup/", ".test/",
  ".pi-subagents/", "archive/", "release/", "dist/", "publish/.tmp/",
];

// 仅对这些扩展名做文本替换；其余按二进制原样复制
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
  ".html", ".css", ".txt", ".sh", ".bat", ".toml", ".gitignore", ".npmrc",
]);

function git(argsArr, opts = {}) {
  return execFileSync("git", argsArr, { cwd: ROOT, encoding: "utf8", ...opts });
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
  const map = loadMap();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(SNAP, { recursive: true });

  const tracked = git(["ls-files"]).split("\n").map((s) => s.trim()).filter(Boolean);
  let copied = 0, scrubbed = 0, skipped = 0, binary = 0;

  for (const rel of tracked) {
    if (isExcluded(rel)) { skipped++; continue; }
    const src = path.join(ROOT, rel);
    const dst = path.join(SNAP, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });

    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel).toLowerCase();
    const isText = TEXT_EXT.has(ext) || base === ".gitignore" || base === ".npmrc";
    const buf = fs.readFileSync(src);

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

function scan(map) {
  const patterns = map.scanPatterns || [];
  const hits = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const buf = fs.readFileSync(full);
      if (looksBinary(buf)) continue;
      const text = buf.toString("utf8");
      const rel = path.relative(SNAP, full).replace(/\\/g, "/");
      for (const p of patterns) {
        if (p && text.includes(p)) hits.push(`${rel}: 含 "${p}"`);
      }
    }
  }
  walk(SNAP);
  return hits;
}

function push() {
  git(["init", "-q"], { cwd: SNAP });
  git(["checkout", "-q", "-b", BRANCH], { cwd: SNAP });
  git(["add", "-A"], { cwd: SNAP });
  git(["-c", "user.name=dust617", "-c", "user.email=dust617@users.noreply.github.com",
       "commit", "-q", "-m",
       "feat: pi-web-desktop — Electron desktop shell + mobile PWA bridge (public release)"],
      { cwd: SNAP });
  git(["remote", "add", "origin", REMOTE], { cwd: SNAP });
  git(["push", "--force", "origin", BRANCH], { cwd: SNAP, stdio: "inherit" });
  console.log(`✓ 已 force-push 全新干净历史到 ${REMOTE} (${BRANCH})`);
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

if (DO_PUSH) {
  push();
} else {
  console.log(`\n快照就绪于：${SNAP}`);
  console.log("人工检查后，运行 `node scripts/publish-github.mjs --push` 推送。");
}
if (!KEEP && DO_PUSH) fs.rmSync(TMP, { recursive: true, force: true });
