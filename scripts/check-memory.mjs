import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarAgeDays, findMemoryControlRisk, findMemorySecretRisk, isMemoryDateExpired } from './memory-contract.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.PI_MEMORY_CHECK_ROOT ? path.resolve(process.env.PI_MEMORY_CHECK_ROOT) : defaultRoot;
const today = new Date();
const errors = [];
const warnings = [];

const specs = [
  ['AGENTS.md', 4096, 80, true],
  ['.pi/memory/STATUS.md', 2048, 32, true],
  ['.pi/memory/FACTS.md', 65536, 800, true],
  ['task_plan.md', 4096, 80, true],
  ['findings.md', 12288, 160, true],
  ['progress.md', 2048, 40, true],
  ['MEMORY_ARCHITECTURE.md', 16384, 260, true],
];

const globalFiles = [
  [path.join(os.homedir(), '.pi', 'agent', 'AGENTS.md'), 2048, 40],
  [path.join(os.homedir(), '.pi', 'agent', 'PROJECTS.md'), 2048, 40],
];

const loaded = new Map();

function inspectFile(file, maxBytes, maxLines, required = false) {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const label = path.isAbsolute(file) ? abs : file;
  if (!fs.existsSync(abs)) {
    if (required) errors.push(`${label}: missing`);
    return;
  }
  const text = fs.readFileSync(abs, 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = text === '' ? 0 : text.split(/\r?\n/).length;
  loaded.set(abs, text);
  if (bytes > maxBytes) errors.push(`${label}: ${bytes}B > ${maxBytes}B`);
  if (lines > maxLines) errors.push(`${label}: ${lines} lines > ${maxLines}`);
}

for (const spec of specs) inspectFile(...spec);
for (const [file, bytes, lines] of globalFiles) inspectFile(file, bytes, lines, false);

for (const required of ['.pi/extensions/memory-guard/index.ts', 'scripts/memory-contract.mjs']) {
  if (!fs.existsSync(path.join(root, required))) errors.push(`${required}: missing`);
}

for (const legacy of ['STATUS.md', 'KEYSTORE.md']) {
  if (fs.existsSync(path.join(root, legacy))) {
    errors.push(`${legacy}: legacy duplicate exists; use .pi/memory instead`);
  }
}

const status = loaded.get(path.join(root, '.pi/memory/STATUS.md')) ?? '';
const verifyBy = status.match(/^> Updated: \d{4}-\d{2}-\d{2} \| Verify-by: (\d{4}-\d{2}-\d{2})$/m);
if (!verifyBy) {
  errors.push('.pi/memory/STATUS.md: missing exact Updated/Verify-by metadata');
} else if (isMemoryDateExpired(verifyBy[1], 0, today)) {
  errors.push(`.pi/memory/STATUS.md: expired Verify-by ${verifyBy[1]}`);
}
const nextActions = (status.match(/^- \[ \]/gm) ?? []).length;
if (nextActions > 6) errors.push(`.pi/memory/STATUS.md: ${nextActions} next actions > 6`);

const facts = loaded.get(path.join(root, '.pi/memory/FACTS.md')) ?? '';
const factHeadings = facts.match(/^## /gm)?.length ?? 0;
const factMeta = [...facts.matchAll(/^## (F-\d+) \| [^\r\n]+\r?\n> Verified: (\d{4}-\d{2}-\d{2}) \| TTL: (\d+)d\r?\n> Type: (fact|decision|constraint|failure_pattern) \| Priority: (normal|pinned)(?: \| Replaces: (F-\d+))?\r?\n> Source: ([^\r\n]+)$/gm)];
if (factMeta.length !== factHeadings) {
  errors.push(`.pi/memory/FACTS.md: every fact needs immediate Verified/TTL, Type/Priority, and Source metadata (${factMeta.length}/${factHeadings})`);
}
const factSectionHeadings = [...facts.matchAll(/^## (F-\d+) \| [^\r\n]+$/gm)];
for (const [index, heading] of factSectionHeadings.entries()) {
  const start = heading.index ?? 0;
  const end = index + 1 < factSectionHeadings.length ? (factSectionHeadings[index + 1].index ?? facts.length) : facts.length;
  const sourceCount = (facts.slice(start, end).match(/^> Source: .+$/gm) ?? []).length;
  if (sourceCount !== 1) errors.push(`.pi/memory/FACTS.md: ${heading[1]} needs exactly one Source (${sourceCount})`);
}
const factIds = factMeta.map((match) => match[1]);
const factIdSet = new Set(factIds);
if (factIdSet.size !== factIds.length) errors.push('.pi/memory/FACTS.md: duplicate Fact ID');
const replacedIds = new Set(factMeta.flatMap((match) => match[6] ? [match[6]] : []));
const replaceCounts = new Map();
const replaceTargets = new Map();
for (const match of factMeta) {
  const id = match[1];
  const verified = match[2];
  const ttl = Number(match[3]);
  const replaces = match[6];
  const ageDays = calendarAgeDays(verified, today);
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    errors.push(`.pi/memory/FACTS.md: ${id} has invalid or future Verified date ${verified}`);
  }
  if (replaces) {
    if (!factIdSet.has(replaces)) errors.push(`.pi/memory/FACTS.md: ${id} replaces missing ${replaces}`);
    if (replaces === id) errors.push(`.pi/memory/FACTS.md: ${id} cannot replace itself`);
    replaceCounts.set(replaces, (replaceCounts.get(replaces) ?? 0) + 1);
    replaceTargets.set(id, replaces);
  }
  if (Number.isFinite(ageDays) && ageDays >= 0 && !replacedIds.has(id) && isMemoryDateExpired(verified, ttl, today)) {
    errors.push(`.pi/memory/FACTS.md: active ${id} verified ${verified} exceeded TTL ${ttl}d`);
  }
}
for (const [id, count] of replaceCounts) {
  if (count > 1) errors.push(`.pi/memory/FACTS.md: ${id} is replaced by ${count} facts`);
}
for (const id of factIds) {
  const seen = new Set();
  let cursor = id;
  while (replaceTargets.has(cursor)) {
    if (seen.has(cursor)) {
      errors.push(`.pi/memory/FACTS.md: Replaces cycle involving ${cursor}`);
      break;
    }
    seen.add(cursor);
    cursor = replaceTargets.get(cursor);
  }
}

const findings = loaded.get(path.join(root, 'findings.md')) ?? '';
const findingCount = findings.match(/^## F-/gm)?.length ?? 0;
if (findingCount > 20) errors.push(`findings.md: ${findingCount} entries > 20`);

const progress = loaded.get(path.join(root, 'progress.md')) ?? '';
const milestones = progress.match(/^- \[\d{4}-\d{2}-\d{2}\]/gm)?.length ?? 0;
if (milestones > 8) errors.push(`progress.md: ${milestones} milestones > 8`);

const inboxFile = path.join(root, '.pi/memory/INBOX.jsonl');
const inbox = fs.existsSync(inboxFile) ? fs.readFileSync(inboxFile, 'utf8') : '';
const inboxLines = inbox.split(/\r?\n/).filter(Boolean);
if (inboxLines.length > 100) errors.push(`.pi/memory/INBOX.jsonl: ${inboxLines.length} observations > 100`);
for (const [index, line] of inboxLines.entries()) {
  try {
    const item = JSON.parse(line);
    if (!/^\d{4}-\d{2}-\d{2} /.test(item.ts ?? '') || !['tool_failure', 'config_change'].includes(item.category) || typeof item.summary !== 'string') {
      errors.push(`.pi/memory/INBOX.jsonl: invalid observation at line ${index + 1}`);
    }
  } catch {
    errors.push(`.pi/memory/INBOX.jsonl: invalid JSON at line ${index + 1}`);
  }
}

function listTextFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTextFiles(abs, pattern));
    else if (entry.isFile() && pattern.test(entry.name)) out.push(abs);
  }
  return out;
}

const scanFiles = new Map(loaded);
if (inbox) scanFiles.set(inboxFile, inbox);
const activeMemoryFiles = listTextFiles(path.join(root, '.pi', 'memory'), /\.(?:md|json|jsonl|log|txt|ya?ml|toml)$/i);
const activeMemorySet = new Set(activeMemoryFiles.map((file) => path.resolve(file)));
for (const file of activeMemoryFiles) {
  scanFiles.set(file, fs.readFileSync(file, 'utf8'));
}
for (const file of listTextFiles(path.join(root, 'archive'), /\.(?:md|json|jsonl|log|txt|ya?ml|toml)$/i)) {
  scanFiles.set(file, fs.readFileSync(file, 'utf8'));
}
for (const [file, text] of scanFiles) {
  const risk = findMemorySecretRisk(text);
  if (risk) errors.push(`${path.relative(root, file)}: forbidden ${risk} pattern`);
  const controlRisk = activeMemorySet.has(path.resolve(file)) ? findMemoryControlRisk(text) : null;
  if (controlRisk) errors.push(`${path.relative(root, file)}: forbidden ${controlRisk} pattern`);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs));
    else files.push(abs);
  }
  return files;
}

const rootFiles = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(root, entry.name));
for (const file of [...walk(path.join(root, '.pi', 'memory')), ...rootFiles]) {
  if (/\.tmp(?:-|$)/i.test(path.basename(file))) errors.push(`${path.relative(root, file)}: leftover temp file`);
}

const archiveDir = path.join(root, 'archive');
const archiveFiles = walk(archiveDir);
for (const file of archiveFiles) {
  const relativeParts = path.relative(archiveDir, file).split(path.sep);
  if (relativeParts.some((part) => part.startsWith('.tmp-'))) {
    errors.push(`${path.relative(root, file)}: incomplete archive temp artifact`);
  }
}
const archiveBytes = archiveFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
const tasksDir = path.join(archiveDir, 'tasks');
const taskBundles = fs.existsSync(tasksDir)
  ? fs.readdirSync(tasksDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.tmp-')).length
  : 0;
if (archiveBytes > 1024 * 1024) errors.push(`archive/: ${archiveBytes}B > 1MiB`);
if (taskBundles > 50) errors.push(`archive/tasks: ${taskBundles} bundles > 50`);

const gitignorePath = path.join(root, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const ignore = fs.readFileSync(gitignorePath, 'utf8');
  for (const rule of ['.pi/memory/', 'archive/', '/STATUS.md', '/KEYSTORE.md', 'session-exports/']) {
    if (!ignore.split(/\r?\n/).includes(rule)) errors.push(`.gitignore: missing ${rule}`);
  }
}

if (taskBundles >= 45 || archiveBytes >= 900 * 1024) {
  warnings.push(`archive nearing cap: ${taskBundles}/50 bundles, ${archiveBytes}/${1024 * 1024}B`);
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`Memory check failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`Memory check passed: ${specs.length} project files, ${findingCount} findings, ${milestones} milestones, ${taskBundles} archive bundles, ${archiveBytes} archive bytes.`);
