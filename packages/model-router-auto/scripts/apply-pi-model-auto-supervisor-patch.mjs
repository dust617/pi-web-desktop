#!/usr/bin/env node
/**
 * 为已安装的 pi-model-auto@0.2.0 添加一个极小、可重复的 supervisor hint 读取点。
 * 该补丁只接受当前 project/.pi/router-supervisor-hint.json 中短时、绑定 session 的
 * high/ultra 能力下限；不选择具体模型，不覆盖任何用户显式 @ 路由前缀。
 *
 * 用法：
 *   node scripts/apply-pi-model-auto-supervisor-patch.mjs
 *   node scripts/apply-pi-model-auto-supervisor-patch.mjs --check
 *   node scripts/apply-pi-model-auto-supervisor-patch.mjs --dir <pi-model-auto-dir>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "const SUPERVISOR_HINT_SCHEMA_VERSION = 1;";
const EXPECTED_VERSION = "0.2.0";
const HOOK_MARKER = "const supervisorHint = !parsed ? readSupervisorHint(ctx) : undefined;";
const ROUTE_MARKER = "forcedRoute ?? supervisorForcedMode";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/apply-pi-model-auto-supervisor-patch.mjs [--check] [--dir <pi-model-auto-dir>]");
  process.exit(2);
}

function parseArgs(args) {
  let check = false;
  let dir = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "pi-model-auto");
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--check") check = true;
    else if (args[index] === "--dir") {
      const value = args[index + 1];
      if (!value) usage("--dir requires a path");
      dir = value;
      index += 1;
    } else {
      usage(`Unknown argument: ${args[index]}`);
    }
  }
  return { check, dir };
}

function fail(message) {
  console.error(`pi-model-auto supervisor patch: ${message}`);
  process.exit(1);
}

function patchSource(source) {
  const typeAnchor = "type QuotaPlanLookup = Map<string, { planKey: string; auth: Awaited<ReturnType<ExtensionContext[\"modelRegistry\"][\"getApiKeyAndHeaders\"]>> }> ;";
  const normalizedTypeAnchor = typeAnchor.replace("}> ;", "}>;");
  const routeStateAnchor = "  let forcedRoute: ForcedRoute | undefined;";
  const shutdownAnchor = `  pi.on("session_shutdown", async () => {
    forcedRoute = undefined;`;
  const hookAnchor = `    const parsed = parseForcedRoute(event.text);
    const parsedForThisTurn = parsed && isInitialUserTurn(ctx) ? parsed : undefined;
    if (parsed && !parsedForThisTurn) {
      ctx.ui.notify("Pi Router: @low/@medium/@high/@ultra/@model hints only apply at the start of a conversation. Start a new session to pin a mode without carrying existing history.", "warning");
    }
    forcedRoute = parsedForThisTurn?.route;`;

  const injectedTypes = `${normalizedTypeAnchor}

${MARKER}
const SUPERVISOR_HINT_MAX_TTL_MS = 120_000;
type SupervisorHint = { mode: CapabilityMode; reasonCodes: string[] };

/**
 * Read a short-lived, session-bound capability floor emitted by an optional supervisor extension.
 * It is deliberately fail-closed: malformed, stale, cross-session, or oversized hints are ignored.
 * The file contains no prompt text and is never treated as a concrete-model selection.
 */
function readSupervisorHint(ctx: ExtensionContext): SupervisorHint | undefined {
  const file = join(ctx.cwd, CONFIG_DIR_NAME, "router-supervisor-hint.json");
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const value = raw as Record<string, unknown>;
    const allowedKeys = new Set(["schemaVersion", "sessionId", "turnId", "mode", "createdAt", "expiresAt", "reasonCodes"]);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) return undefined;
    if (value.schemaVersion !== SUPERVISOR_HINT_SCHEMA_VERSION) return undefined;
    if (typeof value.sessionId !== "string" || value.sessionId.length === 0 || value.sessionId.length > 200) return undefined;
    if (value.sessionId !== ctx.sessionManager.getSessionId()) return undefined;
    if (typeof value.turnId !== "string" || value.turnId.length === 0 || value.turnId.length > 100) return undefined;
    if (value.mode !== "high" && value.mode !== "ultra") return undefined;
    if (!Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt)) return undefined;
    const now = Date.now();
    if (value.createdAt > now + 5_000 || value.expiresAt <= now || value.expiresAt > value.createdAt + SUPERVISOR_HINT_MAX_TTL_MS) return undefined;
    if (!Array.isArray(value.reasonCodes) || value.reasonCodes.length > 8) return undefined;
    if (!value.reasonCodes.every((code) => typeof code === "string" && /^[a-z0-9_.-]{1,64}$/.test(code))) return undefined;
    return { mode: value.mode, reasonCodes: value.reasonCodes as string[] };
  } catch {
    return undefined;
  }
}`;

  const injectedHook = `    const parsed = parseForcedRoute(event.text);
    const parsedForThisTurn = parsed && isInitialUserTurn(ctx) ? parsed : undefined;
    if (parsed && !parsedForThisTurn) {
      ctx.ui.notify("Pi Router: @low/@medium/@high/@ultra/@model hints only apply at the start of a conversation. Start a new session to pin a mode without carrying existing history.", "warning");
    }
    // An explicit user prefix always wins, including a prefix that is intentionally ignored after
    // the first turn. A supervisor only raises the capability floor; it never selects a model.
    const supervisorHint = !parsed ? readSupervisorHint(ctx) : undefined;
    forcedRoute = parsedForThisTurn?.route;
    supervisorForcedMode = supervisorHint ? { mode: supervisorHint.mode } : undefined;`;

  for (const [name, anchor] of [
    ["type", normalizedTypeAnchor],
    ["route state", routeStateAnchor],
    ["session shutdown", shutdownAnchor],
    ["input hook", hookAnchor],
  ]) {
    if (!source.includes(anchor)) fail(`unsupported source: ${name} anchor not found`);
  }

  let patched = source
    .replace(normalizedTypeAnchor, injectedTypes)
    .replace(routeStateAnchor, `${routeStateAnchor}\n  // Internal supervisor floor; unlike an explicit user route it retains quota, time pricing and cache policy.\n  let supervisorForcedMode: { mode: CapabilityMode } | undefined;`)
    .replace(shutdownAnchor, `  pi.on("session_shutdown", async () => {\n    forcedRoute = undefined;\n    supervisorForcedMode = undefined;`)
    .replace(hookAnchor, injectedHook);

  // User-forced routes retain upstream behavior. Supervisor modes only affect decide(), leaving
  // quota filtering, time-of-day repricing and cache-aware selection enabled.
  patched = patched
    .replaceAll("decide(context, options, forcedRoute, cfg,", "decide(context, options, forcedRoute ?? supervisorForcedMode, cfg,")
    .replaceAll("decide(context, undefined, forcedRoute, cfg,", "decide(context, undefined, forcedRoute ?? supervisorForcedMode, cfg,")
    .replace("if (forcedRoute || !cfg.classifier.enabled) return undefined;", "if (forcedRoute || supervisorForcedMode || !cfg.classifier.enabled) return undefined;");

  if (!patched.includes(MARKER) || !patched.includes(HOOK_MARKER) || !patched.includes(ROUTE_MARKER)) {
    fail("internal patch verification failed");
  }
  return patched;
}

const { check, dir } = parseArgs(process.argv.slice(2));
const packageFile = path.join(dir, "package.json");
const sourceFile = path.join(dir, "src", "index.ts");
if (!fs.existsSync(packageFile) || !fs.existsSync(sourceFile)) fail(`package not found at ${dir}`);

const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
if (pkg.version !== EXPECTED_VERSION) fail(`expected pi-model-auto@${EXPECTED_VERSION}, found ${String(pkg.version)}`);

const source = fs.readFileSync(sourceFile, "utf8");
const installed = source.includes(MARKER) && source.includes(HOOK_MARKER) && source.includes(ROUTE_MARKER);
if (check) {
  if (!installed) fail("not patched; run this script without --check after pi-model-auto install/update");
  console.log(`pi-model-auto@${EXPECTED_VERSION} supervisor patch: installed`);
  process.exit(0);
}

if (installed) {
  console.log(`pi-model-auto@${EXPECTED_VERSION} supervisor patch: already installed`);
  process.exit(0);
}
if (source.includes(MARKER)) fail("marker exists but patch is incomplete; reinstall pi-model-auto@0.2.0 before retrying");

fs.writeFileSync(sourceFile, patchSource(source), "utf8");
console.log(`pi-model-auto@${EXPECTED_VERSION} supervisor patch: applied`);
