import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../../resources/mobile/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const source = scripts.sort((a, b) => b.length - a.length)[0];
const slice = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`missing source markers: ${start} / ${end}`);
  return source.slice(a, b);
};

const windowListeners = new Map();
const documentListeners = new Map();
const contentListeners = new Map();
const appended = [];
const makeClassList = () => {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    toggle: (item, force) => force === undefined ? (values.has(item) ? (values.delete(item), false) : (values.add(item), true)) : (force ? values.add(item) : values.delete(item), force),
    contains: (item) => values.has(item),
  };
};
const content = { classList: makeClassList(), offsetWidth: 320, scrollTop: 0, addEventListener: (type, fn) => contentListeners.set(type, fn) };
const pullIndicator = { classList: makeClassList(), style: {}, textContent: "↓ 下拉刷新" };

const historyEntries = [];
let historyIndex = -1;
const history = {
  get state() { return historyIndex >= 0 ? historyEntries[historyIndex] : null; },
  replaceState(state) {
    if (historyIndex < 0) { historyEntries.push(structuredClone(state)); historyIndex = 0; }
    else historyEntries[historyIndex] = structuredClone(state);
  },
  pushState(state) {
    historyEntries.splice(historyIndex + 1);
    historyEntries.push(structuredClone(state));
    historyIndex = historyEntries.length - 1;
  },
  back() {
    if (historyIndex <= 0) return;
    historyIndex--;
    windowListeners.get("popstate")?.({ state: structuredClone(historyEntries[historyIndex]) });
  },
  forward() {
    if (historyIndex >= historyEntries.length - 1) return;
    historyIndex++;
    windowListeners.get("popstate")?.({ state: structuredClone(historyEntries[historyIndex]) });
  },
};

const context = vm.createContext({
  console,
  history,
  structuredClone,
  setTimeout,
  clearTimeout,
  navigator: { vibrate() {} },
  window: { addEventListener: (type, fn) => windowListeners.set(type, fn) },
  document: {
    getElementById: (id) => id === "content" ? content : (id === "pullRefreshIndicator" ? pullIndicator : null),
    addEventListener: (type, fn) => documentListeners.set(type, fn),
    createElement: () => ({ className: "", textContent: "", classList: makeClassList(), style: {} }),
    body: { appendChild: (node) => appended.push(node) },
  },
});

vm.runInContext(`
const NAV_STATE_KEY = "pi-mobile-nav";
let currentView = "projects";
let viewStack = [];
let navEpoch = "test";
let browserHistoryReady = false;
let browserBackPending = false;
let browserBackTimer = null;
let browserBackToken = 0;
let currentProjectId = null;
let currentSessionId = null;
let viewLoadId = 0;
let isRunning = false;
let streamingMsg = null;
let lastUserQuestion = "";
let lastUserQuestionOwner = "";
function closeSSE() {}
function clearUnseen() {}
let pullRefreshCalls = 0;
async function showProjects() { pullRefreshCalls++; }
async function showSessions() { pullRefreshCalls++; }
function renderView(data) {
  if (currentView === "sessions") currentProjectId = data?.projectId ?? null;
  if (currentView === "chat") currentSessionId = data?.sessionId ?? null;
}
`, context);
vm.runInContext(slice("// ─── Navigation", "function renderView(data)"), context);
vm.runInContext(slice("// ─── Browser Back Intercept", "// ─── Swipe Back Gesture"), context);
vm.runInContext(slice("// ─── Swipe Back Gesture", "// ─── Pull-to-refresh"), context);
vm.runInContext(slice("// ─── Pull-to-refresh", "// ─── Init"), context);
vm.runInContext("setupBrowserBackIntercept(); setupSwipeBackGesture(); setupPullToRefresh();", context);

let passed = 0;
function check(name, expression) {
  const ok = vm.runInContext(expression, context);
  if (!ok) throw new Error(`FAIL ${name}`);
  passed++;
  console.log(`  ok   ${name}`);
}

vm.runInContext(`navigate("sessions", {projectId:"p1"}); navigate("chat", {sessionId:"s1"});`, context);
check("forward navigation records depth two", `currentView === "chat" && viewStack.length === 2 && history.state.depth === 2`);
vm.runInContext("goBack();", context);
check("header back returns chat to sessions once", `currentView === "sessions" && currentProjectId === "p1" && viewStack.length === 1 && history.state.depth === 1`);
vm.runInContext("goBack();", context);
check("second header back returns sessions to projects", `currentView === "projects" && viewStack.length === 0 && history.state.depth === 0`);
vm.runInContext("history.back();", context);
check("root guard keeps projects visible", `currentView === "projects" && viewStack.length === 0 && history.state.depth === 0`);

vm.runInContext(`navigate("sessions", {projectId:"p1"}); navigate("chat", {sessionId:"s1"}); history.back(); history.forward();`, context);
check("browser forward restores chat route snapshot", `currentView === "chat" && currentSessionId === "s1" && viewStack.length === 2 && history.state.depth === 2`);

const touchStart = documentListeners.get("touchstart");
const touchMove = documentListeners.get("touchmove");
const touchEnd = documentListeners.get("touchend");
touchStart({ touches: [{ clientX: 48, clientY: 100 }] });
let prevented = false;
touchMove({ touches: [{ clientX: 140, clientY: 103 }], preventDefault: () => { prevented = true; } });
if (!prevented || appended.length !== 1 || appended[0].style.opacity !== "1") throw new Error("FAIL swipe has live visual feedback");
passed++;
console.log("  ok   swipe has live visual feedback");
touchEnd({ touches: [] });
check("completed edge swipe returns exactly one level", `currentView === "sessions" && viewStack.length === 1`);

vm.runInContext(`navigate("chat", {sessionId:"s1"});`, context);
touchStart({ touches: [{ clientX: 48, clientY: 100 }] });
touchMove({ touches: [{ clientX: 140, clientY: 103 }], preventDefault() {} });
touchMove({ touches: [{ clientX: 142, clientY: 103 }, { clientX: 160, clientY: 120 }], preventDefault() {} });
touchEnd({ touches: [] });
check("multi-touch move cancels swipe without navigating", `currentView === "chat" && viewStack.length === 2`);

touchStart({ touches: [{ clientX: 48, clientY: 100 }] });
touchMove({ touches: [{ clientX: 140, clientY: 103 }], preventDefault() {} });
touchStart({ touches: [{ clientX: 140, clientY: 103 }, { clientX: 160, clientY: 120 }] });
touchEnd({ touches: [] });
check("second touchstart cancels swipe without navigating", `currentView === "chat" && viewStack.length === 2`);

vm.runInContext(`currentView = "sessions"; currentProjectId = "p1";`, context);
const pullStart = contentListeners.get("touchstart");
const pullMove = contentListeners.get("touchmove");
const pullEnd = contentListeners.get("touchend");
pullStart({ touches: [{ clientX: 200, clientY: 100 }] });
let pullPrevented = false;
pullMove({ touches: [{ clientX: 202, clientY: 180 }], preventDefault: () => { pullPrevented = true; } });
if (!pullPrevented || pullIndicator.textContent !== "↑ 松开刷新" || !pullIndicator.classList.contains("visible")) {
  throw new Error("FAIL pull-to-refresh has threshold feedback");
}
passed++;
console.log("  ok   pull-to-refresh has threshold feedback");
await pullEnd({ touches: [] });
check("session pull-to-refresh runs and confirms completion", `pullRefreshCalls === 1 && document.getElementById("pullRefreshIndicator").textContent === "✓ 已刷新"`);

console.log(`\n${passed} passed, 0 failed`);
