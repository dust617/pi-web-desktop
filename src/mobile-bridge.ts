/**
 * MobileBridge BFF – loopback-only HTTP server for the mobile PWA.
 *
 * Serves:
 *   /mobile/              → PWA static shell
 *   /mobile/auth/*        → pairing-code login / logout
 *   /mobile/api/v1/*      → versioned, filtered proxy to pi-web
 *
 * Security:
 *   - Binds 127.0.0.1 only (never 0.0.0.0)
 *   - Cookie auth (HttpOnly, SameSite=Strict)
 *   - Origin check on mutation endpoints
 *   - 8 MiB history hard-limit
 *   - No sensitive fields forwarded (systemPrompt, sessionFile, …)
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as net from "net";
import { StringDecoder } from "string_decoder";
import type { PiWebRuntime } from "./pi-web-runtime";

// ─── Types ───────────────────────────────────────────────────────────

export interface MobileBridgeConfig {
  /** Fixed loopback port (default 62810). */
  port?: number;
  /** Path to PWA static files (default resources/mobile/). */
  staticDir?: string;
  /** Reference to the PiWebRuntime for dynamic port discovery. */
  runtime: PiWebRuntime;
  /** Allowed origins for mutation requests (e.g. ["https://pi.example.test:8443"]). */
  allowedOrigins?: string[];
  /** Bind address (default 127.0.0.1). Set to "0.0.0.0" for LAN/IPv6 port-forward. */
  bindHost?: string;
  /** File path to persist mobile login sessions (survives BFF restart). */
  sessionStorePath?: string;
}

/** Built-in public origin for this project's tunnel hostname. */
export const DEFAULT_MOBILE_ORIGIN = "https://pi.example.test:8443";

/**
 * Single source of truth for the public PWA origin, shared by the Electron
 * integration and the standalone BFF so their mutation-Origin behaviour matches.
 *
 * Resolution rules:
 *   - If PI_MOBILE_ORIGIN is explicitly set (even to "") → use it. An empty
 *     value yields [] = "loopback-only mode" (no public origin allowed).
 *   - If PI_MOBILE_ORIGIN is unset → fall back to DEFAULT_MOBILE_ORIGIN so a
 *     fresh install works out of the box over the tunnel.
 *   - Only complete https://host[:port] origins are accepted; anything else is
 *     dropped. Loopback http origins are authorised separately by isAllowedOrigin.
 *   - Multiple origins may be comma-separated.
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PI_MOBILE_ORIGIN;
  if (raw === undefined) return [DEFAULT_MOBILE_ORIGIN];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol !== "https:") continue; // public origins must be https
      out.push(u.origin);
    } catch {
      /* ignore malformed origin */
    }
  }
  return out;
}

interface AuthSession {
  /** SHA-256 of the bearer token; raw cookie tokens are never persisted. */
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function errorResponse(res: http.ServerResponse, status: number, code: string, message: string, retryable = false): void {
  jsonResponse(res, status, { error: { code, message, retryable } });
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const map: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (!key) continue;
    try {
      map[key] = decodeURIComponent(val);
    } catch {
      // Treat malformed cookie encoding as an absent/invalid cookie. Public
      // requests must never turn parser details into a 500 response.
    }
  }
  return map;
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        // Do NOT destroy the socket here: the caller must still be able to write
        // a structured 413 response. We pause the stream (back-pressure stops the
        // peer) and reject; handleRequest's finally-block destroys any unfinished
        // body once the response has been sent, so keep-alive sockets don't leak.
        try { req.pause(); } catch { /* ignore */ }
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("INVALID_JSON");
  }
}

/** Simple path-parameter matcher: returns params or null. */
function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const patParts = pattern.split("/").filter(Boolean);
  const urlParts = pathname.split("/").filter(Boolean);
  if (patParts.length !== urlParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(":")) {
      params[patParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
    } else if (patParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

const MOBILE_THINKING_CHARS = 200;
const MOBILE_TOOL_ARGS_CHARS = 300;
const MOBILE_TOOL_RESULT_CHARS = 800;
const MOBILE_ASSISTANT_TEXT_CHARS = 64_000;
const MOBILE_HISTORY_MESSAGES = 120;
const MOBILE_MAX_MESSAGE_BYTES = 64 * 1024;
const MOBILE_MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MOBILE_MAX_IMAGES = 5;
const MOBILE_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MOBILE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function capMobileText(value: string, limit: number, suffix = "…"): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: value.slice(0, limit) + suffix, truncated: true };
}

/** Remove fields the mobile renderer never uses and bound folded/hidden bodies. */
export function slimMobileMessage(message: any): any {
  if (!message || typeof message !== "object") return message;
  const role = typeof message.role === "string" ? message.role : "system";
  let messageTruncated = false;
  const slimBlock = (block: any): any => {
    if (!block || typeof block !== "object") return block;
    const type = block.type;
    if (type === "thinking") {
      const raw = typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "";
      const { text, truncated } = capMobileText(raw, MOBILE_THINKING_CHARS);
      messageTruncated ||= truncated;
      return { type: "thinking", thinking: text, ...(block.deferred ? { deferred: true } : {}), ...(block.redacted ? { redacted: true } : {}), ...(truncated ? { truncated: true, originalLength: raw.length } : {}) };
    }
    if (type === "text") {
      const raw = typeof block.text === "string" ? block.text : "";
      const limit = role === "toolResult" ? MOBILE_TOOL_RESULT_CHARS : role === "assistant" ? MOBILE_ASSISTANT_TEXT_CHARS : role === "user" ? 64 * 1024 : 500;
      const { text, truncated } = capMobileText(raw, limit, "…\n[移动端已截断，完整内容请在桌面端查看]");
      messageTruncated ||= truncated;
      return { type: "text", text, ...(truncated ? { truncated: true, originalLength: raw.length } : {}) };
    }
    if (type === "toolCall" || type === "tool_use") {
      const args = block.arguments ?? block.input;
      const raw = typeof args === "string" ? args : args ? JSON.stringify(args) : "";
      const { text, truncated } = capMobileText(raw, MOBILE_TOOL_ARGS_CHARS);
      messageTruncated ||= truncated;
      return { type: "toolCall", id: block.id, name: block.name ?? block.toolName ?? "tool", arguments: text, ...(truncated ? { truncated: true, originalLength: raw.length } : {}) };
    }
    if (type === "toolResult" || type === "tool_result") {
      const raw = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
      const { text, truncated } = capMobileText(raw, MOBILE_TOOL_RESULT_CHARS);
      messageTruncated ||= truncated;
      return { type: "toolResult", content: text, ...(truncated ? { truncated: true, originalLength: raw.length } : {}) };
    }
    if (type === "image") {
      // History/SSE must never expose original base64 or provider-side image
      // metadata. The mobile client retains locally attached-image previews;
      // historical images fall back to this safe desktop-view placeholder.
      messageTruncated = true;
      return { type: "text", text: "[图片内容请在桌面端查看]", truncated: true };
    }
    return { type: typeof type === "string" ? type : "unknown" };
  };

  let content: any = message.content;
  if (typeof content === "string") {
    const limit = role === "toolResult" ? MOBILE_TOOL_RESULT_CHARS : role === "assistant" ? MOBILE_ASSISTANT_TEXT_CHARS : role === "user" ? 64 * 1024 : 500;
    const capped = capMobileText(content, limit, "…\n[移动端已截断，完整内容请在桌面端查看]");
    content = capped.text;
    messageTruncated ||= capped.truncated;
  } else if (Array.isArray(content)) {
    content = content.map(slimBlock);
  }

  // Inject imagegen tool-result images as base64 image blocks so the mobile
  // renderer can display them. The tool returns only a text summary + a file
  // path in `details`; without this, mobile never sees the image.
  let injectedImage: { type: "image"; data: string; mimeType: string } | null = null;
  let oversizedNote: { type: "text"; text: string } | null = null;
  if (role === "toolResult" && !message.isError) {
    const details = message.details as { path?: string; latestPath?: string } | undefined;
    const imgPath = details?.path ?? details?.latestPath;
    if (imgPath && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(imgPath)) {
      try {
        const buf = fs.readFileSync(imgPath);
        // 5 MiB cap — keep the mobile payload sane for very large images.
        if (buf.length <= 5 * 1024 * 1024) {
          const ext = path.extname(imgPath).slice(1).toLowerCase();
          const mime =
            ext === "jpg" || ext === "jpeg" ? "image/jpeg"
            : ext === "gif" ? "image/gif"
            : ext === "webp" ? "image/webp"
            : ext === "bmp" ? "image/bmp"
            : "image/png";
          injectedImage = { type: "image", data: buf.toString("base64"), mimeType: mime };
        } else {
          messageTruncated = true;
          oversizedNote = { type: "text", text: "[图片过大，请在桌面端查看]" };
        }
      } catch { /* file missing/unreadable — skip silently */ }
    }
  }

  let finalContent: any = content;
  if (Array.isArray(content) && (injectedImage || oversizedNote)) {
    const extras: any[] = [];
    if (injectedImage) extras.push(injectedImage);
    if (oversizedNote) extras.push(oversizedNote);
    finalContent = [...extras, ...(content as any[])];
  }

  return {
    role,
    content: finalContent,
    ...(message.timestamp != null ? { timestamp: message.timestamp } : {}),
    ...(typeof message.toolName === "string" ? { toolName: message.toolName } : {}),
    ...(message.isError ? { isError: true } : {}),
    ...(messageTruncated ? { truncated: true } : {}),
    // Preserve model/provider so the mobile renderer can show which model
    // produced each assistant message (matches desktop MessageView label).
    ...(typeof message.model === "string" && message.model ? { model: message.model } : {}),
    ...(typeof message.provider === "string" && message.provider ? { provider: message.provider } : {}),
  };
}

function isHiddenMobileMessage(message: any): boolean {
  return message?.role === "custom" && message?.display === false;
}

/** Convert cumulative desktop agent snapshots into a compact mobile delta DTO. */
export function optimizeMobileSSEEvent(event: any): any | null {
  if (!event || typeof event !== "object") return null;
  const type = event.type;
  if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end" || type === "turn_start" || type === "turn_end") {
    return null; // mobile already shows tool-call progress from assistant deltas
  }
  if (type === "message_start" || type === "message_end") {
    if (isHiddenMobileMessage(event.message)) return null;
    return { type, message: slimMobileMessage(event.message) };
  }
  if (type === "message_update") {
    const source = event.assistantMessageEvent;
    if (!source || typeof source !== "object") {
      return event.message ? { type, message: slimMobileMessage(event.message) } : null;
    }
    const deltaType = String(source.type ?? "");
    if (deltaType.startsWith("toolcall_")) return null; // final bounded call arrives via message_end
    const compact: any = {
      type: deltaType,
      contentIndex: Number.isInteger(source.contentIndex) ? source.contentIndex : 0,
    };
    if (typeof source.delta === "string") {
      const limit = deltaType === "thinking_delta" ? 256 : 4096;
      compact.delta = source.delta.slice(0, limit);
    }
    return { type, assistantMessageEvent: compact };
  }
  if (type === "connected" || type === "agent_start" || type === "agent_end") return { type };
  if (type === "extension_ui_request") {
    const method = String(event.method ?? "");
    if (!["confirm", "select", "input", "editor"].includes(method) || typeof event.id !== "string") return null;
    return {
      type,
      id: event.id.slice(0, 128),
      method,
      title: String(event.title ?? "扩展请求").slice(0, 300),
      ...(typeof event.message === "string" ? { message: event.message.slice(0, 2_000) } : {}),
      ...(typeof event.placeholder === "string" ? { placeholder: event.placeholder.slice(0, 500) } : {}),
      ...(typeof event.prefill === "string" ? { prefill: event.prefill.slice(0, 8_000) } : {}),
      ...(Array.isArray(event.options) ? { options: event.options.slice(0, 50).map((option: unknown) => String(option).slice(0, 500)) } : {}),
      ...(typeof event.expiresAt === "number" ? { expiresAt: event.expiresAt } : {}),
    };
  }
  if (type === "model_select") return { type, model: event.model };
  if (type === "thinking_level_select") return { type, level: event.level };
  if (type === "error") return { type, code: event.code, terminal: !!event.terminal, message: String(event.message ?? "Agent stream error").slice(0, 500) };
  return null;
}

// ─── Auth Manager ────────────────────────────────────────────────────

class AuthManager {
  /** Session lifetime: 7 days, matching the mb_session cookie Max-Age. */
  private static readonly TTL_MS = 7 * 24 * 60 * 60 * 1000;

  private pairingCode: string;
  private sessions = new Map<string, AuthSession>();
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();
  private storePath: string | null;

  constructor(storePath?: string) {
    this.storePath = storePath || null;
    this.pairingCode = this.generateCode();
    this.load();
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /** Load persisted sessions (survives BFF restart so phones stay logged in). */
  private load(): void {
    if (!this.storePath) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.storePath, "utf8"));
      const now = Date.now();
      let migratedLegacyTokens = false;
      for (const s of (data.sessions ?? [])) {
        if (!s || typeof s.expiresAt !== "number" || s.expiresAt <= now) continue;
        // Legacy stores persisted the raw token as `id`. Hash it in memory and
        // immediately rewrite the store so existing phone cookies keep working.
        const tokenHash = typeof s.tokenHash === "string" ? s.tokenHash :
          (typeof s.id === "string" ? this.hashToken(s.id) : "");
        if (!tokenHash) continue;
        if (s.id) migratedLegacyTokens = true;
        this.sessions.set(tokenHash, { tokenHash, createdAt: s.createdAt ?? now, expiresAt: s.expiresAt });
      }
      if (migratedLegacyTokens) this.persist();
    } catch (err: any) {
      if (err?.code !== "ENOENT") console.error(`[mobile-bridge] failed to load mobile session store: ${err?.message ?? "unknown error"}`);
    }
  }

  /** Persist only token hashes, using temp+rename so crashes cannot truncate the store. */
  private persist(): void {
    if (!this.storePath) return;
    const tempPath = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const data = { version: 2, sessions: [...this.sessions.values()] };
      fs.writeFileSync(tempPath, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempPath, this.storePath);
      try { fs.chmodSync(this.storePath, 0o600); } catch { /* best effort on Windows */ }
    } catch (err: any) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore */ }
      console.error(`[mobile-bridge] failed to persist mobile sessions: ${err?.message ?? "unknown error"}`);
    }
  }

  get code(): string {
    return this.pairingCode;
  }

  regenerateCode(): string {
    this.pairingCode = this.generateCode();
    return this.pairingCode;
  }

  /** Check rate limit (5 failed attempts per minute per client IP). */
  checkRateLimit(ip: string): boolean {
    const now = Date.now();
    // Lazy cleanup: purge expired entries so the map cannot grow unbounded
    // when many distinct IPs probe the login endpoint over time.
    if (this.loginAttempts.size > 64) {
      for (const [key, entry] of this.loginAttempts) {
        if (now > entry.resetAt) this.loginAttempts.delete(key);
      }
    }
    const entry = this.loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      this.loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count++;
    return entry.count <= 5;
  }

  clearRateLimit(ip: string): void {
    this.loginAttempts.delete(ip);
  }

  /** Validate pairing code and create session. Returns cookie value or null. */
  login(code: string): string | null {
    if (code !== this.pairingCode) return null;
    const sessionId = crypto.randomUUID();
    const tokenHash = this.hashToken(sessionId);
    const now = Date.now();
    this.sessions.set(tokenHash, { tokenHash, createdAt: now, expiresAt: now + AuthManager.TTL_MS });
    this.persist();
    return sessionId;
  }

  /** Validate session cookie (rejects expired sessions). */
  validate(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    const tokenHash = this.hashToken(sessionId);
    const s = this.sessions.get(tokenHash);
    if (!s) return false;
    if (s.expiresAt <= Date.now()) {
      this.sessions.delete(tokenHash);
      this.persist();
      return false;
    }
    return true;
  }

  /** Destroy a session. */
  logout(sessionId: string): void {
    this.sessions.delete(this.hashToken(sessionId));
    this.persist();
  }

  /** Destroy all sessions and regenerate pairing code. */
  revokeAll(): void {
    this.sessions.clear();
    this.pairingCode = this.generateCode();
    this.persist();
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  private generateCode(): string {
    // 6-digit numeric code, easy to type on phone
    return String(crypto.randomInt(100000, 999999));
  }
}

// ─── MobileBridge Server ─────────────────────────────────────────────

export class MobileBridge {
  private server: http.Server | null = null;
  private auth: AuthManager;
  private readonly config: Required<MobileBridgeConfig>;
  private readonly activeSSE = new Set<http.ServerResponse>();
  private readonly activeSSEBySession = new Map<string, number>();

  constructor(config: MobileBridgeConfig) {
    this.config = {
      port: config.port ?? 62810,
      staticDir: config.staticDir ?? path.join(__dirname, "..", "resources", "mobile"),
      runtime: config.runtime,
      allowedOrigins: config.allowedOrigins ?? [],
      sessionStorePath: config.sessionStorePath ?? "",
      bindHost: config.bindHost ?? "127.0.0.1",
    };
    this.auth = new AuthManager(this.config.sessionStorePath);
  }

  get pairingCode(): string {
    return this.auth.code;
  }

  /**
   * Rotate the pairing code AND revoke every existing mobile session.
   * Used by the Electron tray "refresh pairing code" action so that a leaked
   * code cannot keep authorising old sessions. Returns the new code.
   */
  rotateCode(): string {
    this.auth.revokeAll();
    for (const sse of this.activeSSE) {
      try { sse.end(); } catch { /* ignore */ }
    }
    this.activeSSE.clear();
    this.activeSSEBySession.clear();
    return this.auth.code;
  }

  get isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  get port(): number {
    return this.config.port;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve(this.config.port);
        return;
      }
      const srv = http.createServer((req, res) => this.handleRequest(req, res));
      srv.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`MobileBridge port ${this.config.port} is already in use`));
        } else {
          reject(err);
        }
      });
      const bind = this.config.bindHost ?? "127.0.0.1";
      srv.listen(this.config.port, bind, () => {
        this.server = srv;
        console.log(`[mobile-bridge] listening on ${bind}:${this.config.port}`);
        resolve(this.config.port);
      });
    });
  }

  async stop(): Promise<void> {
    // Close all active SSE connections
    for (const res of this.activeSSE) {
      try { res.end(); } catch { /* ignore */ }
    }
    this.activeSSE.clear();
    this.activeSSEBySession.clear();

    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    return new Promise((resolve) => {
      srv.close(() => {
        console.log("[mobile-bridge] stopped");
        resolve();
      });
    });
  }

  // ── Request Router ───────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.config.port}`);
      const pathname = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

      // Keep the 5-second state/list polling path quiet. Log only failures,
      // slow requests, or an explicitly enabled diagnostic session.
      if (pathname.startsWith("/mobile/api/") || pathname.startsWith("/mobile/auth/")) {
        const requestStartedAt = Date.now();
        const debugRequests = process.env.PI_MOBILE_DEBUG_REQUESTS === "1";
        res.on("finish", () => {
          const elapsed = Date.now() - requestStartedAt;
          if (debugRequests || res.statusCode >= 400 || elapsed >= 1_000) {
            const origin = req.headers.origin ?? "-";
            const cookieState = req.headers.cookie ? "cookie" : "nocookie";
            console.log(`[req] ${method} ${pathname} origin=${origin} ${cookieState} -> ${res.statusCode} (${elapsed}ms)`);
          }
        });
      }

      // CORS preflight
      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
          ...this.corsHeaders(req),
        });
        res.end();
        return;
      }

      // ── Static files (no auth) ──
      if (pathname === "/mobile" || pathname === "/mobile/") {
        return this.serveStatic(res, "index.html");
      }
      if (pathname.startsWith("/mobile/") && !pathname.startsWith("/mobile/api/") && !pathname.startsWith("/mobile/auth/")) {
        const rel = pathname.slice("/mobile/".length);
        return this.serveStatic(res, rel);
      }

      // ── Auth endpoints (no cookie required) ──
      if (pathname === "/mobile/auth/login" && method === "POST") {
        return this.handleLogin(req, res);
      }
      // NOTE: a GET /mobile/auth/pairing-code route previously existed here and
      // was removed (P0 security fix). The pairing code must NEVER be reachable
      // over HTTP, because the tunnel forwards public requests to this loopback
      // server. The Electron tray reads it in-process via mobileBridge.pairingCode.

      // ── Health (no auth) ──
      if (pathname === "/mobile/api/v1/health" && method === "GET") {
        return this.handleHealth(res);
      }

      // ── All other API endpoints require auth ──
      if (pathname.startsWith("/mobile/api/v1/") || pathname === "/mobile/auth/logout") {
        if (!this.checkAuth(req, res)) return;
        return this.routeApi(method, pathname, url, req, res);
      }

      // 404
      errorResponse(res, 404, "NOT_FOUND", `Unknown path: ${pathname}`);
    } catch (err: any) {
      console.error("[mobile-bridge] unhandled error:", err);
      if (!res.headersSent) {
        errorResponse(res, 500, "INTERNAL_ERROR", err.message ?? "Internal error");
      }
    } finally {
      // Drain (discard) any unread request body so a keep-alive socket stays
      // clean for the next request. We use resume() — NOT destroy() — so the
      // already-written response (404/403/413/…) is flushed normally instead of
      // the peer seeing ECONNRESET. Covers: body-less GET (complete=false until
      // consumed), auth-rejected POSTs whose body was never read, and the
      // BODY_TOO_LARGE path where readBody() paused the stream mid-body.
      if (!req.complete && !req.destroyed) {
        try { req.resume(); } catch { /* ignore */ }
      }
    }
  }

  private corsHeaders(req: http.IncomingMessage): Record<string, string> {
    const origin = req.headers.origin ?? "";
    if (this.isAllowedOrigin(origin)) {
      return { "Access-Control-Allow-Origin": origin };
    }
    return {};
  }

  private isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    // Direct loopback development remains available, but reverse proxies do not
    // gain trust merely because their downstream socket is loopback.
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
    try {
      const normalized = new URL(origin).origin;
      return this.config.allowedOrigins.includes(normalized);
    } catch {
      return false;
    }
  }

  private clientIp(req: http.IncomingMessage): string {
    const peer = req.socket.remoteAddress ?? "unknown";
    const isLoopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
    if (!isLoopback) return peer;
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",", 1)[0].trim();
    return net.isIP(forwarded) ? forwarded : peer;
  }

  /**
   * Build Set-Cookie flags. `Secure` is added only when the request arrived over
   * HTTPS (detected via the tunnel's X-Forwarded-Proto), so loopback HTTP dev
   * still sets the cookie while the public HTTPS path is fully secure (P2-1).
   */
  private cookieFlags(req: http.IncomingMessage, extra = ""): string {
    const fwd = String(req.headers["x-forwarded-proto"] ?? "").toLowerCase();
    const secure = fwd === "https" ? "; Secure" : "";
    return `HttpOnly; SameSite=Strict; Path=/mobile${secure}${extra}`;
  }

  // ── Auth Middleware ──────────────────────────────────────────────

  private checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const cookies = parseCookies(req);
    const sessionId = cookies["mb_session"];
    if (!this.auth.validate(sessionId)) {
      errorResponse(res, 401, "UNAUTHORIZED", "Login required");
      return false;
    }
    // Fail closed for state-changing requests. SameSite cookies are a useful
    // second CSRF layer, not a substitute for enforcing the public tunnel/PWA
    // origin boundary.
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && !this.isAllowedOrigin(req.headers.origin ?? "")) {
      errorResponse(res, 403, "FORBIDDEN", "Origin not allowed");
      return false;
    }
    return true;
  }

  // ── Auth Handlers ──────────────────────────────────────────────

  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAllowedOrigin(req.headers.origin ?? "")) {
      errorResponse(res, 403, "FORBIDDEN", "Origin not allowed");
      return;
    }
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      errorResponse(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
      return;
    }
    const ip = this.clientIp(req);
    if (!this.auth.checkRateLimit(ip)) {
      errorResponse(res, 429, "RATE_LIMITED", "Too many login attempts. Try again in 1 minute.");
      return;
    }

    let body: unknown;
    try {
      const raw = await readBody(req, 1024);
      body = parseJsonBody(raw);
    } catch (err: any) {
      if (err?.message === "BODY_TOO_LARGE") return errorResponse(res, 413, "BODY_TOO_LARGE", "Request body exceeds limit");
      errorResponse(res, 400, "INVALID_REQUEST", "Invalid JSON body");
      return;
    }

    const code = (body as any)?.code;
    if (typeof code !== "string") {
      errorResponse(res, 400, "INVALID_REQUEST", "Missing 'code' field");
      return;
    }

    const sessionId = this.auth.login(code);
    if (!sessionId) {
      errorResponse(res, 401, "UNAUTHORIZED", "Invalid pairing code");
      return;
    }
    this.auth.clearRateLimit(ip);

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": `mb_session=${sessionId}; ${this.cookieFlags(req, "; Max-Age=604800")}`,
    });
    res.end(JSON.stringify({ ok: true }));
  }

  private handleLogout(req: http.IncomingMessage, res: http.ServerResponse): void {
    const cookies = parseCookies(req);
    const sessionId = cookies["mb_session"];
    if (sessionId) this.auth.logout(sessionId);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": `mb_session=; ${this.cookieFlags(req, "; Max-Age=0")}`,
    });
    res.end(JSON.stringify({ ok: true }));
  }

  // ── API Router ─────────────────────────────────────────────────

  private async routeApi(method: string, pathname: string, url: URL, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Auth management. Pairing rotation/revoke-all intentionally has no HTTP
    // route; it is an owner-only in-process action exposed by the Electron tray.
    if (pathname === "/mobile/auth/logout" && method === "POST") return this.handleLogout(req, res);

    // GET /mobile/api/v1/projects
    if (pathname === "/mobile/api/v1/projects" && method === "GET") return this.handleProjects(res);

    // GET /mobile/api/v1/projects/:projectId/sessions
    let m = matchRoute("/mobile/api/v1/projects/:projectId/sessions", pathname);
    if (m && method === "GET") return this.handleProjectSessions(m.projectId, res);

    // POST /mobile/api/v1/projects/:projectId/sessions  (create a new session in the project cwd)
    if (m && method === "POST") return this.handleCreateSession(m.projectId, res);

    // GET /mobile/api/v1/sessions/:sessionId/history
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/history", pathname);
    if (m && method === "GET") return this.handleHistory(m.sessionId, res);

    // GET /mobile/api/v1/sessions/:sessionId/state
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/state", pathname);
    if (m && method === "GET") return this.handleState(m.sessionId, res);

    // GET /mobile/api/v1/sessions/:sessionId/events (SSE)
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/events", pathname);
    if (m && method === "GET") return this.handleSSE(m.sessionId, req, res);

    // POST /mobile/api/v1/sessions/:sessionId/messages
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/messages", pathname);
    if (m && method === "POST") return this.handleSendMessage(m.sessionId, req, res);

    // POST /mobile/api/v1/sessions/:sessionId/ui-response
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/ui-response", pathname);
    if (m && method === "POST") return this.handleExtensionUiResponse(m.sessionId, req, res);

    // POST /mobile/api/v1/sessions/:sessionId/abort
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/abort", pathname);
    if (m && method === "POST") return this.handleAbort(m.sessionId, res);

    // GET /mobile/api/v1/sessions/:sessionId/models
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/models", pathname);
    if (m && method === "GET") return this.handleModels(m.sessionId, res);

    // POST /mobile/api/v1/sessions/:sessionId/model
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/model", pathname);
    if (m && method === "POST") return this.handleSetModel(m.sessionId, req, res);

    // GET/PUT /mobile/api/v1/archived-sessions  (proxy to pi-web)
    if (pathname === "/mobile/api/v1/archived-sessions" && (method === "GET" || method === "PUT")) {
      return this.handleArchivedSessions(method, req, res);
    }

    errorResponse(res, 404, "NOT_FOUND", `Unknown API path: ${pathname}`);
  }

  // ── Upstream Helpers ───────────────────────────────────────────

  private getPiWebBase(): string {
    const info = this.config.runtime.info;
    if (!info) throw Object.assign(new Error("pi-web not running"), { code: "BRIDGE_STARTING", status: 503 });
    return info.url;
  }

  private async piWebFetch(path: string, init?: RequestInit): Promise<Response> {
    const base = this.getPiWebBase();
    const url = `${base}${path}`;
    const res = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
    return res;
  }

  // Retry an idempotent *read* on transient 5xx / network errors. pi-web can
  // briefly contend on /api/sessions while finalizing a streaming run (session
  // file write vs list read), which used to bubble up as 502 and make the
  // mobile list flash "加载失败" — most visibly when returning from a chat that
  // was still streaming. 4xx (auth/client) and BRIDGE_STARTING are NOT retried.
  private async piWebFetchRetry(path: string, init?: RequestInit, attempts = 2): Promise<Response> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await this.piWebFetch(path, init);
        if (r.status < 500) return r;
        try { await r.body?.cancel(); } catch { /* release failed response */ }
        lastErr = Object.assign(new Error(`pi-web returned ${r.status}`), { status: r.status });
      } catch (e: any) {
        if (e?.code === "BRIDGE_STARTING") throw e; // startup race: don't spin
        lastErr = e;
      }
      if (i < attempts - 1) await new Promise((s) => setTimeout(s, 350));
    }
    throw lastErr;
  }

  // Mobile history keeps only renderer-visible fields; hidden reasoning,
  // signatures, media and tool bodies are bounded before crossing the tunnel.
  private slimMessages(messages: any[]): any[] {
    return Array.isArray(messages)
      ? messages.filter((message) => !isHiddenMobileMessage(message)).map(slimMobileMessage)
      : messages;
  }

  // ── Health ─────────────────────────────────────────────────────

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const info = this.config.runtime.info;
    if (!info) {
      jsonResponse(res, 200, { ok: false, reason: "pi-web not running" });
      return;
    }
    try {
      const upstream = await fetch(`${info.url}/api/home`, { signal: AbortSignal.timeout(3000) });
      jsonResponse(res, 200, { ok: upstream.ok, piWebPort: info.port });
    } catch {
      jsonResponse(res, 200, { ok: false, reason: "pi-web unreachable" });
    }
  }

  // ── Projects (grouped by cwd) ──────────────────────────────────

  private async handleProjects(res: http.ServerResponse): Promise<void> {
    try {
      const upstream = await this.piWebFetchRetry("/api/sessions");
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }
      const data = await upstream.json() as any;
      const sessions: any[] = data.sessions ?? [];
      const runningIds = new Set<string>(data.runningSessionIds ?? []);

      // Group by cwd
      const projectMap = new Map<string, { cwd: string; name: string; sessions: any[]; lastModified: string }>();
      for (const s of sessions) {
        const cwd = s.cwd ?? "unknown";
        if (!projectMap.has(cwd)) {
          projectMap.set(cwd, {
            cwd,
            name: path.basename(cwd) || cwd,
            sessions: [],
            lastModified: s.modified ?? s.created ?? "",
          });
        }
        const proj = projectMap.get(cwd)!;
        proj.sessions.push(s);
        if ((s.modified ?? "") > proj.lastModified) proj.lastModified = s.modified ?? "";
      }

      const projects = [...projectMap.entries()].map(([projectId, p]) => ({
        projectId,
        name: p.name,
        cwd: p.cwd,
        sessionCount: p.sessions.length,
        lastModified: p.lastModified,
        hasRunning: p.sessions.some((s) => runningIds.has(s.id)),
      }));

      // Sort by lastModified desc
      projects.sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? ""));

      jsonResponse(res, 200, { projects });
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── Sessions for a project ─────────────────────────────────────

  private async handleProjectSessions(projectId: string, res: http.ServerResponse): Promise<void> {
    try {
      const upstream = await this.piWebFetchRetry("/api/sessions");
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }
      const data = await upstream.json() as any;
      const sessions: any[] = data.sessions ?? [];
      const runningIds = new Set<string>(data.runningSessionIds ?? []);

      const filtered = sessions
        .filter((s) => (s.cwd ?? "unknown") === projectId)
        .filter((s) => !s.parentSessionId) // hide subagent child sessions
        .map((s) => {
          // pi-web >=0.8.0 auto-names sessions and exposes the title as `name` or `title`;
          // older versions only have `firstMessage`. Prefer the auto-generated title,
          // fall back to firstMessage, then null (client shows session id prefix).
          const autoTitle = typeof s.name === "string" && s.name.trim()
            ? s.name.trim()
            : typeof s.title === "string" && s.title.trim()
              ? s.title.trim()
              : "";
          const first = typeof s.firstMessage === "string" ? s.firstMessage.trim() : "";
          const rawTitle = autoTitle || first;
          const title = rawTitle ? (rawTitle.length > 48 ? rawTitle.slice(0, 48) + "…" : rawTitle) : null;
          const preview = rawTitle ? (rawTitle.length > 100 ? rawTitle.slice(0, 100) + "…" : rawTitle) : "";
          return {
            sessionId: s.id,
            projectId,
            name: title,
            preview,
            messageCount: s.messageCount ?? 0,
            created: s.created ?? "",
            modified: s.modified ?? "",
            running: runningIds.has(s.id),
          };
        })
        .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));

      if (filtered.length === 0 && !sessions.some((s) => (s.cwd ?? "unknown") === projectId)) {
        errorResponse(res, 404, "PROJECT_NOT_FOUND", `No sessions for project: ${projectId}`);
        return;
      }

      jsonResponse(res, 200, { sessions: filtered });
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── Create session (new chat in a project cwd) ───────────────

  private async handleCreateSession(projectId: string, res: http.ServerResponse): Promise<void> {
    try {
      // projectId is the project cwd. ensure_session spawns a fresh pi runtime
      // without sending a prompt; the phone sends the first message afterwards.
      const upstream = await this.piWebFetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectId, type: "ensure_session" }),
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        errorResponse(res, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502,
          "UPSTREAM_UNAVAILABLE", text || `pi-web returned ${upstream.status}`);
        return;
      }
      const data = await upstream.json() as any;
      if (!data?.sessionId) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", "pi-web did not return a sessionId");
        return;
      }
      jsonResponse(res, 200, { sessionId: data.sessionId, projectId });
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── History (8 MiB limit, deferThinking) ───────────────────────

  private async handleHistory(sessionId: string, res: http.ServerResponse): Promise<void> {
    try {
      // Retry on transient 5xx/network: mid-stream the deferred-thinking
      // history read can lose a race against the live session-file write.
      const upstream = await this.piWebFetchRetry(`/api/sessions/${encodeURIComponent(sessionId)}?deferThinking=1&deferMedia=1`);
      if (upstream.status === 404) {
        errorResponse(res, 404, "SESSION_NOT_FOUND", `Session ${sessionId} not found`);
        return;
      }
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }

      // Stream with 8 MiB limit
      const LIMIT = 8 * 1024 * 1024;
      const reader = upstream.body?.getReader();
      if (!reader) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", "No response body");
        return;
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > LIMIT) {
          reader.cancel();
          errorResponse(res, 413, "HISTORY_TOO_LARGE", "Session history exceeds 8 MiB limit");
          return;
        }
        chunks.push(value);
      }

      const raw = JSON.parse(new TextDecoder().decode(concatBuffers(chunks)));

      // Build filtered DTO. Slim the payload for mobile BEFORE sending: see
      // slimMessages() — this is what actually makes session switching fast on
      // weak links (the frontend only truncates at *render* time, the wire used
      // to carry full thinking/tool blobs).
      const allMessages = this.slimMessages(raw.context?.messages ?? []);
      const messages = allMessages.slice(-MOBILE_HISTORY_MESSAGES);
      const dto = {
        sessionId: raw.sessionId ?? sessionId,
        messages,
        model: raw.context?.model ?? null,
        thinkingLevel: raw.context?.thinkingLevel ?? null,
        truncated: messages.length < allMessages.length,
        totalMessageCount: raw.info?.messageCount ?? allMessages.length,
      };

      jsonResponse(res, 200, dto);
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      if (err.message === "INVALID_JSON") return errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", "Invalid JSON from pi-web");
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── State (filtered) ───────────────────────────────────────────

  private async handleState(sessionId: string, res: http.ServerResponse): Promise<void> {
    try {
      const upstream = await this.piWebFetch(`/api/sessions/${encodeURIComponent(sessionId)}/state`);
      if (upstream.status === 404) {
        errorResponse(res, 404, "SESSION_NOT_FOUND", `Session ${sessionId} not found`);
        return;
      }
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }
      const raw = await upstream.json() as any;

      // Filter: remove systemPrompt, sessionFile, queuedMessages, extensionStatuses
      const state = raw.state ?? {};
      // pi-web's top-level `running` means "agent process alive" (isAlive), which is
      // ALWAYS true for a persistent interactive session (e.g. the desktop TUI), even
      // while idle waiting for input. The phone needs "actively processing", which
      // mirrors the agent's isRunning(): alive && (promptRunning || streaming || compacting).
      // Without this, the periodic state poll would permanently report running=true and the
      // send button would be stuck on the stop icon.
      const activelyRunning = raw.running === true &&
        (state.isPromptRunning === true || state.isStreaming === true || state.isCompacting === true);
      const dto = {
        running: activelyRunning,
        isStreaming: state.isStreaming === true,
        isPromptRunning: state.isPromptRunning === true,
        isCompacting: state.isCompacting === true,
        model: state.model ?? null,
        thinkingLevel: state.thinkingLevel ?? null,
        contextUsage: state.contextUsage ?? null,
        messageCount: state.messageCount ?? 0,
        // Explicitly NOT forwarding: systemPrompt, sessionFile, queuedMessages, extensionStatuses
      };

      jsonResponse(res, 200, dto);
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── SSE Proxy ──────────────────────────────────────────────────

  private handleSSE(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    let piWebPort: number;
    try {
      const info = this.config.runtime.info;
      if (!info) throw new Error("pi-web not running");
      piWebPort = info.port;
    } catch {
      errorResponse(res, 503, "BRIDGE_STARTING", "pi-web not running");
      return;
    }

    const currentForSession = this.activeSSEBySession.get(sessionId) ?? 0;
    if (this.activeSSE.size >= 32 || currentForSession >= 4) {
      errorResponse(res, 429, "TOO_MANY_STREAMS", "Too many active event streams");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx/cloudflare hint
    });
    this.activeSSE.add(res);
    this.activeSSEBySession.set(sessionId, currentForSession + 1);
    const activeSSE = this.activeSSE;
    const activeSSEBySession = this.activeSSEBySession;
    const authSessionId = parseCookies(req)["mb_session"];

    // Send initial connected event
    res.write(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`);

    // Heartbeat every 20 seconds and revalidate auth so a connection cannot
    // outlive logout/revocation/the seven-day session expiry.
    // NOTE: we emit a real `ping` data event (NOT an SSE comment `:\n\n`).
    // Comments are silently discarded by EventSource, so the client could never
    // use them as a liveness signal — a half-open TCP path (common on mobile
    // NATs that drop idle mappings without a FIN/RST) would look "connected"
    // forever while no tokens flow. A parseable ping lets the client detect
    // silence and reconnect. It also keeps the Cloudflare edge from idling out.
    const heartbeat = setInterval(() => {
      if (!this.auth.validate(authSessionId)) {
        try {
          res.write(`data: ${JSON.stringify({ type: "error", code: "UNAUTHORIZED", message: "Mobile session expired", terminal: true })}\n\n`);
        } catch { /* client gone */ }
        cleanup();
        return;
      }
      try { res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`); } catch { /* client gone */ }
    }, 20_000);

    // Parse upstream SSE records so mobile receives compact deltas instead of
    // duplicate cumulative snapshots. Pure comment heartbeats are dropped; the
    // BFF's JSON ping above is the single phone-visible liveness signal.
    const decoder = new StringDecoder("utf8");
    let upstreamBuffer = "";
    const compactFrames = (chunk: Buffer | null): string[] => {
      upstreamBuffer += chunk ? decoder.write(chunk) : decoder.end();
      const output: string[] = [];
      while (true) {
        const separator = upstreamBuffer.match(/\r?\n\r?\n/);
        if (!separator || separator.index == null) break;
        const frame = upstreamBuffer.slice(0, separator.index);
        upstreamBuffer = upstreamBuffer.slice(separator.index + separator[0].length);
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try {
          const optimized = optimizeMobileSSEEvent(JSON.parse(data));
          if (optimized) output.push(`data: ${JSON.stringify(optimized)}\n\n`);
        } catch {
          output.push(`data: ${JSON.stringify({ type: "error", message: "Invalid upstream event" })}\n\n`);
        }
      }
      if (upstreamBuffer.length > 2 * 1024 * 1024) {
        upstreamBuffer = "";
        output.push(`data: ${JSON.stringify({ type: "error", message: "Upstream event exceeded buffer limit", terminal: true })}\n\n`);
      }
      return output;
    };

    // Connect to upstream SSE
    const upstreamReq = http.request(
      {
        hostname: "127.0.0.1",
        port: piWebPort,
        path: `/api/agent/${encodeURIComponent(sessionId)}/events`,
        method: "GET",
        headers: { Accept: "text/event-stream" },
      },
      (upstreamRes) => {
        clearTimeout(headerTimer); // headers arrived; long-lived stream takes over
        if (upstreamRes.statusCode !== 200) {
          const terminal = upstreamRes.statusCode === 401 || upstreamRes.statusCode === 404;
          res.write(`data: ${JSON.stringify({ type: "error", message: `upstream ${upstreamRes.statusCode}`, terminal })}\n\n`);
          cleanup();
          return;
        }
        upstreamRes.on("data", (chunk: Buffer) => {
          try {
            let blocked = false;
            for (const frame of compactFrames(chunk)) {
              if (!res.write(frame)) blocked = true;
            }
            if (blocked) {
              upstreamRes.pause();
              res.once("drain", () => { if (!cleaned) upstreamRes.resume(); });
            }
          } catch { cleanup(); }
        });
        upstreamRes.on("end", () => {
          for (const frame of compactFrames(null)) res.write(frame);
          res.write(`data: ${JSON.stringify({ type: "stream_end" })}\n\n`);
          cleanup();
        });
        upstreamRes.on("error", () => cleanup());
      }
    );

    upstreamReq.on("error", (err) => {
      clearTimeout(headerTimer);
      res.write(`data: ${JSON.stringify({ type: "error", message: "Upstream event connection failed" })}\n\n`);
      cleanup();
    });

    // Guard the header phase only: if pi-web never answers (stuck/crashing
    // without closing the socket), the native http.request would otherwise hang
    // until the OS default timeout (minutes), leaking a client connection and a
    // slot in activeSSE. 20s is generous for a loopback hop. Cleared the moment
    // headers arrive so a slow-but-streaming agent is never killed.
    const headerTimer = setTimeout(() => {
      try { upstreamReq.destroy(new Error("upstream header timeout")); } catch { /* ignore */ }
    }, 20_000);

    upstreamReq.end();

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      activeSSE.delete(res);
      const remaining = (activeSSEBySession.get(sessionId) ?? 1) - 1;
      if (remaining > 0) activeSSEBySession.set(sessionId, remaining);
      else activeSSEBySession.delete(sessionId);
      try { upstreamReq.destroy(); } catch { /* ignore */ }
      try { res.end(); } catch { /* ignore */ }
    }

    // NOTE: detect client disconnect via res "close", NOT req "close".
    // For a body-less GET (SSE), req emits "close" right after headers are read,
    // which would tear down the long-lived stream immediately. res "close" only
    // fires when the underlying connection actually closes (client left).
    res.on("close", cleanup);
  }

  // ── Send Message ───────────────────────────────────────────────

  private async handleSendMessage(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: any;
    try {
      const raw = await readBody(req, MOBILE_MAX_REQUEST_BYTES);
      body = parseJsonBody(raw);
    } catch (err: any) {
      if (err.message === "BODY_TOO_LARGE") return errorResponse(res, 413, "INVALID_REQUEST", "Message too large (max 10MB)");
      return errorResponse(res, 400, "INVALID_REQUEST", "Invalid JSON body");
    }

    const message = body?.message;
    if (typeof message !== "string") {
      errorResponse(res, 400, "INVALID_REQUEST", "Missing 'message' field");
      return;
    }
    if (Buffer.byteLength(message, "utf8") > MOBILE_MAX_MESSAGE_BYTES) {
      errorResponse(res, 413, "INVALID_REQUEST", "Message too large (max 64KB)");
      return;
    }

    const candidateImages = body?.images;
    if (candidateImages !== undefined && !Array.isArray(candidateImages)) {
      errorResponse(res, 400, "INVALID_REQUEST", "Images must be an array");
      return;
    }
    if (candidateImages && candidateImages.length > MOBILE_MAX_IMAGES) {
      errorResponse(res, 413, "INVALID_REQUEST", `Too many images (max ${MOBILE_MAX_IMAGES})`);
      return;
    }
    const images = candidateImages?.map((image: unknown) => {
      if (!image || typeof image !== "object") return null;
      const { type, data, mimeType } = image as { type?: unknown; data?: unknown; mimeType?: unknown };
      if (type !== "image" || typeof data !== "string" || typeof mimeType !== "string" || !MOBILE_IMAGE_MIME_TYPES.has(mimeType)) return null;
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) return null;
      const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
      const decodedBytes = (data.length / 4) * 3 - padding;
      return decodedBytes > 0 && decodedBytes <= MOBILE_MAX_IMAGE_BYTES ? { type: "image" as const, data, mimeType } : null;
    });
    if (images?.some((image: { type: "image"; data: string; mimeType: string } | null) => image === null)) {
      errorResponse(res, 400, "INVALID_REQUEST", "Invalid image attachment");
      return;
    }
    if (!message && !images?.length) {
      errorResponse(res, 400, "INVALID_REQUEST", "Message or image is required");
      return;
    }

    try {
      const upstream = await this.piWebFetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "prompt",
          message,
          ...(images?.length ? { images } : {}),
        }),
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        errorResponse(res, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502,
          "UPSTREAM_UNAVAILABLE", text || `pi-web returned ${upstream.status}`);
        return;
      }
      jsonResponse(res, 200, { ok: true });
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── Extension UI Response ──────────────────────────────────────

  private async handleExtensionUiResponse(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: any;
    try {
      body = parseJsonBody(await readBody(req, 32 * 1024));
    } catch (err: any) {
      if (err.message === "BODY_TOO_LARGE") return errorResponse(res, 413, "INVALID_REQUEST", "UI response too large (max 32KB)");
      return errorResponse(res, 400, "INVALID_REQUEST", "Invalid JSON body");
    }

    const id = body?.id;
    if (typeof id !== "string" || id.length < 1 || id.length > 128) {
      return errorResponse(res, 400, "INVALID_REQUEST", "Missing or invalid UI request id");
    }
    let response: Record<string, unknown>;
    if (typeof body.confirmed === "boolean") response = { confirmed: body.confirmed };
    else if (body.cancelled === true) response = { cancelled: true };
    else if (typeof body.value === "string" && body.value.length <= 8_000) response = { value: body.value };
    else return errorResponse(res, 400, "INVALID_REQUEST", "Missing or invalid UI response value");

    try {
      const upstream = await this.piWebFetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "extension_ui_response", id, ...response }),
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        return errorResponse(res, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502,
          "UPSTREAM_UNAVAILABLE", text || `pi-web returned ${upstream.status}`);
      }
      jsonResponse(res, 200, { ok: true });
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── Abort ──────────────────────────────────────────────────────

  private async handleAbort(sessionId: string, res: http.ServerResponse): Promise<void> {
    try {
      const upstream = await this.piWebFetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "abort" }),
      });
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }
      jsonResponse(res, 200, { ok: true });
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── Models ────────────────────────────────────────────────────

  private async handleModels(sessionId: string, res: http.ServerResponse): Promise<void> {
    try {
      // First get session cwd to pass to models endpoint
      const sessionRes = await this.piWebFetch(`/api/sessions/${encodeURIComponent(sessionId)}/state`);
      let cwd = "";
      if (sessionRes.ok) {
        const stateData = await sessionRes.json() as any;
        cwd = stateData.state?.cwd ?? "";
      }

      const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const upstream = await this.piWebFetch(`/api/models${query}`);
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }
      const raw = await upstream.json() as any;

      const dto = {
        models: (raw.modelList ?? []).map((m: any) => ({
          id: m.id,
          name: m.name ?? m.id,
          provider: m.provider,
        })),
        defaultModel: raw.defaultModel ?? null,
        thinkingLevels: raw.thinkingLevels ?? {},
      };

      jsonResponse(res, 200, dto);
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── Set Model ──────────────────────────────────────────────────

  private async handleSetModel(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: any;
    try {
      const raw = await readBody(req, 1024);
      body = parseJsonBody(raw);
    } catch (err: any) {
      if (err?.message === "BODY_TOO_LARGE") return errorResponse(res, 413, "BODY_TOO_LARGE", "Request body exceeds limit");
      errorResponse(res, 400, "INVALID_REQUEST", "Invalid JSON body");
      return;
    }

    const provider = body?.provider;
    const modelId = body?.modelId;
    if (typeof provider !== "string" || typeof modelId !== "string") {
      errorResponse(res, 400, "INVALID_REQUEST", "Missing 'provider' or 'modelId'");
      return;
    }

    try {
      const upstream = await this.piWebFetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set_model", provider, modelId }),
      });
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }
      jsonResponse(res, 200, { ok: true });
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  private async handleArchivedSessions(method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (method === "GET") {
        const upstream = await this.piWebFetch("/api/archived-sessions");
        if (!upstream.ok) return errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        const data = await upstream.json();
        return jsonResponse(res, 200, data);
      }
      // PUT
      let raw: Buffer;
      try { raw = await readBody(req, 1024 * 64); }
      catch (err: any) {
        if (err?.message === "BODY_TOO_LARGE") return errorResponse(res, 413, "BODY_TOO_LARGE", "Request body too large");
        return errorResponse(res, 400, "INVALID_REQUEST", "Failed to read body");
      }
      const upstream = await this.piWebFetch("/api/archived-sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: raw.toString("utf-8"),
      });
      if (!upstream.ok) return errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
      const data = await upstream.json();
      jsonResponse(res, 200, data);
    } catch (err: any) {
      if (err.code === "BRIDGE_STARTING") return errorResponse(res, 503, err.code, err.message);
      errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", err.message);
    }
  }

  // ── Static File Serving ────────────────────────────────────────

  private serveStatic(res: http.ServerResponse, relPath: string): void {
    // Prevent path traversal
    const safe = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(this.config.staticDir, safe);

    if (!filePath.startsWith(this.config.staticDir)) {
      errorResponse(res, 403, "FORBIDDEN", "Path traversal detected");
      return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // SPA fallback: serve index.html for unknown paths
      const indexPath = path.join(this.config.staticDir, "index.html");
      if (fs.existsSync(indexPath)) {
        return this.sendFile(res, indexPath, "text/html; charset=utf-8");
      }
      errorResponse(res, 404, "NOT_FOUND", "Static file not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".webmanifest": "application/manifest+json",
    };
    const mime = mimeMap[ext] ?? "application/octet-stream";

    // The app shell (HTML, service worker, manifest) must NEVER be cached by
    // the browser or by Cloudflare, otherwise updates would require the user to
    // clear cache. `no-store` is the strongest signal: Cloudflare passes it
    // through and does not store the resource, and the SW self-update flow in
    // index.html/sw.js then applies new versions automatically. Other assets
    // (icons) can be cached for an hour.
    const isShell = ext === ".html" || ext === ".webmanifest" ||
      relPath.endsWith("sw.js") || relPath.endsWith("manifest.json");
    const cacheControl = isShell ? "no-store, no-cache, must-revalidate" : "public, max-age=3600";
    this.sendFile(res, filePath, mime, cacheControl);
  }

  private sendFile(res: http.ServerResponse, filePath: string, mime: string, cacheControl = "no-store"): void {
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": cacheControl,
        "Content-Length": content.length,
      });
      res.end(content);
    } catch {
      errorResponse(res, 500, "INTERNAL_ERROR", "Failed to read static file");
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────────────

function concatBuffers(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.byteLength;
  }
  return result;
}
