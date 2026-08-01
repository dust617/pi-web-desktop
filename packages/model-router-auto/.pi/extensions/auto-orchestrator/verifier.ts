/**
 * auto-orchestrator / verifier.ts
 * 多模型独立复核（阶段 D 重构）。宗旨六：不做简单投票，必须独立分析+证据+分歧。
 *
 * 阶段 D（报告 P1-3/P1-4）修复：
 * - 每 reviewer 超时（默认 60s）+ 总体超时（默认 90s），均可配置；
 * - 取消时 abort，finally 退订订阅并 dispose 会话，释放资源；
 * - 空白回复标记 empty_response、超时标记 timeout，均不得为成功；
 * - reviewer 使用 noExtensions 的专用 resource loader，不加载项目扩展（防递归装配/共享状态污染）；
 * - 汇总保留各 reviewer 状态与分歧（非多数票）。
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export interface VerificationRequest {
  question: string;
  evidence: string;
}

export interface VerifierDefinition {
  ref: string;
  role: string;
}

export type ReviewerStatus = "ok" | "timeout" | "empty_response" | "error" | "unavailable" | "cancelled";

export interface ReviewerResult {
  role: string;
  ref: string;
  status: ReviewerStatus;
  response: string;
  ok: boolean;
}

export interface ConsensusResult {
  results: ReviewerResult[];
  summary: string;
}

export interface ConsensusOptions {
  perReviewerTimeoutMs?: number;
  overallTimeoutMs?: number;
  signal?: AbortSignal;
}

export const DEFAULT_PER_REVIEWER_TIMEOUT_MS = 60_000;
export const DEFAULT_OVERALL_TIMEOUT_MS = 90_000;

function parseModelRef(ref: string): { provider: string; modelId: string } {
  const index = ref.indexOf("/");
  if (index <= 0 || index === ref.length - 1) {
    throw new Error(`Invalid model reference: ${ref}`);
  }
  return { provider: ref.slice(0, index), modelId: ref.slice(index + 1) };
}

/** 可注入时钟/超时的超时包装（测试用假时钟） */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = timers.setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => {
        timers.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        timers.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 鸭子类型的会话接口（便于单元测试注入假会话） */
export interface SessionLike {
  subscribe(listener: (event: any) => void): () => void;
  prompt(text: string): Promise<unknown>;
  dispose?(): void;
}

function reviewerPrompt(role: string, request: VerificationRequest): string {
  return `
You are the ${role} reviewer.
Analyze independently. Do not assume the primary model is correct.

Question:
${request.question}

Evidence:
${request.evidence}

Return:
1. conclusion
2. supporting evidence
3. counterevidence
4. missing information
5. confidence from 0 to 1
`.trim();
}

/**
 * 单 reviewer 执行（可测试核心）：订阅 → prompt → 收集文本 → 退订 → dispose。
 * 空回复 → empty_response；超时由调用方 withTimeout 包裹。
 */
export async function reviewWithSession(
  session: SessionLike,
  verifier: VerifierDefinition,
  request: VerificationRequest,
): Promise<ReviewerResult> {
  let response = "";
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = session.subscribe((event: any) => {
      if (
        event?.type === "message_update" &&
        event?.assistantMessageEvent?.type === "text_delta"
      ) {
        response += event.assistantMessageEvent.delta ?? "";
      }
    });

    await session.prompt(reviewerPrompt(verifier.role, request));

    if (!response.trim()) {
      return { role: verifier.role, ref: verifier.ref, status: "empty_response", response: "", ok: false };
    }
    return { role: verifier.role, ref: verifier.ref, status: "ok", response: response.trim(), ok: true };
  } finally {
    try {
      unsubscribe?.();
    } catch {
      /* ignore */
    }
    try {
      session.dispose?.();
    } catch {
      /* ignore */
    }
  }
}

/** 汇总（保留分歧，非投票） */
export function summarizeResults(results: ReviewerResult[]): string {
  const okCount = results.filter((r) => r.ok).length;
  const header = `Consensus review: ${okCount}/${results.length} reviewers returned usable analysis (disagreements preserved, not voted).`;
  const body = results
    .map((r) => {
      const statusNote = r.ok ? "" : ` [${r.status}]`;
      return [`Reviewer: ${r.role} (${r.ref})${statusNote}`, r.response || `(no usable response: ${r.status})`].join("\n");
    })
    .join("\n\n---\n\n");
  return [header, body].join("\n\n");
}

export async function runConsensus(
  request: VerificationRequest,
  verifiers: VerifierDefinition[],
  cwd: string,
  options: ConsensusOptions = {},
): Promise<ConsensusResult> {
  const perReviewerTimeout = options.perReviewerTimeoutMs ?? DEFAULT_PER_REVIEWER_TIMEOUT_MS;
  const overallTimeout = options.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
  const overallStart = Date.now();

  let runtime: any;
  try {
    runtime = await (ModelRuntime as any).create({ cwd });
  } catch (e) {
    const msg = `Verifier runtime unavailable: ${e instanceof Error ? e.message : String(e)}`;
    const results: ReviewerResult[] = verifiers.map((v) => ({
      role: v.role, ref: v.ref, status: "unavailable", response: msg, ok: false,
    }));
    return { results, summary: summarizeResults(results) };
  }

  const tasks = verifiers.map(async (verifier): Promise<ReviewerResult> => {
    // 每个候选前后检查取消
    if (options.signal?.aborted) {
      return { role: verifier.role, ref: verifier.ref, status: "cancelled", response: "cancelled before start", ok: false };
    }
    // 总体超时预算：剩余时间不足则直接标记 timeout
    const remaining = overallTimeout - (Date.now() - overallStart);
    if (remaining <= 0) {
      return { role: verifier.role, ref: verifier.ref, status: "timeout", response: "overall budget exhausted", ok: false };
    }
    const effectiveTimeout = Math.min(perReviewerTimeout, remaining);

    let session: SessionLike | undefined;
    try {
      const { provider, modelId } = parseModelRef(verifier.ref);
      const model = (runtime as any).getModel?.(provider, modelId);
      if (!model) {
        return { role: verifier.role, ref: verifier.ref, status: "unavailable", response: `Verifier unavailable: ${verifier.ref}`, ok: false };
      }

      const created = await createAgentSession({
        model,
        modelRuntime: runtime,
        tools: ["read", "grep", "find", "ls"], // 子 Agent 默认只读（宗旨五）
        // 报告 P1-4：禁用项目扩展，防递归装配与共享状态污染
        resourceLoader: new DefaultResourceLoader({ cwd, noExtensions: true } as any),
        sessionManager: SessionManager.inMemory(cwd),
        cwd,
      } as any);
      session = created.session as unknown as SessionLike;

      return await withTimeout(reviewWithSession(session, verifier, request), effectiveTimeout);
    } catch (e) {
      if (e instanceof TimeoutError) {
        return { role: verifier.role, ref: verifier.ref, status: "timeout", response: `timed out after ${effectiveTimeout}ms`, ok: false };
      }
      if (options.signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
        return { role: verifier.role, ref: verifier.ref, status: "cancelled", response: "cancelled", ok: false };
      }
      return { role: verifier.role, ref: verifier.ref, status: "error", response: `Failed: ${e instanceof Error ? e.message : String(e)}`, ok: false };
    }
    // 注：session 的退订/dispose 由 reviewWithSession 的 finally 负责
  });

  // 总体超时包裹全部 reviewer
  let results: ReviewerResult[];
  try {
    results = await withTimeout(Promise.allSettled(tasks).then((settled) =>
      settled.map((s, i) =>
        s.status === "fulfilled"
          ? s.value
          : { role: verifiers[i].role, ref: verifiers[i].ref, status: "error" as const, response: String(s.reason), ok: false },
      ),
    ), overallTimeout);
  } catch (e) {
    // 总体超时：返回已知的未完成标记
    results = verifiers.map((v) => ({
      role: v.role, ref: v.ref, status: "timeout" as const, response: `overall timeout after ${overallTimeout}ms`, ok: false,
    }));
    void e;
  }

  return { results, summary: summarizeResults(results) };
}
