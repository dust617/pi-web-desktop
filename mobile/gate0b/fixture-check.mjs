/**
 * fixture-check.mjs — 离线验证 Gate 0B 合成 fixture 的结构
 * 不调用任何外部服务或模型；仅读取本地 JSON 文件并验证字段。
 * 用法：node fixture-check.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function loadJSON(file) {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── sessions-list.json ──────────────────────────────────────────────
console.log('sessions-list.json');
const sessionsList = loadJSON('sessions-list.json');

check('has sessions array', () => assert(Array.isArray(sessionsList.sessions), 'sessions not array'));
check('has runningSessionIds array', () => assert(Array.isArray(sessionsList.runningSessionIds), 'runningSessionIds not array'));
check('session has required fields', () => {
  const s = sessionsList.sessions[0];
  for (const f of ['id', 'cwd', 'created', 'modified', 'messageCount', 'firstMessage', 'projectRoot']) {
    assert(f in s, `missing field: ${f}`);
  }
});
check('runningSessionIds references valid session', () => {
  const ids = new Set(sessionsList.sessions.map(s => s.id));
  for (const rid of sessionsList.runningSessionIds) {
    assert(ids.has(rid), `running id not in sessions: ${rid}`);
  }
});

// ── session-detail.json ─────────────────────────────────────────────
console.log('session-detail.json');
const detail = loadJSON('session-detail.json');

check('has sessionId', () => assert(typeof detail.sessionId === 'string', 'sessionId not string'));
check('has info object', () => assert(typeof detail.info === 'object', 'info not object'));
check('info has required fields', () => {
  for (const f of ['id', 'cwd', 'created', 'modified', 'messageCount']) {
    assert(f in detail.info, `info missing: ${f}`);
  }
});
check('has context.messages array', () => assert(Array.isArray(detail.context?.messages), 'context.messages not array'));
check('messages have role and content', () => {
  for (const m of detail.context.messages) {
    assert('role' in m, 'message missing role');
    assert('content' in m, 'message missing content');
  }
});
check('context has model', () => assert(detail.context?.model?.provider && detail.context?.model?.modelId, 'context.model incomplete'));
check('context has thinkingLevel', () => assert(typeof detail.context?.thinkingLevel === 'string', 'thinkingLevel not string'));

// ── state-running.json ──────────────────────────────────────────────
console.log('state-running.json');
const stateRunning = loadJSON('state-running.json');

check('running is true', () => assert(stateRunning.running === true, 'running not true'));
check('state has model', () => assert(stateRunning.state?.model?.id && stateRunning.state?.model?.provider, 'state.model incomplete'));
check('state has contextUsage', () => assert(typeof stateRunning.state?.contextUsage?.percent === 'number', 'contextUsage.percent not number'));
check('state does NOT have systemPrompt', () => assert(!('systemPrompt' in (stateRunning.state ?? {})), 'systemPrompt should be stripped'));
check('state does NOT have sessionFile', () => assert(!('sessionFile' in (stateRunning.state ?? {})), 'sessionFile should be stripped'));

// ── state-idle.json ─────────────────────────────────────────────────
console.log('state-idle.json');
const stateIdle = loadJSON('state-idle.json');
check('running is false', () => assert(stateIdle.running === false, 'running not false'));

// ── models.json ─────────────────────────────────────────────────────
console.log('models.json');
const models = loadJSON('models.json');

check('has modelList array', () => assert(Array.isArray(models.modelList), 'modelList not array'));
check('modelList items have id/name/provider', () => {
  for (const m of models.modelList) {
    assert(m.id && m.name && m.provider, `model incomplete: ${JSON.stringify(m)}`);
  }
});
check('has defaultModel', () => assert(models.defaultModel?.provider && models.defaultModel?.modelId, 'defaultModel incomplete'));
check('has thinkingLevels map', () => assert(typeof models.thinkingLevels === 'object', 'thinkingLevels not object'));

// ── sse-stream.txt ──────────────────────────────────────────────────
console.log('sse-stream.txt');
const sseRaw = readFileSync(join(FIXTURES, 'sse-stream.txt'), 'utf8');
const sseEvents = sseRaw.split('\n\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(6)));

check('first event is connected', () => assert(sseEvents[0]?.type === 'connected', 'first event not connected'));
check('connected has sessionId', () => assert(typeof sseEvents[0]?.sessionId === 'string', 'connected missing sessionId'));
check('has agent_start event', () => assert(sseEvents.some(e => e.type === 'agent_start'), 'no agent_start'));
check('has agent_end event', () => assert(sseEvents.some(e => e.type === 'agent_end'), 'no agent_end'));
check('has message_update event', () => assert(sseEvents.some(e => e.type === 'message_update'), 'no message_update'));
check('has heartbeat comment', () => assert(sseRaw.includes(':\n\n'), 'no heartbeat comment'));

// ── Summary ─────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
