// Focused regression tests for PWA update lifecycle and mobile layout guards.
//   node mobile/tests/pwa-shell.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const swSource = fs.readFileSync(new URL("../../resources/mobile/sw.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../resources/mobile/index.html", import.meta.url), "utf8");
const listeners = new Map();

const context = vm.createContext({
  URL,
  console,
  caches: {
    open: async () => ({ addAll: async () => { throw new Error("simulated shell fetch failure"); } }),
    keys: async () => ["pi-mobile-v4"],
    delete: async () => true,
    match: async () => undefined,
  },
  fetch: async () => { throw new Error("offline"); },
  self: {
    addEventListener(type, handler) { listeners.set(type, handler); },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => [] },
  },
});
vm.runInContext(swSource, context, { filename: "resources/mobile/sw.js" });

let installPromise;
listeners.get("install")({ waitUntil(p) { installPromise = p; } });
await assert.rejects(installPromise, /simulated shell fetch failure/,
  "failed shell pre-cache must reject install so the prior worker/cache stays active");
console.log("  ok   failed shell pre-cache rejects service-worker installation");

const swVersion = swSource.match(/const VERSION = "([^"]+)"/)?.[1];
const htmlVersion = html.match(/const PWA_VERSION = "([^"]+)"/)?.[1];
assert.ok(swVersion && swVersion === htmlVersion, "SW and page version markers must match");
console.log("  ok   SW and page version markers match: " + swVersion);

assert.match(html, /register\("\/mobile\/sw\.js", \{ updateViaCache: "none" \}\)/,
  "SW registration must bypass HTTP cache");
assert.match(html, /const checkUpdate = \(\) => reg\.update\(\)\.catch\(\(\) => \{\}\);\s*checkUpdate\(\);/,
  "the app must check for an update immediately, not only after five minutes");
console.log("  ok   service-worker update check runs immediately with updateViaCache=none");

assert.match(swSource, /new AbortController\(\)/, "shell fetch needs an abortable network deadline");
assert.match(swSource, /setTimeout\(\(\) => controller\.abort\(\), 5000\)/,
  "shell fetch must fall back to cache within five seconds");
assert.match(swSource, /event\.request\.method !== "GET"/,
  "service worker must not intercept non-GET requests");
console.log("  ok   service-worker network-first path has a bounded GET-only fallback");

assert.match(html, /#inputArea \{ flex:0 0 auto; min-height:0; \}/,
  "composer must not shrink below its content in the body flex layout");
assert.match(html, /\.content \{ flex:1; min-height:0;/,
  "scroll area must be the flex item that shrinks");
assert.match(html, /--app-height/, "visual viewport height variable must exist");
assert.match(html, /visualViewport/, "visual viewport fallback must be wired");
assert.match(html, /maximum-scale=2\.5,user-scalable=yes/,
  "viewport must retain bounded pinch zoom accessibility");
const showChatSource = html.slice(html.indexOf("async function showChat"), html.indexOf("function renderMessages"));
assert.ok(showChatSource.indexOf("connectSSE(sessionId)") < showChatSource.indexOf("await Promise.all"),
  "chat SSE must connect before history/state/model requests finish");
assert.match(html, /function resetSSETransport\(\)[\s\S]*?function closeSSE\(\)/,
  "transport reconnect cleanup must be separate from full view cleanup");
console.log("  ok   mobile viewport, early SSE, and non-shrinking composer guards are present");

console.log("\n4 passed, 0 failed");
