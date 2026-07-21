/**
 * Pi Web Runtime Manager
 * Spawns and manages the Pi Web (Next.js) child process on a dynamic loopback port.
 */
import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as http from "http";
import * as path from "path";

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

/** Resolve the pi-web bin script path from global npm installation */
function resolvePiWebBin(): string {
  // Try global npm modules path
  const globalRoot = path.join(
    process.env.APPDATA || path.join(process.env.HOME || "", "AppData", "Roaming"),
    "npm",
    "node_modules",
    "@agegr",
    "pi-web",
    "bin",
    "pi-web.js"
  );
  return globalRoot;
}

/** Wait until the HTTP endpoint returns 200 */
export function waitForReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Pi Web did not become ready within ${timeoutMs}ms`));
        return;
      }
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
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

export class PiWebRuntime {
  private child: ChildProcess | null = null;
  private _info: RuntimeInfo | null = null;

  get info(): RuntimeInfo | null {
    return this._info;
  }

  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Start Pi Web on a free loopback port. Resolves when HTTP is ready. */
  async start(): Promise<RuntimeInfo> {
    if (this.isRunning) {
      return this._info!;
    }

    const port = await findFreePort();
    const hostname = "127.0.0.1";
    const binPath = resolvePiWebBin();

    this.child = spawn(process.execPath, [binPath, "-p", String(port), "-H", hostname, "--no-open"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_WEB_NO_OPEN: "1" },
      windowsHide: true,
    });

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
    });

    const url = `http://${hostname}:${port}`;
    await waitForReady(url);

    this._info = { port, url, pid: child.pid ?? -1 };
    console.log(`[pi-web] ready at ${url} (pid=${this._info.pid})`);
    return this._info;
  }

  /** Gracefully stop the child process */
  stop(): void {
    if (this.child && this.child.exitCode === null) {
      console.log("[pi-web] stopping...");
      this.child.kill("SIGTERM");
      // Force kill after 5s
      const child = this.child;
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }
    this.child = null;
    this._info = null;
  }
}
