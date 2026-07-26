/**
 * ManagedProcess - 通用子进程管理器
 * 
 * 提供：
 * - 生命周期管理（启动、停止、重启）
 * - 健康监控与心跳
 * - 有界退避重启（2s -> 5s -> 10s -> 30s -> 60s）
 * - 滑动窗口重启预算（10 分钟内最多 5 次）
 * - 崩溃循环断路器
 * - 幂等优雅关闭（可等待 + 超时 + exit confirmation）
 * - 进程树所有权（只 kill 自己创建的子进程）
 */

import { spawn, ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";

export interface ManagedProcessOptions {
  /** 可执行文件路径 */
  command: string;
  /** 命令行参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: NodeJS.ProcessEnv;
  /** 进程标识符（用于日志） */
  name: string;
  /** 启动超时（毫秒），默认 30000 */
  startTimeoutMs?: number;
  /** 停止超时（毫秒），默认 5000 */
  stopTimeoutMs?: number;
  /** 是否自动重启，默认 true */
  autoRestart?: boolean;
  /** 就绪检查函数 */
  readinessCheck?: () => Promise<boolean>;
  /** 就绪检查间隔（毫秒），默认 500 */
  readinessIntervalMs?: number;
  /** 就绪检查超时（毫秒），默认 30000 */
  readinessTimeoutMs?: number;
  /** Restart policy overrides used by deterministic tests. */
  restartDelaysMs?: number[];
  restartWindowMs?: number;
  maxRestartsInWindow?: number;
}

export type ProcessState = 
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed"
  | "blocked";

export interface ProcessStatus {
  state: ProcessState;
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  restartCount: number;
  lastError: string | null;
  blockedReason?: string;
}

export class ManagedProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: ProcessState = "stopped";
  private pid: number | null = null;
  private exitCode: number | null = null;
  private signal: string | null = null;
  private startedAt: number | null = null;
  private stoppedAt: number | null = null;
  private restartCount = 0;
  private lastError: string | null = null;
  private blockedReason: string | null = null;

  // Restart budget tracking
  private restartTimestamps: number[] = [];
  private restartWindowMs: number;
  private maxRestartsInWindow: number;

  // Backoff delays
  private backoffDelays: number[];
  private currentBackoffIndex = 0;

  // Stability tracking
  private stableSince: number | null = null;
  private readonly STABILITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  private restartTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private stopTimer: NodeJS.Timeout | null = null;

  constructor(private options: ManagedProcessOptions) {
    super();
    if (options.startTimeoutMs === undefined) options.startTimeoutMs = 30000;
    if (options.stopTimeoutMs === undefined) options.stopTimeoutMs = 5000;
    if (options.autoRestart === undefined) options.autoRestart = true;
    if (options.readinessIntervalMs === undefined) options.readinessIntervalMs = 500;
    if (options.readinessTimeoutMs === undefined) options.readinessTimeoutMs = 30000;
    this.restartWindowMs = options.restartWindowMs ?? 10 * 60 * 1000;
    this.maxRestartsInWindow = options.maxRestartsInWindow ?? 5;
    this.backoffDelays = options.restartDelaysMs?.length
      ? [...options.restartDelaysMs]
      : [2000, 5000, 10000, 30000, 60000];
  }

  /**
   * 启动进程
   */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      return;
    }

    if (this.state === "blocked") {
      throw new Error(`Cannot start blocked process: ${this.blockedReason}`);
    }

    this.setState("starting");
    this.exitCode = null;
    this.signal = null;
    this.lastError = null;

    let startedChild: ChildProcess | null = null;
    try {
      const spawnOptions: SpawnOptions = {
        cwd: this.options.cwd,
        env: this.options.env || process.env,
        stdio: ["ignore", "pipe", "pipe"],
      };

      this.child = spawn(this.options.command, this.options.args || [], spawnOptions);

      if (!this.child) {
        throw new Error("Failed to spawn child process");
      }
      startedChild = this.child;

      // Wait a tick for PID to be assigned
      await new Promise((resolve) => setTimeout(resolve, 10));

      this.pid = this.child.pid || null;

      if (!this.pid) {
        throw new Error("Failed to get child PID");
      }

      // Set up start timeout
      this.startTimer = setTimeout(() => {
        if (this.state === "starting") {
          this.lastError = `Start timeout after ${this.options.startTimeoutMs}ms`;
          this.stop().catch(() => {});
        }
      }, this.options.startTimeoutMs);

      // Subscribe before readiness checks so adapters can use the first
      // startup output as readiness evidence.
      const childRef = this.child;
      childRef.stdout?.on("data", (data: Buffer) => {
        this.emit("stdout", { data: data.toString() });
      });
      childRef.stderr?.on("data", (data: Buffer) => {
        this.emit("stderr", { data: data.toString() });
      });
      childRef.on("error", (err) => {
        this.lastError = err.message;
        this.handleExit(null, null);
      });

      childRef.on("exit", (code, sig) => {
        this.handleExit(code, sig);
      });

      // Wait for readiness
      if (this.options.readinessCheck) {
        await this.waitForReadiness();
      } else {
        // No readiness check, assume ready after short delay
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (this.startTimer) {
        clearTimeout(this.startTimer);
        this.startTimer = null;
      }

      this.startedAt = Date.now();
      this.stableSince = Date.now();
      this.setState("running");
      this.emit("started", { pid: this.pid });
    } catch (err) {
      if (this.startTimer) {
        clearTimeout(this.startTimer);
        this.startTimer = null;
      }
      this.lastError = err instanceof Error ? err.message : String(err);
      // An adapter can classify an exit and block the process while readiness
      // is pending. Preserve that terminal state instead of overwriting it.
      if (
        this.getStatus().state !== "blocked" &&
        (this.child === null || this.child === startedChild)
      ) {
        this.setState("failed");
        this.emit("failed", { error: this.lastError });
      }
      throw err;
    }
  }

  /**
   * 停止进程（幂等、可等待、带超时）
   */
  async stop(): Promise<void> {
    if (this.state === "stopped" || this.state === "stopping") {
      return;
    }

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    this.setState("stopping");

    return new Promise((resolve) => {
      if (!this.child || !this.pid) {
        this.setState("stopped");
        this.stoppedAt = Date.now();
        resolve();
        return;
      }

      // Set up stop timeout
      this.stopTimer = setTimeout(() => {
        if (this.child && this.pid) {
          this.lastError = `Stop timeout, force killing PID ${this.pid}`;
          try {
            this.child.kill("SIGKILL");
          } catch {
            // Process may have already exited
          }
        }
      }, this.options.stopTimeoutMs);

      // Listen for exit
      const onExit = () => {
        if (this.stopTimer) {
          clearTimeout(this.stopTimer);
          this.stopTimer = null;
        }
        this.child = null;
        this.pid = null;
        this.setState("stopped");
        this.stoppedAt = Date.now();
        this.emit("stopped");
        resolve();
      };

      if (this.child) {
        this.child.once("exit", onExit);
        
        // Try graceful shutdown first
        try {
          this.child.kill("SIGTERM");
        } catch {
          // Process may have already exited
          onExit();
        }
      } else {
        onExit();
      }
    });
  }

  /**
   * 获取当前状态
   */
  getStatus(): ProcessStatus {
    return {
      state: this.state,
      pid: this.pid,
      exitCode: this.exitCode,
      signal: this.signal,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      restartCount: this.restartCount,
      lastError: this.lastError,
      blockedReason: this.blockedReason || undefined,
    };
  }

  /**
   * Whether the child is alive while it is starting or running. Readiness
   * probes must use this rather than isHealthy(), because start() does not
   * transition to running until after the probe succeeds.
   */
  isAlive(): boolean {
    return (this.state === "starting" || this.state === "running") &&
      this.child !== null && this.child.exitCode === null;
  }

  /**
   * 检查进程是否健康
   */
  isHealthy(): boolean {
    return this.state === "running" && this.isAlive();
  }

  /**
   * 手动标记为 blocked（例如配置错误）
   */
  block(reason: string): void {
    this.blockedReason = reason;
    this.setState("blocked");
    this.emit("blocked", { reason });
  }

  /**
   * 清除 blocked 状态
   */
  unblock(): void {
    this.blockedReason = null;
    if (this.state === "blocked") {
      this.setState("stopped");
    }
  }

  private setState(newState: ProcessState): void {
    const oldState = this.state;
    this.state = newState;
    this.emit("stateChange", { from: oldState, to: newState });
  }

  private async waitForReadiness(): Promise<void> {
    const startTime = Date.now();
    const timeout = this.options.readinessTimeoutMs!;
    const interval = this.options.readinessIntervalMs!;

    while (Date.now() - startTime < timeout) {
      if (this.state !== "starting") {
        throw new Error("Process exited before becoming ready");
      }

      try {
        const ready = await this.options.readinessCheck!();
        if (ready) {
          return;
        }
      } catch {
        // Readiness check failed, continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Readiness timeout after ${timeout}ms`);
  }

  private handleExit(code: number | null, signal: string | null): void {
    this.exitCode = code;
    this.signal = signal;
    this.pid = null;
    this.child = null;

    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }

    if (this.state === "stopping") {
      // Expected exit during shutdown
      return;
    }

    // Unexpected exit
    this.lastError = `Process exited with code ${code}, signal ${signal}`;
    this.setState("failed");
    this.emit("exited", { code, signal });

    // Attempt restart if enabled
    if (this.options.autoRestart && this.state !== "blocked") {
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    // Check restart budget
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter(
      (t) => now - t < this.restartWindowMs
    );

    if (this.restartTimestamps.length >= this.maxRestartsInWindow) {
      this.block("crash_loop: too many restarts in 10 minutes");
      this.emit("crashLoop", { restartCount: this.restartCount });
      return;
    }

    // Check if process was stable long enough to reset backoff
    if (this.stableSince && now - this.stableSince >= this.STABILITY_THRESHOLD_MS) {
      this.currentBackoffIndex = 0;
      this.restartTimestamps = [];
    }

    const delay = this.backoffDelays[this.currentBackoffIndex] || this.backoffDelays[this.backoffDelays.length - 1];
    const jitter = Math.random() * 1000; // Add up to 1s jitter
    const totalDelay = delay + jitter;

    this.currentBackoffIndex = Math.min(this.currentBackoffIndex + 1, this.backoffDelays.length - 1);
    this.restartCount++;
    this.restartTimestamps.push(now);

    this.emit("restarting", { delay: totalDelay, restartCount: this.restartCount });

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start().catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.emit("restartFailed", { error: this.lastError });
      });
    }, totalDelay);
  }
}
