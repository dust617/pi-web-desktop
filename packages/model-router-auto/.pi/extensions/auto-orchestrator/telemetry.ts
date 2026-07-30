/**
 * auto-orchestrator / telemetry.ts
 * 阶段 E（报告 P0-4）：telemetry v2。
 *
 * 与 v1 的关键差异：
 * - 分事件类型：route_intent / route_outcome / permission_decision / review_completed，
 *   不再让权限事件与路由事件共用一个 schema；
 * - route_intent 与 route_outcome 按 decisionId 关联，可还原"从哪切到哪、哪个 fallback
 *   成功、延迟多少"；task_completion 由外部测试/用户/明确状态提供任务完成真值；
 * - 脱敏：所有字符串值经凭据规则集扫描，命中即替换为 [REDACTED] 并计入健康指标（目标命中=0）；
 * - 轮转 + 保留期：超过 maxBytes 轮转，保留 keep 份，清理超过 retentionDays 的旧轮转；
 * - 写入健康指标：writeFailures / sanitizationHits / entriesWritten。
 *
 * 旧 v1 日志已归档到 .pi/archive/orchestrator-route.v1-invalid-for-learning.log，不可用于学习。
 */
import fs from "node:fs";
import path from "node:path";

export const TELEMETRY_SCHEMA_VERSION = 2;

export type RouteStrategy = "adaptive" | "holdout";

export type TaskCompletionStatus = "completed" | "failed" | "unknown";
export type TaskCompletionSource = "test_passed" | "user_confirmed" | "explicit_state";

export interface RouteIntentEntry {
  decisionId: string;
  /** 同一用户任务/回合的稳定匿名标识；没有它不能计入完整样本。 */
  taskId: string;
  /** 一次 orchestrator 推理请求的标识；fallback 仍属于同一次请求。 */
  attemptId: string;
  sessionId?: string;
  turnId?: string;
  plannedModel: string;
  fallbacks: string[];
  phase: string;
  action: string;
  reason: string;
  /** 路由策略标记（阶段0）：holdout=固定策略基线，adaptive=动态路由。默认 adaptive。 */
  strategy?: RouteStrategy;
}

export interface RouteOutcomeEntry {
  decisionId: string;
  taskId: string;
  attemptId: string;
  status: "success" | "failed" | "aborted";
  actualModel?: string;
  fallbackIndex?: number;
  errorCategory?: "retryable" | "terminal" | "unknown";
  errorMessage?: string;
  latencyMs: number;
  committed: boolean;
}

export interface TaskCompletionEntry {
  taskId: string;
  status: TaskCompletionStatus;
  source: TaskCompletionSource;
  /** 可选；不填时该 taskId 下所有带 outcome 的 route 样本均可关联。 */
  decisionIds?: string[];
  /** 只保存外部证据摘要，不保存任务原文或命令。 */
  evidenceHash?: string;
}

export interface PermissionDecisionEntry {
  tool: string;
  level: string;
  action: string;
  category: string;
  commandHash?: string;
}

export interface ReviewCompletedEntry {
  outcome: "completed" | "timeout" | "failed";
  reviewerCount: number;
  statuses: string[];
}

/** 会话监督器给 Pi Router 的短时能力下限；不存 prompt、命令、模型选择或凭据。 */
export interface SupervisorHintEntry {
  sessionId: string;
  turnId: string;
  mode: "high" | "ultra";
  score: number;
  reasonCodes: string[];
  expiresAt: number;
}

export interface TelemetryHealth {
  entriesWritten: number;
  writeFailures: number;
  sanitizationHits: number;
}

export interface TelemetryOptions {
  maxBytes?: number;
  keepRotations?: number;
  retentionDays?: number;
}

/** 凭据/敏感信息规则集（报告 §7 阶段 E 验收：命中数必须为 0） */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._\-]+/i,
  /\b(api[_-]?key|apikey|secret|token|access[_-]?token|auth[_-]?token|password|passwd|pwd|authorization|cookie|session[_-]?id|private[_-]?key|connection[_-]?string|conn[_-]?str)\s*[:=]\s*\S+/i,
  /\b(postgres|postgresql|mysql|mariadb|mongodb|mongodb\+srv|redis|amqp|amqps|sqlserver|mssql):\/\/[^\s"']+/i,
  /\b(sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9]{16,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/, // 长 base64 blob
];

export function containsCredential(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((re) => re.test(value));
}

/** 递归脱敏：命中凭据规则的字符串替换为 [REDACTED]，返回命中次数 */
export function sanitize(value: unknown, hits: { count: number }): unknown {
  if (typeof value === "string") {
    if (containsCredential(value)) {
      hits.count += 1;
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, hits));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitize(v, hits);
    }
    return out;
  }
  return value;
}

export class Telemetry {
  private health: TelemetryHealth = { entriesWritten: 0, writeFailures: 0, sanitizationHits: 0 };
  private maxBytes: number;
  private keepRotations: number;
  private retentionDays: number;

  constructor(private cwd: string, options: TelemetryOptions = {}) {
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.keepRotations = options.keepRotations ?? 5;
    this.retentionDays = options.retentionDays ?? 30;
  }

  private get file(): string {
    return path.join(this.cwd, ".pi", "orchestrator-telemetry.v2.jsonl");
  }

  logRouteIntent(entry: RouteIntentEntry): void {
    this.write("route_intent", entry);
  }

  logRouteOutcome(entry: RouteOutcomeEntry): void {
    this.write("route_outcome", entry);
  }

  logTaskCompletion(entry: TaskCompletionEntry): void {
    this.write("task_completion", entry);
  }

  logPermissionDecision(entry: PermissionDecisionEntry): void {
    this.write("permission_decision", entry);
  }

  logReviewCompleted(entry: ReviewCompletedEntry): void {
    this.write("review_completed", entry);
  }

  logSupervisorHint(entry: SupervisorHintEntry): void {
    this.write("supervisor_hint", entry);
  }

  getHealth(): TelemetryHealth {
    return { ...this.health };
  }

  private write(kind: string, payload: unknown): void {
    const hits = { count: 0 };
    const clean = sanitize(payload, hits);
    this.health.sanitizationHits += hits.count;

    const record = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      kind,
      at: Date.now(),
      ...(clean as Record<string, unknown>),
    };
    const line = JSON.stringify(record);

    // 假设单进程串行写入：appendFileSync + rename 轮转在并发多进程写同一文件时
    // 可能丢失或交错；当前 Pi 单会话单写入者模型下安全。多会话写同项目 telemetry 时
    // 以 O_APPEND 原子追加保证不丢行，但轮转窗口期仍可能竞争——属已知可接受限制。
    try {
      this.rotateIfNeeded();
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, line + "\n", "utf8");
      this.health.entriesWritten += 1;
    } catch {
      this.health.writeFailures += 1;
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const size = fs.statSync(this.file).size;
      if (size < this.maxBytes) return;

      // 移位：.keep -> 删除，.N -> .N+1，current -> .1
      const oldest = `${this.file}.${this.keepRotations}`;
      if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
      for (let i = this.keepRotations - 1; i >= 1; i--) {
        const src = `${this.file}.${i}`;
        if (fs.existsSync(src)) fs.renameSync(src, `${this.file}.${i + 1}`);
      }
      fs.renameSync(this.file, `${this.file}.1`);
      this.cleanExpiredRotations();
    } catch {
      // 轮转失败不阻塞写入
    }
  }

  private cleanExpiredRotations(): void {
    try {
      const dir = path.dirname(this.file);
      const base = path.basename(this.file);
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(`${base}.`)) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      }
    } catch {
      /* ignore */
    }
  }
}
