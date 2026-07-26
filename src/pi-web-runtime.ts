/**
 * Pi Web Runtime Manager
 * Spawns the LOCKED pi-web copy (resources/pi-web/) using SYSTEM node.exe.
 * Never uses process.execPath (Electron binary) to run pi-web.
 */
import { spawn, execSync, ChildProcess } from "child_process";
import * as net from "net";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";

export interface RuntimeInfo {
  port: number;
  url: string;
  pid: number;
}

/** Find a free TCP port on 127.0.0.1 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not determine port")));
      }
    });
    srv.on("error", reject);
  });
}

/** Minimum Node.js version required by pi-web 0.8.1+ */
const MIN_NODE_VERSION = "22.19.0";

/** Parse a Node.js version string into [major, minor, patch] */
function parseNodeVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Check if a Node.js version meets the minimum requirement */
function isNodeVersionSupported(version: string): boolean {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(MIN_NODE_VERSION);
  if (!current || !minimum) return false;
  for (let i = 0; i < minimum.length; i++) {
    if (current[i] > minimum[i]) return true;
    if (current[i] < minimum[i]) return false;
  }
  return true;
}

/** Find system node.exe via PATH (never use Electron's process.execPath) */
function findSystemNode(): string {
  try {
    const result = execSync("where node", { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) {
      // Verify Node.js version meets minimum requirement
      const versionOutput = execSync(`"${result}" --version`, { encoding: "utf8" }).trim();
      const version = versionOutput.replace(/^v/, "");
      if (!isNodeVersionSupported(version)) {
        throw new Error(
          `Node.js 版本过低：当前 ${version}，需要 >=${MIN_NODE_VERSION}。\n` +
          `请升级 Node.js：https://nodejs.org/`
        );
      }
      return result;
    }
  } catch (err: any) {
    if (err.message?.includes("Node.js 版本过低")) throw err;
    // fall through
  }
  throw new Error("找不到系统 node.exe，请确认 Node.js 已安装并在 PATH 中。");
}

/** Path to the locked pi-web bin inside resources/ */
function resolvePiWebBin(): string {
  // resources/pi-web/bin/pi-web.js relative to this compiled file (dist/)
  const binPath = path.join(__dirname, "..", "resources", "pi-web", "bin", "pi-web.js");
  if (!fs.existsSync(binPath)) {
    throw new Error(`找不到锁定的 pi-web：${binPath}\n请先将 pi-web 复制到 resources/pi-web/`);
  }
  return binPath;
}

/** Wait until HTTP returns 2xx (strict: not <500, must be 200-299) */
export function waitForReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let retryTimer: NodeJS.Timeout | null = null;

    const finishError = () => {
      if (settled) return;
      settled = true;
      if (retryTimer) clearTimeout(retryTimer);
      reject(new Error(`Pi Web 在 ${timeoutMs}ms 内未就绪（需要 HTTP 2xx）`));
    };
    const scheduleRetry = () => {
      if (settled || retryTimer) return;
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) return finishError();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        check();
      }, Math.min(500, remaining));
    };
    const check = () => {
      if (settled) return;
      if (Date.now() - start >= timeoutMs) return finishError();
      const req = http.get(url, (res) => {
        const code = res.statusCode ?? 0;
        res.resume();
        if (code >= 200 && code < 300) {
          settled = true;
          if (retryTimer) clearTimeout(retryTimer);
          resolve();
        } else {
          res.once("end", scheduleRetry);
        }
      });
      req.once("error", scheduleRetry);
      // Destroying emits error; that single path schedules the next probe. Bound
      // the final probe by the global deadline instead of always adding 2s.
      const remaining = Math.max(1, timeoutMs - (Date.now() - start));
      req.setTimeout(Math.min(2000, remaining), () => req.destroy(new Error("readiness probe timed out")));
    };
    check();
  });
}

/** Set pi-web project directory via its built-in API (no source modification needed) */
export function setProjectCwd(baseUrl: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ cwd });
    const req = http.request(
      `${baseUrl}/api/cwd/validate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log(`[pi-web] project cwd set: ${cwd}`);
            resolve();
          } else {
            reject(new Error(`setProjectCwd failed HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.setTimeout(15000, () => req.destroy(new Error("setProjectCwd timed out")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export class PiWebRuntime {
  private child: ChildProcess | null = null;
  private _info: RuntimeInfo | null = null;
  private startPromise: Promise<RuntimeInfo> | null = null;
  private startGeneration = 0;
  private readonly stoppingChildren = new WeakSet<ChildProcess>();
  private readonly publishedChildren = new WeakSet<ChildProcess>();
  /** Called when a ready pi-web process exits unexpectedly. */
  onCrash: ((code: number | null, signal: string | null) => void) | null = null;

  get info(): RuntimeInfo | null {
    return this._info;
  }

  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  /** Start locked pi-web on a free loopback port using system node.exe. */
  async start(cwd?: string): Promise<RuntimeInfo> {
    if (this.isRunning && this._info) return this._info;
    if (this.startPromise) return this.startPromise;

    const generation = ++this.startGeneration;
    const pending = this.startInternal(cwd, generation);
    this.startPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  private async startInternal(cwd: string | undefined, generation: number): Promise<RuntimeInfo> {
    const port = await findFreePort();
    if (generation !== this.startGeneration) throw new Error("Pi Web startup was cancelled");

    const hostname = "127.0.0.1";
    const nodeExe = findSystemNode();
    const binPath = resolvePiWebBin();

    console.log(`[pi-web] node: ${nodeExe}`);
    console.log(`[pi-web] bin:  ${binPath}`);
    console.log(`[pi-web] port: ${port}`);

    const child = spawn(
      nodeExe,
      [binPath, "--port", String(port), "-H", hostname, "--no-open"],
      {
        cwd: cwd || undefined,
        stdio: ["ignore", "pipe", "pipe"],
        // pi-web 0.8.1+ uses PI_WEB_HOSTNAME instead of HOSTNAME to avoid
        // pollution from the system HOSTNAME env var.
        env: { ...process.env, PI_WEB_NO_OPEN: "1", PORT: String(port), PI_WEB_HOSTNAME: hostname },
        windowsHide: true,
      }
    );
    this.child = child;

    let rejectStartup: (reason: Error) => void = () => {};
    const startupFailure = new Promise<never>((_resolve, reject) => {
      rejectStartup = reject;
    });

    child.once("error", (err) => {
      rejectStartup(new Error(`Failed to start Pi Web: ${err.message}`));
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[pi-web] ${text}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[pi-web:err] ${text}`);
    });

    child.on("exit", (code, signal) => {
      console.log(`[pi-web] exited code=${code} signal=${signal}`);
      const wasDeliberate = this.stoppingChildren.has(child);
      const wasPublished = this.publishedChildren.has(child);
      this.stoppingChildren.delete(child);
      this.publishedChildren.delete(child);
      if (this.child === child) {
        this.child = null;
        this._info = null;
      }
      if (!wasPublished) {
        rejectStartup(new Error(`Pi Web exited during startup (code=${code}, signal=${signal})`));
      } else if (!wasDeliberate) {
        this.onCrash?.(code, signal);
      }
    });

    const url = `http://${hostname}:${port}`;
    try {
      await Promise.race([waitForReady(url), startupFailure]);
      if (cwd) {
        // Non-fatal: pi-web >=0.8.0 sets the project dir via the ?cwd= URL
        // parameter (see getProjectUrl), and the legacy /api/cwd/validate
        // endpoint may change or disappear across versions. A failure here must
        // NOT abort startup — the URL parameter is the source of truth.
        try {
          await Promise.race([setProjectCwd(url, cwd), startupFailure]);
        } catch (cwdErr) {
          console.warn(
            `[pi-web] setProjectCwd failed (non-fatal, relying on ?cwd= URL param): ${
              cwdErr instanceof Error ? cwdErr.message : String(cwdErr)
            }`
          );
        }
      }

      if (
        generation !== this.startGeneration ||
        this.child !== child ||
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        throw new Error("Pi Web startup was cancelled or the process exited");
      }

      this.publishedChildren.add(child);
      this._info = { port, url, pid: child.pid ?? -1 };
      console.log(`[pi-web] ready at ${url} (pid=${this._info.pid})`);
      return this._info;
    } catch (err) {
      this.stoppingChildren.add(child);
      this.terminateChild(child);
      if (this.child === child) {
        this.child = null;
        this._info = null;
      }
      throw err;
    }
  }

  private terminateChild(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const pid = child.pid;
    if (process.platform === "win32" && pid) {
      try {
        execSync(`taskkill /T /F /PID ${pid}`, { windowsHide: true });
        console.log(`[pi-web] taskkill /T /F /PID ${pid} OK`);
        return;
      } catch (err: any) {
        console.error(`[pi-web] taskkill failed: ${err.message}`);
      }
    }
    try { child.kill("SIGKILL"); } catch {}
  }

  /** Stop the child process tree and invalidate any startup still in progress. */
  stop(): void {
    this.startGeneration += 1;
    this.startPromise = null;

    const child = this.child;
    if (!child) {
      this._info = null;
      return;
    }

    this.stoppingChildren.add(child);
    console.log(`[pi-web] stopping pid=${child.pid} port=${this._info?.port}`);
    this.terminateChild(child);

    if (this.child === child) {
      this.child = null;
      this._info = null;
    }
  }
}
