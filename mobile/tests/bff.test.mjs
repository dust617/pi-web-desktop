// MobileBridge BFF regression tests (self-contained, repeatable).
//   node mobile/tests/bff.test.mjs
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { MobileBridge } = require("../../dist/mobile-bridge.js");

const ORIGIN_OK = "https://pi.example.test:8443";
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
let lastHistorySearch = "";
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const p = u.pathname;
  const parts = p.split("/").filter(Boolean);
  if (req.method === "GET" && p === "/api/agent/s1/events") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "Cross-session request", message: "Continue with session 550e8400-e29b-41d4-a716-446655440000?" })}\n\n`);
    const hugeSnapshot = "duplicate-snapshot-".repeat(4000);
    res.write(`data: ${JSON.stringify({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: hugeSnapshot }] }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Z", partial: { role: "assistant", content: [{ type: "text", text: hugeSnapshot }] } } })}\n\n`);
    setTimeout(() => res.end(), 100);
    return;
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "agent") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { lastAgentBody = b; json(res, {}); }); return;
  }
  if (p === "/api/home") return json(res, { ok: true });
  if (p === "/api/sessions") return json(res, { sessions: [{ id: "s1", cwd: "/p/a", name: "sess1", modified: "2026-07-22T10:00:00Z", messageCount: 3, preview: "hi" }], runningSessionIds: [] });
  if (p === "/api/models") return json(res, { modelList: [{ id: "m1", name: "Model 1", provider: "prov" }], defaultModel: null, thinkingLevels: {} });
  if (parts[0] === "api" && parts[1] === "sessions" && parts.length === 3) {
    lastHistorySearch = u.search;
    if (parts[2] === "big") { const pad = "x".repeat(9 * 1024 * 1024); return json(res, { sessionId: "big", context: { messages: [{ role: "user", content: pad }] }, info: { messageCount: 1 } }); }
    const messages = Array.from({ length: 125 }, (_, i) => ({ role: "user", content: `history-${i}` }));
    messages.push({ role: "user", content: [{ type: "image", data: "USER_OWN_IMAGE_BASE64", mimeType: "image/png" }, { type: "text", text: "my upload" }] });
    messages.push({ role: "system", content: "system-body-".repeat(300) });
    messages.push({ role: "custom", customType: "project-memory-brief", display: false, content: "HIDDEN_CROSS_SESSION_BRIEF" });
    messages.push({ role: "toolResult", toolName: "read", content: "tool-body-".repeat(300) });
    messages.push({ role: "assistant", content: [
      { type: "thinking", thinking: "reason-".repeat(100), signature: "SECRET_SIGNATURE" },
      { type: "image", data: "SECRET_BASE64".repeat(100), mimeType: "image/png" },
      { type: "text", text: "final answer" },
    ] });
    return json(res, { sessionId: parts[2], context: { messages, model: { provider: "prov", id: "m1" }, thinkingLevel: "off" }, info: { messageCount: messages.length } });
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
      const done = () => { r.destroy(); resolve({ status: res.statusCode, ct, connected: buf.includes("connected"), raw: buf }); };
      res.on("data", (c) => { buf += c.toString(); if (buf.includes("text_delta")) done(); });
      setTimeout(done, 3000);
    });
    r.on("error", (e) => resolve({ status: 0, ct: "", connected: false, raw: e.message }));
    r.end();
  });
}

async function main() {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockPort = mock.address().port;
  const storePath = path.join(os.tmpdir(), `pi-mobile-bff-test-${process.pid}.json`);
  try { fs.unlinkSync(storePath); } catch {}
  const fakeRuntime = { get info() { return { port: mockPort, url: `http://127.0.0.1:${mockPort}`, pid: -1 }; }, get isRunning() { return true; } };
  const bridge = new MobileBridge({ runtime: fakeRuntime, port: BFF_PORT, allowedOrigins: [ORIGIN_OK], sessionStorePath: storePath });
  await bridge.start();
  const code = bridge.pairingCode;
  const P = BFF_PORT;
  console.log("mock upstream on " + mockPort + " | BFF on " + P + " | code " + code);

  let r = await req(P, "GET", "/mobile/api/v1/projects");
  check("T1 unauth GET /projects -> 401", r.status === 401);

  r = await req(P, "GET", "/mobile/api/v1/projects", { headers: { Cookie: "mb_session=%ZZ" } });
  check("T1 malformed cookie -> 401, never public 500", r.status === 401, "got " + r.status + " " + r.text().slice(0, 100));

  r = await req(P, "GET", "/mobile/auth/pairing-code");
  check("T2 GET /auth/pairing-code -> 404 (P0-1)", r.status === 404);

  r = await req(P, "POST", "/mobile/auth/login", { body: { code: "000000" } });
  check("T3 login missing Origin -> 403", r.status === 403);
  r = await req(P, "POST", "/mobile/auth/login", { headers: { Origin: ORIGIN_BAD }, body: { code: "000000" } });
  check("T3 login bad Origin -> 403", r.status === 403);
  r = await req(P, "POST", "/mobile/auth/login", { headers: { Origin: ORIGIN_OK }, body: { code: "000000" } });
  check("T3 login wrong code -> 401", r.status === 401);

  r = await req(P, "POST", "/mobile/auth/login", { headers: { Origin: ORIGIN_OK }, body: { code } });
  const sc = rawCookie(r.headers["set-cookie"]);
  check("T4 login ok -> 200", r.status === 200);
  check("T4 cookie HttpOnly+SameSite=Strict", /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), sc);
  check("T4 cookie NOT Secure on plain http", !/Secure/i.test(sc), sc);
  const cookie = jar(r.headers["set-cookie"]);

  r = await req(P, "POST", "/mobile/auth/login", { headers: { Origin: ORIGIN_OK, "x-forwarded-proto": "https" }, body: { code } });
  const persistedCookie = jar(r.headers["set-cookie"]);
  check("T5 cookie Secure when x-forwarded-proto=https (P2-1)", /Secure/i.test(rawCookie(r.headers["set-cookie"])), rawCookie(r.headers["set-cookie"]));

  let saw429 = false;
  for (let i = 0; i < 10; i++) { const rr = await req(P, "POST", "/mobile/auth/login", { headers: { Origin: ORIGIN_OK }, body: { code: "000000" } }); if (rr.status === 429) { saw429 = true; break; } }
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
  const history = r.json();
  const historyText = r.text();
  check("T10 history -> capped recent 120 messages", r.status === 200 && history?.messages?.length === 120 && history.truncated === true);
  check("T10 history requests deferred thinking + media", lastHistorySearch.includes("deferThinking=1") && lastHistorySearch.includes("deferMedia=1"), lastHistorySearch);
  check("T10 hidden signatures/base64 never reach mobile", !historyText.includes("SECRET_SIGNATURE") && !historyText.includes("SECRET_BASE64"));
  check("T10 user-uploaded image stays visible", historyText.includes("USER_OWN_IMAGE_BASE64"), "user image must be preserved for echo");
  check("T10 display:false custom messages never reach mobile", !historyText.includes("HIDDEN_CROSS_SESSION_BRIEF"));
  check("T10 outer toolResult body is capped", history.messages.at(-2)?.role === "toolResult" && history.messages.at(-2)?.content?.length < 1000);
  check("T10 non-rendered system body is minimized", history.messages.find((message) => message.role === "system")?.content?.length < 600);

  r = await req(P, "GET", "/mobile/api/v1/sessions/big/history", { headers: { Cookie: cookie } });
  check("T11 history >8MiB -> 413", r.status === 413, "got " + r.status);

  lastAgentBody = null;
  const crossSessionPrompt = "请检查会话 550e8400-e29b-41d4-a716-446655440000 并回答问题";
  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { message: crossSessionPrompt } });
  check("T12 full Session ID message good origin -> 200", r.status === 200, r.text().slice(0, 120));
  check("T12 upstream received full Session ID prompt unchanged", JSON.parse(lastAgentBody ?? "null")?.message === crossSessionPrompt);

  lastAgentBody = null;
  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/ui-response", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { id: "ui-1", confirmed: true } });
  check("T12b extension UI response -> 200", r.status === 200, r.text().slice(0, 120));
  check("T12b upstream receives only allowlisted UI response", JSON.parse(lastAgentBody ?? "null")?.type === "extension_ui_response" && JSON.parse(lastAgentBody)?.id === "ui-1" && JSON.parse(lastAgentBody)?.confirmed === true);
  const cjkEditorValue = "界".repeat(8_000);
  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/ui-response", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { id: "ui-editor", value: cjkEditorValue } });
  check("T12b max-length non-ASCII editor response fits byte limit", r.status === 200 && JSON.parse(lastAgentBody)?.value === cjkEditorValue, "got " + r.status);
  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/ui-response", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { id: "ui-1", arbitrary: "command" } });
  check("T12b invalid UI response is rejected", r.status === 400, "got " + r.status);

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie, Origin: ORIGIN_BAD }, body: { message: "x" } });
  check("T13 message bad origin -> 403", r.status === 403);

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie }, body: { message: "x" } });
  check("T14 message missing origin -> 403", r.status === 403);

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { message: "y".repeat(70000) } });
  check("T15 message >64KB -> 413 (P1-2)", r.status === 413, "got " + r.status);

  lastAgentBody = null;
  const smallImage = Buffer.from("mobile-image-test").toString("base64");
  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", {
    headers: { Cookie: cookie, Origin: ORIGIN_OK },
    body: { message: "", images: [{ type: "image", data: smallImage, mimeType: "image/png" }] },
  });
  check("T15b valid image-only message -> 200", r.status === 200, "got " + r.status);
  const imagePrompt = JSON.parse(lastAgentBody ?? "null");
  check("T15b forwards only validated image DTO", imagePrompt?.images?.[0]?.data === smallImage && imagePrompt.images[0].mimeType === "image/png");
  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/messages", {
    headers: { Cookie: cookie, Origin: ORIGIN_OK },
    body: { message: "x", images: [{ type: "image", data: "not-base64?", mimeType: "image/png" }] },
  });
  check("T15b rejects malformed image attachment", r.status === 400, "got " + r.status);

  r = await req(P, "POST", "/mobile/api/v1/sessions/s1/model", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: { provider: "prov", modelId: "m1" } });
  check("T16 set model -> 2xx", r.status >= 200 && r.status < 300, "got " + r.status + " " + r.text().slice(0, 80));

  const sse = await sseConnected(P, cookie);
  check("T17 SSE 200 + event-stream", sse.status === 200 && /event-stream/.test(sse.ct), JSON.stringify(sse).slice(0, 120));
  check("T17 SSE emits connected event", sse.connected, sse.raw || "");
  check("T17 SSE forwards compact text delta", sse.raw.includes('"type":"text_delta"') && sse.raw.includes('"delta":"Z"'), sse.raw.slice(0, 300));
  check("T17 SSE forwards bounded extension UI request", sse.raw.includes('"type":"extension_ui_request"') && sse.raw.includes('"id":"ui-1"') && sse.raw.includes('"method":"confirm"'), sse.raw.slice(0, 500));
  check("T17 SSE strips cumulative snapshot/partial", !sse.raw.includes("duplicate-snapshot") && !sse.raw.includes('"partial"') && sse.raw.length < 2000, `bytes=${sse.raw.length}`);

  r = await req(P, "POST", "/mobile/auth/revoke-all", { headers: { Cookie: cookie, Origin: ORIGIN_OK }, body: {} });
  check("T17 revoke-all has no HTTP route or pairing-code response", r.status === 404 && !r.text().includes("newCode"), "got " + r.status + " " + r.text().slice(0, 100));

  r = await req(P, "POST", "/mobile/auth/logout", { headers: { Cookie: cookie, Origin: ORIGIN_OK } });
  check("T18 logout -> 200", r.status === 200);
  r = await req(P, "GET", "/mobile/api/v1/projects", { headers: { Cookie: cookie } });
  check("T18 after logout -> 401", r.status === 401);

  await bridge.stop();
  const storeText = fs.readFileSync(storePath, "utf8");
  check("T19 session store never persists raw bearer token", !storeText.includes(persistedCookie.split("=")[1]) && storeText.includes("tokenHash"));
  const restartPort = BFF_PORT + 1;
  const bridge2 = new MobileBridge({ runtime: fakeRuntime, port: restartPort, allowedOrigins: [ORIGIN_OK], sessionStorePath: storePath });
  await bridge2.start();
  r = await req(restartPort, "GET", "/mobile/api/v1/projects", { headers: { Cookie: persistedCookie } });
  check("T19 hashed session store survives BFF restart", r.status === 200, "got " + r.status);
  await bridge2.stop();
  try { fs.unlinkSync(storePath); } catch {}

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (failures.length) console.log("failures: " + failures.join(", "));
  mock.close();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
