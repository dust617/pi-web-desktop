import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date();
today.setHours(0, 0, 0, 0);
const errors = [];
const warnings = [];

const specs = [
  ['AGENTS.md', 4096, 80, true],
  ['.pi/memory/STATUS.md', 2048, 32, true],
  ['.pi/memory/FACTS.md', 5120, 80, true],
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

for (const legacy of ['STATUS.md', 'KEYSTORE.md']) {
  if (fs.existsSync(path.join(root, legacy))) {
    errors.push(`${legacy}: legacy duplicate exists; use .pi/memory instead`);
  }
}

const status = loaded.get(path.join(root, '.pi/memory/STATUS.md')) ?? '';
const verifyBy = status.match(/^> Updated: \d{4}-\d{2}-\d{2} \| Verify-by: (\d{4}-\d{2}-\d{2})$/m);
if (!verifyBy) {
  errors.push('.pi/memory/STATUS.md: missing exact Updated/Verify-by metadata');
} else if (today > new Date(`${verifyBy[1]}T00:00:00`)) {
  errors.push(`.pi/memory/STATUS.md: expired Verify-by ${verifyBy[1]}`);
}
const nextActions = (status.match(/^- \[ \]/gm) ?? []).length;
if (nextActions > 6) errors.push(`.pi/memory/STATUS.md: ${nextActions} next actions > 6`);

const facts = loaded.get(path.join(root, '.pi/memory/FACTS.md')) ?? '';
const factHeadings = facts.match(/^## /gm)?.length ?? 0;
const factMeta = [...facts.matchAll(/^## [^\r\n]+\r?\n> Verified: (\d{4}-\d{2}-\d{2}) \| TTL: (\d+)d$/gm)];
if (factMeta.length !== factHeadings) {
  errors.push(`.pi/memory/FACTS.md: every section needs immediate Verified/TTL metadata (${factMeta.length}/${factHeadings})`);
}
for (const match of factMeta) {
  const verified = new Date(`${match[1]}T00:00:00`);
  const ageDays = Math.floor((today - verified) / 86400000);
  const ttl = Number(match[2]);
  if (ageDays > ttl) errors.push(`.pi/memory/FACTS.md: section verified ${match[1]} exceeded TTL ${ttl}d`);
}

const findings = loaded.get(path.join(root, 'findings.md')) ?? '';
const findingCount = findings.match(/^## F-/gm)?.length ?? 0;
if (findingCount > 20) errors.push(`findings.md: ${findingCount} entries > 20`);

const progress = loaded.get(path.join(root, 'progress.md')) ?? '';
const milestones = progress.match(/^- \[\d{4}-\d{2}-\d{2}\]/gm)?.length ?? 0;
if (milestones > 8) errors.push(`progress.md: ${milestones} milestones > 8`);

const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['API token', /\b(?:sk|ghp|github_pat)-[A-Za-z0-9._-]{16,}\b/i],
  ['VLESS URL', /\bvless:\/\//i],
  ['credential UUID', /(?:\buuid\b|\bvless\b)[^\r\n]{0,40}\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i],
  ['pairing code', /(?:pairing(?:[- ]?code)?|配对码)[^\r\n]{0,40}\b\d{6}\b/i],
  ['root/password literal', /\broot\/password\b/i],
  ['credential assignment', /(?:password|passwd|api[_ -]?key|secret|token|密码)\s*[:=]\s*["']?(?!\[?(?:redacted|removed)|见\b|see\b|待轮换\b|路径\b|location\b|file\b)[^\s,;|`"']{4,}/i],
  ['URL credentials', /https?:\/\/[^\s/@:]+:[^\s/@]+@/i],
];

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(abs));
    else if (entry.isFile() && /\.(?:md|json)$/i.test(entry.name)) out.push(abs);
  }
  return out;
}

const scanFiles = new Map(loaded);
for (const file of listMarkdown(path.join(root, 'archive'))) {
  scanFiles.set(file, fs.readFileSync(file, 'utf8'));
}
for (const [file, text] of scanFiles) {
  for (const [name, pattern] of secretPatterns) {
    if (pattern.test(text)) errors.push(`${path.relative(root, file)}: forbidden ${name} pattern`);
  }
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
