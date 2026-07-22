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
import type { PiWebRuntime } from "./pi-web-runtime";

// ─── Types ───────────────────────────────────────────────────────────

export interface MobileBridgeConfig {
  /** Fixed loopback port (default 62810). */
  port?: number;
  /** Path to PWA static files (default resources/mobile/). */
  staticDir?: string;
  /** Reference to the PiWebRuntime for dynamic port discovery. */
  runtime: PiWebRuntime;
  /** Allowed origins for mutation requests (e.g. ["https://mobile.tt56677.top"]). */
  allowedOrigins?: string[];
  /** File path to persist mobile login sessions (survives BFF restart). */
  sessionStorePath?: string;
}

/** Built-in public origin for this project's tunnel hostname. */
export const DEFAULT_MOBILE_ORIGIN = "https://mobile.tt56677.top";

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

  /** Check rate limit (5 attempts per minute per IP). Returns true if allowed. */
  checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      this.loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count++;
    return entry.count <= 5;
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

  constructor(config: MobileBridgeConfig) {
    this.config = {
      port: config.port ?? 62810,
      staticDir: config.staticDir ?? path.join(__dirname, "..", "resources", "mobile"),
      runtime: config.runtime,
      allowedOrigins: config.allowedOrigins ?? [],
      sessionStorePath: config.sessionStorePath ?? "",
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
      srv.listen(this.config.port, "127.0.0.1", () => {
        this.server = srv;
        console.log(`[mobile-bridge] listening on 127.0.0.1:${this.config.port}`);
        console.log(`[mobile-bridge] pairing code: ${this.auth.code}`);
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

      // Diagnostic access log (temporary): capture origin + status for every
      // request so mobile send-failures can be traced to the exact response code.
      if (pathname.startsWith("/mobile/api/") || pathname.startsWith("/mobile/auth/")) {
        const _start = Date.now();
        const _origin = req.headers.origin ?? "-";
        const _cookie = req.headers.cookie ? "cookie" : "nocookie";
        res.on("finish", () => {
          console.log(`[req] ${method} ${pathname} origin=${_origin} ${_cookie} -> ${res.statusCode} (${Date.now() - _start}ms)`);
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
    // Always allow loopback
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
    // Match configured origins by host, accepting both http and https schemes so
    // the Cloudflare front-end works whether the phone loads http:// or https://.
    // CSRF protection still holds: an attacker's site has a different host and is
    // rejected regardless of scheme.
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    return this.config.allowedOrigins.some((o) => {
      try {
        return new URL(o).host === host;
      } catch {
        return false;
      }
    });
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
    // Origin check on mutations: a missing Origin is also rejected (depth-in-
    // defence; the PWA always sends Origin on same-origin POST, and SameSite=Strict
    // already blocks cross-site browser POSTs). Audit P0-2 / test matrix 7.1.
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.origin ?? "";
      if (!this.isAllowedOrigin(origin)) {
        errorResponse(res, 403, "FORBIDDEN", "Origin not allowed");
        return false;
      }
    }
    return true;
  }

  // ── Auth Handlers ──────────────────────────────────────────────

  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const ip = req.socket.remoteAddress ?? "unknown";
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

    // POST /mobile/api/v1/sessions/:sessionId/abort
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/abort", pathname);
    if (m && method === "POST") return this.handleAbort(m.sessionId, res);

    // GET /mobile/api/v1/sessions/:sessionId/models
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/models", pathname);
    if (m && method === "GET") return this.handleModels(m.sessionId, res);

    // POST /mobile/api/v1/sessions/:sessionId/model
    m = matchRoute("/mobile/api/v1/sessions/:sessionId/model", pathname);
    if (m && method === "POST") return this.handleSetModel(m.sessionId, req, res);

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
      const upstream = await this.piWebFetch("/api/sessions");
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
      const upstream = await this.piWebFetch("/api/sessions");
      if (!upstream.ok) {
        errorResponse(res, 502, "UPSTREAM_UNAVAILABLE", `pi-web returned ${upstream.status}`);
        return;
      }
      const data = await upstream.json() as any;
      const sessions: any[] = data.sessions ?? [];
      const runningIds = new Set<string>(data.runningSessionIds ?? []);

      const filtered = sessions
        .filter((s) => (s.cwd ?? "unknown") === projectId)
        .map((s) => {
          // pi-web exposes the session's first user message as `firstMessage`;
          // use it as the human-readable title (truncated), falling back to null
          // so the client shows the session id prefix.
          const first = typeof s.firstMessage === "string" ? s.firstMessage.trim() : "";
          const title = first ? (first.length > 48 ? first.slice(0, 48) + "…" : first) : null;
          return {
            sessionId: s.id,
            projectId,
            name: title,
            preview: first ? (first.length > 100 ? first.slice(0, 100) + "…" : first) : "",
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

  // ── History (8 MiB limit, deferThinking) ───────────────────────

  private async handleHistory(sessionId: string, res: http.ServerResponse): Promise<void> {
    try {
      const upstream = await this.piWebFetch(`/api/sessions/${encodeURIComponent(sessionId)}?deferThinking=1`);
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

      // Build filtered DTO
      const messages = raw.context?.messages ?? [];
      const dto = {
        sessionId: raw.sessionId ?? sessionId,
        messages,
        model: raw.context?.model ?? null,
        thinkingLevel: raw.context?.thinkingLevel ?? null,
        truncated: false,
        totalMessageCount: raw.info?.messageCount ?? messages.length,
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
      // Without this, the 5s state poll would permanently report running=true and the
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

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx/cloudflare hint
    });
    this.activeSSE.add(res);
    const authSessionId = parseCookies(req)["mb_session"];

    // Send initial connected event
    res.write(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`);

    // Heartbeat every 20 seconds and revalidate auth so a connection cannot
    // outlive logout/revocation/the seven-day session expiry.
    const heartbeat = setInterval(() => {
      if (!this.auth.validate(authSessionId)) {
        try {
          res.write(`data: ${JSON.stringify({ type: "error", code: "UNAUTHORIZED", message: "Mobile session expired", terminal: true })}\n\n`);
        } catch { /* client gone */ }
        cleanup();
        return;
      }
      try { res.write(":\n\n"); } catch { /* client gone */ }
    }, 20_000);

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
        if (upstreamRes.statusCode !== 200) {
          const terminal = upstreamRes.statusCode === 401 || upstreamRes.statusCode === 404;
          res.write(`data: ${JSON.stringify({ type: "error", message: `upstream ${upstreamRes.statusCode}`, terminal })}\n\n`);
          cleanup();
          return;
        }
        upstreamRes.on("data", (chunk: Buffer) => {
          try { res.write(chunk); } catch { /* client gone */ }
        });
        upstreamRes.on("end", () => {
          res.write(`data: ${JSON.stringify({ type: "stream_end" })}\n\n`);
          cleanup();
        });
        upstreamRes.on("error", () => cleanup());
      }
    );

    upstreamReq.on("error", (err) => {
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
      cleanup();
    });

    upstreamReq.end();

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      try { upstreamReq.destroy(); } catch { /* ignore */ }
      try { res.end(); } catch { /* ignore */ }
    }

    // NOTE: detect client disconnect via res "close", NOT req "close".
    // For a body-less GET (SSE), req emits "close" right after headers are read,
    // which would tear down the long-lived stream immediately. res "close" only
    // fires when the underlying connection actually closes (client left).
    res.on("close", () => {
      this.activeSSE.delete(res);
      cleanup();
    });
  }

  // ── Send Message ───────────────────────────────────────────────

  private async handleSendMessage(sessionId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: any;
    try {
      const raw = await readBody(req, 64 * 1024);
      body = parseJsonBody(raw);
    } catch (err: any) {
      if (err.message === "BODY_TOO_LARGE") return errorResponse(res, 413, "INVALID_REQUEST", "Message too large (max 64KB)");
      return errorResponse(res, 400, "INVALID_REQUEST", "Invalid JSON body");
    }

    const message = body?.message;
    if (typeof message !== "string" || message.length === 0) {
      errorResponse(res, 400, "INVALID_REQUEST", "Missing or empty 'message' field");
      return;
    }

    try {
      const upstream = await this.piWebFetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "prompt", message }),
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
