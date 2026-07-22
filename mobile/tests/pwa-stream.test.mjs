// Focused regression tests for the inline PWA stream reducer.
//   node mobile/tests/pwa-stream.test.mjs
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../../resources/mobile/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const source = scripts.sort((a, b) => b.length - a.length)[0];
const initAt = source.indexOf("(async function init()");
if (initAt < 0) throw new Error("PWA init marker not found");

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  alert: () => {},
  window: {},
  document: {
    visibilityState: "visible",
    activeElement: null,
    getElementById: () => null,
  },
});
vm.runInContext(source.slice(0, initAt), context, { filename: "resources/mobile/index.html" });

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

vm.runInContext(`currentMessages = []; streamingMsg = null; handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:4,content:[{type:"text",text:"partial"}]}});`, context);
check("message_update updates only the current streaming snapshot", `currentMessages.length === 0 && streamingMsg.content[0].text === "partial"`);

vm.runInContext(`
  streamingMsg = null;
  handleSSEEvent({type:"message_start",message:{role:"assistant",timestamp:5,content:[]}});
  handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"}]},assistantMessageEvent:{type:"text_delta",contentIndex:0,partial:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"}]}}});
  handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"},{type:"toolCall",name:"read",arguments:{path:"x"}}]},assistantMessageEvent:{type:"toolcall_delta",contentIndex:1,partial:{role:"assistant",timestamp:5,content:[{type:"text",text:"AB"},{type:"toolCall",name:"read",arguments:{path:"x"}}]}}});
  handleSSEEvent({type:"message_update",message:{role:"assistant",timestamp:5,content:[{type:"text",text:"A"}]},assistantMessageEvent:{type:"text_delta",contentIndex:0,partial:{role:"assistant",timestamp:5,content:[{type:"text",text:"A"}]}}});
`, context);
check("indexed interleaving preserves order and ignores regressive snapshots", `streamingMsg.content.length === 2 && streamingMsg.content[0].text === "AB" && streamingMsg.content[1].name === "read"`);

check("thinking blocks use the actual thinking field", `renderMessage({role:"assistant",content:[{type:"thinking",thinking:"reasoning"}]},0).includes("reasoning")`);

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
  const a = {value:"a",dataset:{provider:"prov",modelId:"old"}};
  const b = {value:"b",dataset:{provider:"prov",modelId:"tag:latest"}};
  const sel = {options:[a,b],value:"a",dataset:{currentValue:"a"}};
  document.getElementById = (id) => id === "modelSelect" ? sel : null;
  syncModelSelect({model:{provider:"prov",id:"tag:latest"}});
  return sel.value === "b" && sel.dataset.currentValue === "b";
})()`, context);
if (!authoritativeModelSync) throw new Error("FAIL authoritative model state updates selector losslessly");
pass++;
console.log("  ok   authoritative model state updates selector losslessly");

console.log(`\n${pass} passed, 0 failed`);
