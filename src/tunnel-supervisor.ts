/**
 * TunnelSupervisor - 隧道监督状态机
 * 
 * 管理隧道生命周期：
 * - 状态机：disabled -> starting -> connected -> degraded -> blocked
 * - 依赖 Bridge readiness
 * - 幂等 graceful shutdown
 * - 托盘状态与重试动作
 */

import { EventEmitter } from "node:events";
import { FrpcAdapter, FrpcProfile, FrpcConfig, FrpcError } from "./frpc-adapter";

export type TunnelState = 
  | "disabled"           // 未配置或禁用
  | "unconfigured"       // 已配置但未验证
  | "blocked"            // 被阻止（配置错误、凭据问题等）
  | "starting"           // 正在启动
  | "connecting"         // 正在连接
  | "connected"          // 已连接
  | "reconnecting"       // 正在重连
  | "degraded"           // 降级（部分功能不可用）
  | "unknown";           // 状态未知

export interface TunnelProfile {
  /** 公开 URL */
  publicUrl: string;
  /** frpc 配置 */
  frpc: FrpcProfile;
  /** 是否自动启动 */
  autoStart: boolean;
  /** 上次验证时间 */
  lastVerifiedAt?: number;
}

export interface TunnelStatus {
  state: TunnelState;
  enabled: boolean;
  publicUrl: string | null;
  localPort: number | null;
  remotePort: number | null;
  lastError: string | null;
  lastConnectedAt: number | null;
  diagnosticId: string | null;
}

export class TunnelSupervisor extends EventEmitter {
  private state: TunnelState = "disabled";
  private adapter: FrpcAdapter | null = null;
  private profile: TunnelProfile | null = null;
  private lastError: string | null = null;
  private lastConnectedAt: number | null = null;
  private diagnosticId: string | null = null;
  private enabled = false;

  constructor(private frpcConfig: FrpcConfig) {
    super();
  }

  /**
   * 加载配置
   */
  async loadProfile(profile: TunnelProfile): Promise<void> {
    this.profile = profile;
    this.enabled = profile.autoStart;
    
    if (!this.enabled) {
      this.setState("disabled");
      return;
    }

    // Validate profile
    try {
      this.validateProfile(profile);
      this.setState("unconfigured");
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.setState("blocked");
      throw err;
    }
  }

  /**
   * 验证配置
   */
  private validateProfile(profile: TunnelProfile): void {
    if (!profile.publicUrl) {
      throw new Error("publicUrl is required");
    }
    if (!profile.publicUrl.startsWith("https://")) {
      throw new Error("publicUrl must be HTTPS");
    }
    if (!profile.frpc.serverAddr) {
      throw new Error("serverAddr is required");
    }
    if (!profile.frpc.serverPort) {
      throw new Error("serverPort is required");
    }
  }

  /**
   * 启动隧道
   */
  async start(token: string): Promise<void> {
    if (!this.enabled || !this.profile) {
      throw new Error("Tunnel is disabled or not configured");
    }

    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    if (this.state === "blocked") {
      throw new Error(`Cannot start blocked tunnel: ${this.lastError}`);
    }

    this.setState("starting");
    this.diagnosticId = this.generateDiagnosticId();

    try {
      // Create adapter
      this.adapter = new FrpcAdapter(this.frpcConfig);

      // Start frpc
      await this.adapter.start(this.profile.frpc, token);

      this.setState("connecting");

      // Wait for connection
      await this.waitForConnection();

      this.lastConnectedAt = Date.now();
      this.setState("connected");
      this.emit("connected", { publicUrl: this.profile.publicUrl });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.setState("blocked");
      this.emit("error", { error: this.lastError, diagnosticId: this.diagnosticId });
      throw err;
    }
  }

  /**
   * 停止隧道
   */
  async stop(): Promise<void> {
    if (!this.adapter) {
      this.setState("disabled");
      return;
    }

    try {
      await this.adapter.stop();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }

    this.adapter = null;
    this.setState("disabled");
    this.emit("stopped");
  }

  /**
   * 重试连接
   */
  async retry(token: string): Promise<void> {
    await this.stop();
    if (this.profile) {
      this.profile.autoStart = true;
      this.enabled = true;
      await this.start(token);
    }
  }

  /**
   * 等待连接建立
   */
  private async waitForConnection(): Promise<void> {
    const timeout = 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (!this.adapter) {
        throw new Error("Adapter was destroyed during connection");
      }

      const status = this.adapter.getStatus();
      if (status.running) {
        // Check logs for success
        const logs = status.logs;
        const hasSuccess = logs.some((line) =>
          line.includes("start proxy success") ||
          line.includes("login to server success")
        );

        if (hasSuccess) {
          return;
        }

        const hasError = logs.some((line) =>
          line.includes("authorization failed") ||
          line.includes("connection refused")
        );

        if (hasError) {
          throw new Error("frpc connection failed");
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error("Connection timeout");
  }

  /**
   * 获取当前状态
   */
  getStatus(): TunnelStatus {
    return {
      state: this.state,
      enabled: this.enabled,
      publicUrl: this.profile?.publicUrl || null,
      localPort: this.profile?.frpc.localPort || null,
      remotePort: this.profile?.frpc.remotePort || null,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      diagnosticId: this.diagnosticId,
    };
  }

  /**
   * 检查是否健康
   */
  isHealthy(): boolean {
    return this.state === "connected" && this.adapter !== null;
  }

  private setState(newState: TunnelState): void {
    const oldState = this.state;
    this.state = newState;
    this.emit("stateChange", { from: oldState, to: newState });
  }

  private generateDiagnosticId(): string {
    return `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
