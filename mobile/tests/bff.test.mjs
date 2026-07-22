// MobileBridge BFF regression tests (self-contained, repeatable).
//   node mobile/tests/bff.test.mjs
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { MobileBridge } = require("../../dist/mobile-bridge.js");

const ORIGIN_OK = "https://mobile.tt56677.top";
const ORIGIN_BAD = "https://evil.example.com";
const BFF_PORT = 62899;

let pass = 0, fail = 0; const failures = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}
function json(res, obj, status = 200) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(b) });
  res.end(b);
}

let lastAgentBody = null;
function upstreamState(running = true, flags = {}) {
  return {
    running,
    state: {
      model: { provider: "prov", id: "m1" },
      systemPrompt: "SECRET_PROMPT_XYZ",
      sessionFile: "/secret/path.json",
      queuedMessages: ["q"],
      extensionStatuses: {},
      contextUsage: { percent: 42 },
      messageCount: 3,
      isPromptRunning: false,
      isStreaming: false,
      isCompacting: false,
      ...flags,
    },
  };
}
let mockState = upstreamState();
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const p = u.pathname;
  const parts = p.split("/").filter(Boolean);
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "agent") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { lastAgentBody = b; json(res, {}); }); return;
  }
  if (p === "/api/home") return json(res, { ok: true });
  if (p === "/api/sessions") return json(res, { sessions: [{ id: "s1", cwd: "/p/a", name: "sess1", modified: "2026-07-22T10:00:00Z", messageCount: 3, preview: "hi" }], runningSessionIds: [] });
  if (p === "/api/models") return json(res, { modelList: [{ id: "m1", name: "Model 1", provider: "prov" }], defaultModel: null, thinkingLevels: {} });
  if (parts[0] === "api" && parts[1] === "sessions" && parts.length === 3) {
    if (parts[2] === "big") { const pad = "x".repeat(9 * 1024 * 1024); return json(res, { sessionId: "big", context: { messages: [{ role: "user", content: pad }] }, info: { messageCount: 1 } }); }
    return json(res, { sessionId: parts[2], context: { messages: [{ role: "user", content: "hello" }], model: { provider: "prov", id: "m1" }, thinkingLevel: "off" }, info: { messageCount: 1 } });
  }
  if (parts[0] === "api" && parts[1] === "sessions" && parts[3] === "state") {
    return json(res, mockState);
  }
  res.writeHead(404); res.end("mock 404 " + p);
});

function req(port, method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const h = { ...headers };
    if (data != null && !h["content-type"]) h["content-type"] = "application/json";
    if (data != null) h["content-length"] = Buffer.byteLength(data);
    const r = http.request({ host: "127.0.0.1", port, method, path, headers: h }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf,
          text() { return buf.toString("utf8"); },
          json() { try { return JSON.parse(buf.toString("utf8")); } catch { return null; } } }); });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
function rawCookie(sc) { const a = Array.isArray(sc) ? sc : (sc ? [sc] : []); return a.find((c) => c.startsWith("mb_session=")) || ""; }
function jar(sc) { return rawCookie(sc).split(";")[0]; }

function sseConnected(port, cookie) {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, method: "GET", path: "/mobile/api/v1/sessions/s1/events", headers: { Cookie: cookie, Accept: "text/event-stream" } }, (res) => {
      let buf = ""; const ct = res.headers["content-type"] || "";
      res.on("data", (c) => { buf += c.toString(); if (buf.includes("connected")) { r.destroy(); resolve({ status: res.statusCode, ct, connected: true }); } });
      setTimeout(() => { r.destroy(); resolve({ status: res.statusCode, ct, connected: buf.includes("connected"), raw: buf.slice(0, 80) }); }, 3000);
    });
    r.on("error", (e) => resolve({ status: 0, ct: "", connected: false, raw: e.message }));
    r.end();
  });
}

async function main() {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockPort = mock.address().port;
  const fakeRuntime = { get info() { return { port: mockPort, url: `http://127.0.0.1:${mockPort}`, pid: -1 }; }, get isRunning() { return true; } };
  const bridge = new MobileBridge({ runtime: fakeRuntime, port: BFF_PORT, allowedOrigins: [ORIGIN_OK] });
  await bridge.start();
  const code = bridge.pairingCode;
  const P = BFF_PORT;
  console.log("mock upstream on " + mockPort + " | BFF on " + P + " | code " + code);

  let r = await req(P, "GET", "/mobile/api/v1/projects");
  check("T1 unauth GET /projects -> 401", r.status === 401);

  r = await req(P, "GET", "/mobile/auth/pairing-code");
  check("T2 GET /auth/pairing-code -> 404 (P0-1)", r.status === 404);

  r = await req(P, "POST", "/mobile/auth/login", { body: { code: "000000" } });
  check("T3 login wrong code -> 401", r.status === 401);

  r = await req(P, "POST", "/mobile/auth/login", { body: { code } });
  const sc = rawCookie(r.headers["set-cookie"]);
  check("T4 login ok -> 200", r.status === 200);
  check("T4 cookie HttpOnly+SameSite=Strict", /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), sc);
  check("T4 cookie NOT Secure on plain http", !/Secure/i.test(sc), sc);
  const cookie = jar(r.headers["set-cookie"]);

  r = await req(P, "POST", "/mobile/auth/login", { headers: { "x-forwarded-proto": "https" }, body: { code } });
  check("T5 cookie Secure when x-forwarded-proto=https (P2-1)", /Secure/i.test(rawCookie(r.headers["set-cookie"])), rawCookie(r.headers["set-cookie"]));

  let saw429 = false;
  for (let i = 0; i < 10; i++) { const rr = await req(P, "POST", "/mobile/auth/login", { body: { code: "000000" } }); if (rr.status === 429) { saw429 = true; break; } }
  check("T6 rate limit triggers 429", saw429);

  r = await req(P, "GET", "/mobile/api/v1/projects", { headers: { Cookie: cookie } });
  const pj = r.json();
  check("T7 authed GET /projects -> grouped", r.status === 200 && pj && Array.isArray(pj.projects) && pj.projects.length === 1 && pj.projects[0].projectId === "/p/a", r.text().slice(0, 120));

  r = await req(P, "GET", "/mobile/api/v1/projects/" + encodeURIComponent("/p/a") + "/sessions", { headers: { Cookie: cookie } });
  check("T8 project sessions -> 200", r.status === 200 && r.json().sessions.length === 1);

  r = await req(P, "GET", "/mobile/api/v1/sessions/s1/state", { headers: { Cookie: cookie } });
  const stxt = r.text();
  check("T9 state -> 200", r.status === 200);
  check("T9 alive but idle -> running false", r.json()?.running === false, stxt.slice(0, 160));
  check("T9 idle state keeps safe model/context fields", r.json()?.model?.id === "m1" && r.json()?.contextUsage?.percent === 42, stxt.slice(0, 160));
  check("T9 state hides systemPrompt/sessionFile", !stxt.includes("SECRET_PROMPT_XYZ") && !stxt.includes("/secret/path.json"), stxt.slice(0, 120));

  mockState = upstreamState(true, { isPromptRunning: true });
  r = await req(P, "GET", "/mobile/api/v1/sessions/s1/state", { headers: { Cookie: cookie } });
  check("T9 prompt running -> running true", r.json()?.running === true, r.text().slice(0, 160));
  mockState = upstreamState(true, { isStreaming: true });
  r = await req(P, "GET", "/mobile/api/v1/sessions/s1/state", { headers: { Cookie: cookie } });
  check("T9 streaming -> running true", r.json()?.running === true, r.text().slice(0, 160));
  mockState = upstreamState(true, { isCompacting: true });
  r = await req(P, "GET", "/mobile/api/v1/sessions/s1/state", { headers: { Cookie: cookie } });
  check("T9 compacting -> running true", r.json()?.running === true, r.text().slice(0, 160));
  mockState = upstreamState(false, { isStreaming: true });
  r = await req(P, "GET", "/mobile/api/v1/sessions/s1/state", { headers: { Cookie: cookie } });
  check("T9 agent not alive -> running false", r.json()?.running === false, r.text().slice(0, 160));
  mockState = upstreamState();

  r = await req(P, "GET", "/mobile/api/v1/sessions/s1/history", { headers: { Cookie: cookie } });
  check("T10 history -> 200 + messages", r.status === 200 && Array.isArray(r.json().messages));

  r = await req(P, "GET", "/mobile/api/v1/sessions/big/history", { headers: { Cookie: cookie } });
  check("T11 history >8MiB -> 413", r.status === 413, "got " + r.status);

  lastAgentBody = null;
  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { message: "hi there" } });
  check("T12 message good origin -> 200", r.status === 200, r.text().slice(0, 120));
  check("T12 upstream received prompt", !!lastAgentBody && lastAgentBody.includes("hi there"));

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie, Origin: ORIGIN_BAD }, body: { message: "x" } });
  check("T13 message bad origin -> 403", r.status === 403);

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie }, body: { message: "x" } });
  check("T14 message missing origin -> 403", r.status === 403);

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { message: "y".repeat(70000) } });
  check("T15 message >64KB -> 413 (P1-2)", r.status === 413, "got " + r.status);

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/model", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { provider: "prov", modelId: "m1" } });
  check("T16 set model -> 2xx", r.status >= 200 && r.status < 300, "got " + r.status + " " + r.text().slice(0, 80));

  const sse = await sseConnected(P, cookie);
  check("T17 SSE 200 + event-stream", sse.status === 200 && /event-stream/.test(sse.ct), JSON.stringify(sse).slice(0, 120));
  check("T17 SSE emits connected event", sse.connected, sse.raw || "");

  r = await req(P, "POST", "/mobile/auth/logout", { headers: { Cookie: cookie, Origin: ORIGIN_OK } });
  check("T18 logout -> 200", r.status === 200);
  r = await req(P, "GET", "/mobile/api/v1/projects", { headers: { Cookie: cookie } });
  check("T18 after logout -> 401", r.status === 401);

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (failures.length) console.log("failures: " + failures.join(", "));
  await bridge.stop(); mock.close();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
