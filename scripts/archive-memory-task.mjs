import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-]{1,50}$/.test(slug)) {
  console.error('Usage: npm run memory:archive -- <lowercase-slug>');
  process.exit(2);
}

const check = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-memory.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (check.status !== 0) process.exit(check.status ?? 1);

const sources = ['task_plan.md', 'findings.md', 'progress.md'];
const plan = fs.readFileSync(path.join(root, 'task_plan.md'), 'utf8');
if (/无活动复杂任务/.test(plan)) {
  console.error('No active complex task to archive.');
  process.exit(2);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

const archiveRoot = path.join(root, 'archive');
const tasksRoot = path.join(archiveRoot, 'tasks');
fs.mkdirSync(tasksRoot, { recursive: true });
const existingBundles = fs.readdirSync(tasksRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.tmp-')).length;
const existingBytes = walk(archiveRoot).reduce((sum, file) => sum + fs.statSync(file).size, 0);
const sourceBytes = sources.reduce((sum, file) => sum + fs.statSync(path.join(root, file)).size, 0);
if (existingBundles >= 50 || existingBytes + sourceBytes > 1024 * 1024) {
  console.error('Archive cap would be exceeded. Move oldest bundles to external cold storage first.');
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const finalDir = path.join(tasksRoot, `${date}-${slug}`);
if (fs.existsSync(finalDir)) {
  console.error(`Archive already exists: ${path.relative(root, finalDir)}`);
  process.exit(1);
}
const tempDir = path.join(tasksRoot, `.tmp-${process.pid}-${Date.now()}`);
let archiveCommitted = false;
try {
  fs.mkdirSync(tempDir);
  const manifest = { archivedAt: new Date().toISOString(), slug, files: {} };
  for (const file of sources) {
    const src = path.join(root, file);
    const dst = path.join(tempDir, file);
    const data = fs.readFileSync(src);
    const fd = fs.openSync(dst, 'w');
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    manifest.files[file] = {
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    };
  }
  const manifestPath = path.join(tempDir, 'MANIFEST.json');
  const manifestFd = fs.openSync(manifestPath, 'w');
  try {
    fs.writeFileSync(manifestFd, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.fsyncSync(manifestFd);
  } finally {
    fs.closeSync(manifestFd);
  }
  fs.renameSync(tempDir, finalDir);
  archiveCommitted = true;
} catch (error) {
  if (!archiveCommitted && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  throw error;
}

function atomicWrite(relative, content) {
  const target = path.join(root, relative);
  const temp = `${target}.tmp-${process.pid}`;
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, target);
}

atomicWrite('task_plan.md', '# 当前任务\n\n> 无活动复杂任务。开始新任务时覆盖本文件；复杂任务完成后运行 `npm run memory:archive -- <slug>`。\n');
atomicWrite('findings.md', '# 当前任务发现\n\n> 无活动复杂任务。最多 20 条/12 KiB；完成后随任务整包归档。\n');
atomicWrite('progress.md', '# 当前任务进度\n\n> 无活动复杂任务。只保留最近 5 个里程碑；完成后随任务整包归档。\n');

const verify = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-memory.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (verify.status !== 0) process.exit(verify.status ?? 1);
console.log(`Archived task to ${path.relative(root, finalDir)}`);
