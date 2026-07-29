/**
 * FrpcGuardian - frpc 隧道守护
 *
 * 以 pi-web 桌面端为主进程，管理 frpc 子进程生命周期：
 * - 基于 ManagedProcess 的有界退避重启 (3s → 8s → 15s → 30s → 60s)
 * - 滑动窗口崩溃断路器 (10 分钟内最多 5 次重启 → blocked)
 * - 稳定运行 10 分钟后自动重置退避计数
 * - 接管时自动清理外部 frpc 实例（计划任务残留）
 * - 周期性健康巡检
 */

import { ManagedProcess } from "./managed-process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import * as path from "path";
import * as os from "os";

export type GuardianState =
  | "stopped"      // 未启动
  | "starting"     // 正在启动
  | "running"      // 正常运行
  | "restarting"   // 退避重启中
  | "blocked"      // 崩溃循环，已熔断
  | "error";       // 配置错误等不可恢复问题

export interface GuardianStatus {
  state: GuardianState;
  pid: number | null;
  restartCount: number;
  lastError: string | null;
  uptimeMs: number | null;
}

const STATE_LABELS: Record<GuardianState, string> = {
  stopped: "已停止",
  starting: "启动中…",
  running: "运行中",
  restarting: "重启中…",
  blocked: "已熔断 (崩溃循环)",
  error: "配置错误",
};

export function guardianStateLabel(state: GuardianState): string {
  return STATE_LABELS[state] ?? state;
}

export function formatUptime(ms: number | null): string {
  if (ms == null) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}小时${rm}分` : `${h}小时`;
}

export class FrpcGuardian extends EventEmitter {
  private process: ManagedProcess | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private state: GuardianState = "stopped";
  private startedAt: number | null = null;
  private enabled = false;

  readonly frpcDir: string;
  private readonly frpcExe: string;
  private readonly frpcConfig: string;

  constructor(frpcDir?: string) {
    super();
    this.frpcDir = frpcDir ?? path.join(os.homedir(), "frp");
    this.frpcExe = path.join(this.frpcDir, "frpc.exe");
    this.frpcConfig = path.join(this.frpcDir, "frpc.toml");
  }

  /** frpc.exe 和 frpc.toml 是否都存在 */
  isConfigured(): boolean {
    return existsSync(this.frpcExe) && existsSync(this.frpcConfig);
  }

  /**
   * 启动守护。如果外部有残留 frpc 进程（计划任务），先清理再接管。
   */
  async start(): Promise<void> {
    if (!this.isConfigured()) {
      this.setState("error");
      throw new Error(`frpc 未配置: 缺少 ${this.frpcExe} 或 ${this.frpcConfig}`);
    }

    if (this.state === "running" || this.state === "starting") return;

    this.enabled = true;
    this.killExternalFrpc();
    this.setState("starting");

    this.process = new ManagedProcess({
      command: this.frpcExe,
      args: ["-c", this.frpcConfig],
      name: "frpc-guardian",
      startTimeoutMs: 20_000,
      stopTimeoutMs: 5_000,
      autoRestart: true,
      // frpc 自身管理连接心跳，进程存活即视为就绪
      readinessCheck: async () => this.process?.isAlive() ?? false,
      readinessIntervalMs: 500,
      readinessTimeoutMs: 15_000,
      // 退避梯度
      restartDelaysMs: [3_000, 8_000, 15_000, 30_000, 60_000],
      // 10 分钟内最多 5 次重启，超出则熔断
      restartWindowMs: 10 * 60 * 1000,
      maxRestartsInWindow: 5,
    });

    // ── 事件转发 ──
    this.process.on("stateChange", ({ to }: { to: string }) => {
      if (to === "running") {
        this.startedAt = Date.now();
        this.setState("running");
      } else if (to === "blocked") {
        this.setState("blocked");
      }
    });

    this.process.on("restarting", ({ delay, restartCount }: { delay: number; restartCount: number }) => {
      this.setState("restarting");
      this.log(`退避重启: ${Math.round(delay / 1000)}秒后第 ${restartCount} 次尝试`);
    });

    this.process.on("crashLoop", ({ restartCount }: { restartCount: number }) => {
      this.setState("blocked");
      this.log(`⚠ 崩溃循环熔断: ${restartCount} 次重启后停止，请手动检查`);
    });

    this.process.on("stdout", ({ data }: { data: string }) => {
      for (const line of data.split(/\r?\n/)) {
        if (line.trim()) this.log(line.trim());
      }
    });
    this.process.on("stderr", ({ data }: { data: string }) => {
      for (const line of data.split(/\r?\n/)) {
        if (line.trim()) this.log(line.trim());
      }
    });

    // ── 启动（不 throw，让 ManagedProcess 自动退避重试）──
    try {
      await this.process.start();
      this.startedAt = Date.now();
      this.setState("running");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`首次启动失败: ${msg}，等待自动重试…`);
      const st = this.process.getStatus();
      if (st.state === "blocked") this.setState("blocked");
      else this.setState("restarting");
    }

    this.startHealthCheck();
  }

  /** 停止守护并终止 frpc 子进程 */
  async stop(): Promise<void> {
    this.enabled = false;
    this.stopHealthCheck();

    if (this.process) {
      await this.process.stop();
      this.process = null;
    }

    this.startedAt = null;
    this.setState("stopped");
  }

  /** 重启（stop + start） */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** 熔断后手动解除并重试 */
  async unblockAndRestart(): Promise<void> {
    if (this.process) {
      this.process.unblock();
      await this.process.stop();
      this.process = null;
    }
    await this.start();
  }

  getStatus(): GuardianStatus {
    const ps = this.process?.getStatus();
    return {
      state: this.state,
      pid: ps?.pid ?? null,
      restartCount: ps?.restartCount ?? 0,
      lastError: ps?.lastError ?? null,
      uptimeMs: this.startedAt != null ? Date.now() - this.startedAt : null,
    };
  }

  // ─── 内部 ────────────────────────────────────────────────────────

  /** 清理外部 frpc 进程（计划任务 / 手动启动的残留） */
  private killExternalFrpc(): void {
    try {
      const out = execSync('tasklist /fi "imagename eq frpc.exe" /fo csv /nh', {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5_000,
      });
      if (out.includes("frpc.exe")) {
        this.log("检测到外部 frpc 进程，正在接管…");
        execSync("taskkill /f /im frpc.exe", { windowsHide: true, timeout: 5_000 });
        // 等 1 秒让端口释放
        execSync("ping -n 2 127.0.0.1 >nul", { windowsHide: true, timeout: 5_000 });
      }
    } catch {
      // 没有外部进程或 kill 失败，继续
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthTimer = setInterval(() => {
      if (!this.enabled || !this.process) return;
      const ps = this.process.getStatus();
      if (ps.state === "blocked" && this.state !== "blocked") {
        this.setState("blocked");
      } else if (ps.state === "running" && this.state !== "running") {
        this.startedAt = ps.startedAt ?? Date.now();
        this.setState("running");
      }
    }, 10_000);
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private setState(next: GuardianState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.log(`状态: ${prev} → ${next}`);
    this.emit("stateChange", { from: prev, to: next });
  }

  private log(msg: string): void {
    const line = `[frpc-guardian] ${msg}`;
    console.log(line);
    this.emit("log", line);
  }
}
