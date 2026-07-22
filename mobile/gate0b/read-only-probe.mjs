/**
 * read-only-probe.mjs — 只读 GET/HEAD 探针
 * 严格拒绝任何非 GET/HEAD 请求；不连接 SSE；不修改任何状态。
 * 用法：node read-only-probe.mjs [pi-web-port]
 * 默认端口：62809
 */
import http from 'http';

const PORT = parseInt(process.argv[2] ?? '62809', 10);
const BASE = `http://127.0.0.1:${PORT}`;

// ── 安全守卫：只允许 GET/HEAD ────────────────────────────────────────
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

function safeRequest(path, method = 'GET') {
  if (!ALLOWED_METHODS.has(method.toUpperCase())) {
    throw new Error(`BLOCKED: method ${method} not allowed (only GET/HEAD)`);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${path}`, { method, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, size: Buffer.byteLength(body), body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── 探针 ─────────────────────────────────────────────────────────────
async function probe() {
  console.log(`Probing pi-web at ${BASE} (read-only, GET/HEAD only)\n`);

  // 1. Health check
  try {
    const r = await safeRequest('/api/home');
    console.log(`GET /api/home → ${r.status} ${r.size}B`);
  } catch (e) {
    console.error(`GET /api/home → ERROR: ${e.message}`);
    console.error('pi-web not reachable; aborting.');
    process.exit(1);
  }

  // 2. Sessions list
  try {
    const r = await safeRequest('/api/sessions');
    const d = JSON.parse(r.body);
    console.log(`GET /api/sessions → ${r.status} ${r.size}B, sessions=${d.sessions?.length}, running=${d.runningSessionIds?.length}`);
  } catch (e) {
    console.error(`GET /api/sessions → ERROR: ${e.message}`);
  }

  // 3. Models
  try {
    const r = await safeRequest('/api/models?cwd=D:/PI-web-desktop');
    const d = JSON.parse(r.body);
    console.log(`GET /api/models → ${r.status} ${r.size}B, models=${d.modelList?.length}`);
  } catch (e) {
    console.error(`GET /api/models → ERROR: ${e.message}`);
  }

  // 4. Session detail (first session only, read-only)
  try {
    const listRaw = await safeRequest('/api/sessions');
    const list = JSON.parse(listRaw.body);
    const first = list.sessions?.[0];
    if (first) {
      const r = await safeRequest(`/api/sessions/${first.id}?deferThinking=1&deferMedia=1`);
      const d = JSON.parse(r.body);
      console.log(`GET /api/sessions/${first.id.slice(0,12)}... → ${r.status} ${r.size}B, msgs=${d.context?.messages?.length}`);
    }
  } catch (e) {
    console.error(`GET /api/sessions/{id} → ERROR: ${e.message}`);
  }

  // 5. Session state (first session only, read-only)
  try {
    const listRaw = await safeRequest('/api/sessions');
    const list = JSON.parse(listRaw.body);
    const first = list.sessions?.[0];
    if (first) {
      const r = await safeRequest(`/api/sessions/${first.id}/state`);
      const d = JSON.parse(r.body);
      console.log(`GET /api/sessions/${first.id.slice(0,12)}.../state → ${r.status} running=${d.running}`);
    }
  } catch (e) {
    console.error(`GET /api/sessions/{id}/state → ERROR: ${e.message}`);
  }

  console.log('\nProbe complete. No mutations performed.');
}

probe().catch(e => { console.error(e); process.exit(1); });
