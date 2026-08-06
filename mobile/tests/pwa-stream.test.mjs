// Focused regression tests for the inline PWA stream reducer.
//   node mobile/tests/pwa-stream.test.mjs
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../../resources/mobile/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const source = scripts.sort((a, b) => b.length - a.length)[0];
const initAt = source.indexOf("(async function init()");
if (initAt < 0) throw new Error("PWA init marker not found");

const fakeEventSources = [];
class FakeEventSource {
  static OPEN = 1;
  static CLOSED = 2;
  constructor(url) { this.url = url; this.readyState = FakeEventSource.OPEN; fakeEventSources.push(this); }
  close() { this.readyState = FakeEventSource.CLOSED; }
}

const context = vm.createContext({
  console,
  EventSource: FakeEventSource,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  alert: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: { vibrate: () => {} },
  window: { confirm: () => true, prompt: () => null },
  document: {
    visibilityState: "visible",
    activeElement: null,
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
    getElementById: () => null,
    addEventListener: () => {},
  },
});
vm.runInContext(source.slice(0, initAt), context, { filename: "resources/mobile/index.html" });
vm.runInContext(`currentView = "chat"; currentSessionId = "s1";`, context);

let pass = 0;
function check(name, expression) {
  const ok = vm.runInContext(expression, context);
  if (!ok) throw new Error(`FAIL ${name}`);
  pass++;
  console.log(`  ok   ${name}`);
}

vm.runInContext(`currentMessages = [];`, context);
vm.runInContext(`handleSSEEvent({type:"message_end",message:{role:"assistant",timestamp:1,content:[{type:"text",text:"first"}]}});`, context);
vm.runInContext(`handleSSEEvent({type:"message_end",message:{role:"assistant",timestamp:2,content:[{type:"text",text:"second"}]}});`, context);
check("assistant messages separated by tool turns stay in order", `currentMessages.length === 2 && currentMessages[0].content[0].text === "first" && currentMessages[1].content[0].text === "second"`);

vm.runInContext(`handleSSEEvent({type:"message_end",message:{role:"assistant",timestamp:2,content:[{type:"text",text:"second"}]}});`, context);
check("replayed final message is deduplicated", `currentMessages.length === 2`);

vm.runInContext(`currentMessages = [{role:"user",content:"hello",_optimistic:true}];`, context);
vm.runInContext(`handleSSEEvent({type:"message_end",message:{role:"user",timestamp:3,content:"hello"}});`, context);
check("authoritative user event replaces optimistic bubble", `currentMessages.length === 1 && currentMessages[0].timestamp === 3 && !currentMessages[0]._optimistic`);

vm.runInContext(`handleSSEEvent({type:"message_end",message:{role:"custom",customType:"project-memory-brief",display:false,content:"hidden brief"}});`, context);
check("display:false memory brief never appears as a mobile system message", `currentMessages.length === 1 && currentMessages.every((message) => message.role !== "custom")`);

vm.runInContext(`currentMessages = []; streamingMsg = null; handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:4,content:[{type:"text",text:"partial"}]}});`, context);
check("message_update updates only the current streaming snapshot", `currentMessages.length === 0 && streamingMsg.content[0].text === "partial"`);

vm.runInContext(`
  streamingMsg = null;
  handleSSEEvent({type:"message_start",message:{role:"assistant",content:[]}});
  handleSSEEvent({type:"message_update",assistantMessageEvent:{type:"thinking_start",contentIndex:0}});
  handleSSEEvent({type:"message_update",assistantMessageEvent:{type:"thinking_delta",contentIndex:0,delta:"work"}});
  handleSSEEvent({type:"message_update",assistantMessageEvent:{type:"text_start",contentIndex:1}});
  handleSSEEvent({type:"message_update",assistantMessageEvent:{type:"text_delta",contentIndex:1,delta:"A"}});
  handleSSEEvent({type:"message_update",assistantMessageEvent:{type:"text_delta",contentIndex:1,delta:"B"}});
`, context);
check("compact mobile deltas rebuild thinking and text without snapshots", `streamingMsg.content[0].thinking === "work" && streamingMsg.content[1].text === "AB"`);

vm.runInContext(`
  streamingMsg = null;
  handleSSEEvent({type:"message_start",message:{role:"assistant",timestamp:5,content:[]}});
  handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"}]},assistantMessageEvent:{type:"text_delta",contentIndex:0,partial:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"}]}}});
  handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"},{type:"toolCall",name:"read",arguments:{path:"x"}}]},assistantMessageEvent:{type:"toolcall_delta",contentIndex:1,partial:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"},{type:"toolCall",name:"read",arguments:{path:"x"}}]}}});
  handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:5,content:[{type:"text",text:"A"}]},assistantMessageEvent:{type:"text_delta",contentIndex:0,partial:{role:"assistant",timestamp:5,content:[{type:"text",text:"A"}]}}});
`, context);
check("indexed interleaving preserves order and ignores regressive snapshots", `streamingMsg.content.length === 2 && streamingMsg.content[0].text === "AB" && streamingMsg.content[1].name === "read"`);

check("thinking blocks use the actual thinking field", `renderMessage({role:"assistant",content:[{type:"thinking",thinking:"reasoning"}]}).includes("reasoning")`);

check("stale EventSource cannot write session A data into session B", `(() => {
  currentView = "chat"; currentMessages = []; currentSessionId = "A";
  connectSSE("A"); const oldSource = sseSource;
  currentSessionId = "B"; connectSSE("B");
  oldSource.onmessage({data:JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"FROM_A"}]}})});
  const safe = currentMessages.length === 0;
  closeSSE();
  return safe;
})()`);

check("history cache is isolated from optimistic array mutation", `(() => {
  historyCache.clear();
  const original = [{role:"user",content:"saved"}];
  cacheHistory("cache-test", original);
  original.push({role:"user",content:"unsent",_optimistic:true});
  const restored = historyCache.get("cache-test").slice();
  restored.push({role:"user",content:"local only"});
  return historyCache.get("cache-test").length === 1;
})()`);

check("terminal unauthorized returns to login", `(() => {
  let entered = false;
  showLogin = () => { entered = true; currentView = "login"; };
  currentView = "chat";
  handleSSEEvent({type:"error",code:"UNAUTHORIZED",terminal:true,message:"expired"});
  return entered && currentView === "login";
})()`);

const extensionConfirmForwarded = await vm.runInContext(`(async () => {
  currentView = "chat"; currentSessionId = "s1";
  let confirmCalls = 0, apiCalls = 0, captured = null, release;
  window.confirm = () => { confirmCalls++; return true; };
  api = (path, opts) => { apiCalls++; captured = {path, body:JSON.parse(opts.body)}; return new Promise((resolve) => { release = resolve; }); };
  const request = {type:"extension_ui_request",id:"ui-confirm-1",method:"confirm",title:"Cross-session request",message:"Continue?"};
  handleSSEEvent(request);
  handleSSEEvent(request);
  const deduped = confirmCalls === 1 && apiCalls === 1;
  release({ok:true});
  await Promise.resolve(); await Promise.resolve();
  return deduped && captured.path.endsWith("/sessions/s1/ui-response") && captured.body.id === "ui-confirm-1" && captured.body.confirmed === true;
})()`, context);
if (!extensionConfirmForwarded) throw new Error("FAIL extension confirmation is shown once and forwarded");
pass++;
console.log("  ok   extension confirmation is shown once and forwarded");

const extensionResponseRetries = await vm.runInContext(`(async () => {
  currentView = "chat"; currentSessionId = "s1";
  let calls = 0, captured = null;
  window.confirm = () => true;
  api = async (path, opts) => {
    calls++;
    if (calls === 1) throw new Error("transient offline");
    captured = {path, body:JSON.parse(opts.body)};
    return {ok:true};
  };
  handleSSEEvent({type:"extension_ui_request",id:"ui-retry-1",method:"confirm",title:"Retry",message:"Continue?"});
  await new Promise((resolve) => setTimeout(resolve, 450));
  return calls === 2 && captured.body.confirmed === true && !activeExtensionUiIds.has("ui-retry-1");
})()`, context);
if (!extensionResponseRetries) throw new Error("FAIL transient extension UI response is retried");
pass++;
console.log("  ok   transient extension UI response is retried");

const extensionResponseRecoversAfterExhaustion = await vm.runInContext(`(async () => {
  currentView = "chat"; currentSessionId = "s1";
  let calls = 0, reconnects = 0;
  window.confirm = () => true;
  alert = () => {};
  api = async () => { calls++; throw new Error("offline"); };
  connectSSE = (sessionId) => { if (sessionId === "s1") reconnects++; };
  handleSSEEvent({type:"extension_ui_request",id:"ui-reconnect-1",method:"confirm",title:"Reconnect",message:"Continue?"});
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  return calls === 3 && reconnects === 1 && !activeExtensionUiIds.has("ui-reconnect-1");
})()`, context);
if (!extensionResponseRecoversAfterExhaustion) throw new Error("FAIL exhausted extension UI response forces request replay reconnect");
pass++;
console.log("  ok   exhausted extension UI response forces request replay reconnect");

const selectValueRestricted = await vm.runInContext(`(async () => {
  currentView = "chat"; currentSessionId = "s1";
  const answers = ["999", "2"];
  let warnings = 0, captured = null;
  window.prompt = () => answers.shift() ?? null;
  alert = () => { warnings++; };
  api = async (path, opts) => { captured = JSON.parse(opts.body); return {ok:true}; };
  handleSSEEvent({type:"extension_ui_request",id:"ui-select-1",method:"select",title:"Choose",options:["safe-a","safe-b"]});
  await Promise.resolve(); await Promise.resolve();
  return warnings === 1 && captured.value === "safe-b" && !activeExtensionUiIds.has("ui-select-1");
})()`, context);
if (!selectValueRestricted) throw new Error("FAIL select response is restricted to an advertised option");
pass++;
console.log("  ok   select response is restricted to an advertised option");

const staleHistoryIgnored = await vm.runInContext(`(async () => {
  currentMessages = [];
  currentView = "chat";
  currentSessionId = "A";
  viewLoadId = 10;
  api = async () => { await Promise.resolve(); return {messages:[{role:"user",content:"stale A"}]}; };
  const pending = refreshHistory();
  currentSessionId = "B";
  viewLoadId = 11;
  await pending;
  return currentMessages.length === 0;
})()`, context);
if (!staleHistoryIgnored) throw new Error("FAIL stale history response cannot overwrite a new session");
pass++;
console.log("  ok   stale history response cannot overwrite a new session");

const concurrentFinalPreserved = await vm.runInContext(`(async () => {
  currentMessages = [];
  messageRevision = 20;
  currentView = "chat";
  currentSessionId = "same";
  viewLoadId = 20;
  let resolveHistory;
  api = () => new Promise((resolve) => { resolveHistory = resolve; });
  const pending = refreshHistory();
  handleSSEEvent({type:"message_end",message:{role:"assistant",timestamp:20,content:[{type:"text",text:"new final"}]}});
  resolveHistory({messages:[]});
  await pending;
  return currentMessages.length === 1 && currentMessages[0].content[0].text === "new final";
})()`, context);
if (!concurrentFinalPreserved) throw new Error("FAIL same-session stale history cannot erase a finalized message");
pass++;
console.log("  ok   same-session stale history cannot erase a finalized message");

const desktopAnchorRetriesAfterHistoryFailure = await vm.runInContext(`(async () => {
  const anchor = {style:{display:"none"},textContent:""};
  document.getElementById = (id) => id === "ctxAnchor" ? anchor : null;
  currentView = "chat";
  currentSessionId = "desktop-session";
  viewLoadId = 40;
  messageRevision = 40;
  currentMessages = [{role:"user",content:"older mobile question"}];
  stickToBottom = false;
  refreshLastUserQuestion();
  let historyCalls = 0;
  notifyDone = () => {};
  api = async (path) => {
    if (path.includes("/history")) {
      historyCalls++;
      if (historyCalls === 1) throw new Error("temporary offline");
      return {messages:[{role:"user",content:"new desktop question"},{role:"assistant",content:[{type:"text",text:"done"}]}]};
    }
    return {running:false};
  };
  handleSSEEvent({type:"agent_end"});
  await new Promise((resolve) => setTimeout(resolve, 550));
  return historyCalls === 2 && lastUserQuestion === "new desktop question" && anchor.textContent === "💬 new desktop question" && anchor.style.display === "";
})()`, context);
if (!desktopAnchorRetriesAfterHistoryFailure) throw new Error("FAIL desktop-originated question retries a failed history reconciliation");
pass++;
console.log("  ok   desktop-originated question retries a failed history reconciliation");

const smartScrollPauses = vm.runInContext(`(() => {
  const content = {scrollHeight:1000, scrollTop:100, clientHeight:400};
  const jump = {style:{display:"none"}};
  document.getElementById = (id) => id === "content" ? content : (id === "jumpBtn" ? jump : null);
  currentView = "chat";
  stickToBottom = true;
  onContentScroll();
  scrollToBottom();
  return stickToBottom === false && jump.style.display === "";
})()`, context);
if (!smartScrollPauses) throw new Error("FAIL upward reader scroll pauses auto-follow and shows new-message affordance");
pass++;
console.log("  ok   upward reader scroll pauses auto-follow and shows new-message affordance");

check("queued forced-scroll frames cannot affect the next view", `(() => {
  const queued = [];
  const savedRAF = requestAnimationFrame;
  const savedGetElementById = document.getElementById;
  requestAnimationFrame = (callback) => { queued.push(callback); return queued.length; };
  const content = {scrollHeight:1000, scrollTop:10, clientHeight:400};
  document.getElementById = (id) => id === "content" ? content : null;
  currentView = "chat"; currentSessionId = "scroll-A"; viewLoadId = 70;
  scrollToBottom(true);
  closeSSE(); currentView = "sessions"; currentSessionId = null; viewLoadId = 71;
  while (queued.length) queued.shift()();
  requestAnimationFrame = savedRAF;
  document.getElementById = savedGetElementById;
  return content.scrollTop === 10;
})()`);

check("jump-to-latest resumes auto-follow", `(() => { jumpToBottom(); return stickToBottom === true && document.getElementById("jumpBtn").style.display === "none"; })()`);

const unchangedHistoryNoBadge = await vm.runInContext(`(async () => {
  const msg = {role:"assistant",timestamp:30,content:[{type:"text",text:"same"}]};
  const content = {scrollHeight:1000, scrollTop:100, clientHeight:400};
  const jump = {style:{display:"none"}};
  document.getElementById = (id) => id === "content" ? content : (id === "jumpBtn" ? jump : null);
  currentMessages = [msg];
  messageRevision = 30;
  currentView = "chat";
  currentSessionId = "same";
  viewLoadId = 30;
  stickToBottom = false;
  api = async () => ({messages:[msg]});
  await refreshHistory();
  return jump.style.display === "none";
})()`, context);
if (!unchangedHistoryNoBadge) throw new Error("FAIL identical history reconciliation does not show false new-message badge");
pass++;
console.log("  ok   identical history reconciliation does not show false new-message badge");

const authoritativeModelSync = vm.runInContext(`(() => {
  const makeClassList = () => { const values = new Set(); return {add:(v)=>values.add(v),remove:(v)=>values.delete(v),contains:(v)=>values.has(v)}; };
  const a = {dataset:{provider:"prov",modelId:"old"},textContent:"Old",classList:makeClassList()};
  const b = {dataset:{provider:"prov",modelId:"tag:latest"},textContent:"Latest",classList:makeClassList()};
  const list = {querySelectorAll:()=>[a,b]};
  const trigger = {textContent:"Old"};
  document.getElementById = (id) => id === "modelList" ? list : (id === "modelTrigger" ? trigger : null);
  syncModelSelect({model:{provider:"prov",id:"tag:latest"}});
  return b.classList.contains("selected") && !a.classList.contains("selected") && trigger.textContent === "Latest";
})()`, context);
if (!authoritativeModelSync) throw new Error("FAIL authoritative model state updates custom selector losslessly");
pass++;
console.log("  ok   authoritative model state updates selector losslessly");

const idleClearsStreaming = await vm.runInContext(`(async () => {
  currentView = "chat"; currentSessionId = "idle"; viewLoadId = 50;
  runningRevision = 50; isRunning = true;
  streamingMsg = {role:"assistant",content:[]};
  api = async () => ({running:false});
  await refreshState();
  return isRunning === false && streamingMsg === null;
})()`, context);
if (!idleClearsStreaming) throw new Error("FAIL authoritative idle state clears a missed terminal placeholder");
pass++;
console.log("  ok   authoritative idle state clears a missed terminal placeholder");

const failedSendRollsBack = await vm.runInContext(`(async () => {
  const savedRender = renderMessages, savedRefresh = refreshHistory;
  const input = {value:"not sent",style:{},scrollHeight:42};
  const send = {disabled:false,textContent:""};
  document.getElementById = (id) => id === "msgInput" ? input : id === "sendBtn" ? send : null;
  renderMessages = () => {}; refreshHistory = async () => {};
  currentView = "chat"; currentSessionId = "send-fail"; viewLoadId = 60;
  currentMessages = [{role:"user",content:"saved"}]; isSending = false;
  cacheHistory("send-fail", currentMessages);
  api = async () => { throw new Error("offline"); };
  await sendMessage();
  const ok = currentMessages.length === 1 && historyCache.get("send-fail").length === 1;
  renderMessages = savedRender; refreshHistory = savedRefresh;
  return ok;
})()`, context);
if (!failedSendRollsBack) throw new Error("FAIL failed send rolls optimistic message back without network history");
pass++;
console.log("  ok   failed send rolls optimistic message back without network history");

console.log(`\n${pass} passed, 0 failed`);
