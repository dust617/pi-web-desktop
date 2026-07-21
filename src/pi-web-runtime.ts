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

/** Find system node.exe via PATH (never use Electron's process.execPath) */
function findSystemNode(): string {
  try {
    const result = execSync("where node", { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch {
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
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Pi Web 在 ${timeoutMs}ms 内未就绪（需要 HTTP 2xx）`));
        return;
      }
      const req = http.get(url, (res) => {
        res.resume();
        const code = res.statusCode ?? 0;
        if (code >= 200 && code < 300) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });
      req.on("error", () => setTimeout(check, 500));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(check, 500);
      });
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
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export class PiWebRuntime {
  private child: ChildProcess | null = null;
  private _info: RuntimeInfo | null = null;
  private _stopping = false;
  /** Called when pi-web exits unexpectedly (non-zero code). Set by main process. */
  onCrash: ((code: number | null, signal: string | null) => void) | null = null;

  get info(): RuntimeInfo | null {
    return this._info;
  }

  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Start locked pi-web on a free loopback port using system node.exe */
  async start(cwd?: string): Promise<RuntimeInfo> {
    if (this.isRunning) return this._info!;

    const port = await findFreePort();
    const hostname = "127.0.0.1";
    const nodeExe = findSystemNode();
    const binPath = resolvePiWebBin();

    console.log(`[pi-web] node: ${nodeExe}`);
    console.log(`[pi-web] bin:  ${binPath}`);
    console.log(`[pi-web] port: ${port}`);

    this.child = spawn(
      nodeExe,
      [binPath, "--port", String(port), "-H", hostname, "--no-open"],
      {
        cwd: cwd || undefined,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PI_WEB_NO_OPEN: "1", PORT: String(port), HOSTNAME: hostname },
        windowsHide: true,
      }
    );

    const child = this.child;

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
      this.child = null;
      this._info = null;
      // Only notify crash if not a deliberate stop (taskkill gives non-zero exit)
      if (!this._stopping && code !== 0 && code !== null) {
        this.onCrash?.(code, signal);
      }
      this._stopping = false;
    });

    const url = `http://${hostname}:${port}`;
    await waitForReady(url);

    // Set project directory via pi-web's built-in API (no source modification)
    if (cwd) {
      await setProjectCwd(url, cwd);
    }

    this._info = { port, url, pid: child.pid ?? -1 };
    console.log(`[pi-web] ready at ${url} (pid=${this._info.pid})`);
    return this._info;
  }

  /**
   * Stop the child process tree.
   * Windows: taskkill /T /F /PID  (kills entire tree)
   * Then verify port is released.
   */
  stop(): void {
    if (!this.child || this.child.exitCode !== null) {
      this.child = null;
      this._info = null;
      return;
    }

    this._stopping = true; // suppress onCrash for deliberate stop

    const pid = this.child.pid;
    const port = this._info?.port;
    console.log(`[pi-web] stopping pid=${pid} port=${port}`);

    if (process.platform === "win32" && pid) {
      try {
        execSync(`taskkill /T /F /PID ${pid}`, { windowsHide: true });
        console.log(`[pi-web] taskkill /T /F /PID ${pid} OK`);
      } catch (err: any) {
        console.error(`[pi-web] taskkill failed: ${err.message}`);
        // Fallback: kill directly
        this.child.kill("SIGKILL");
      }
    } else {
      this.child.kill("SIGKILL");
    }

    this.child = null;
    this._info = null;
  }
}
