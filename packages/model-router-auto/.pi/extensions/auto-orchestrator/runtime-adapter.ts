/**
 * auto-orchestrator / runtime-adapter.ts
 * 阶段 E（报告 P2-4/P2-5）：Pi API 适配层。
 *
 * 所有与 Pi 运行时边界的 `any` 收敛到本文件，每处边界断言带注释说明依据，
 * 其余核心路径（analyzer/policy/reducer/executor/permission）禁止显式 any。
 * 统一的 parseModelRef 也在此（修复两处重复实现）。
 */
import type { Context } from "@earendil-works/pi-ai";

export interface ResolvedModelRef {
  provider: string;
  modelId: string;
}

/** 统一 model ref 解析（原 provider.ts / verifier.ts 各有一份） */
export function parseModelRef(ref: string): ResolvedModelRef {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    throw new Error(`Invalid model reference: ${ref}`);
  }
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

/** 模型注册表的最小结构契约（Pi ModelRegistry 的运行时子集） */
export interface ModelRegistryAdapter {
  find(provider: string, modelId: string): AdapterModel | undefined;
  getAuth(model: AdapterModel): Promise<AdapterAuth>;
}

export interface AdapterModel {
  id: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface AdapterAuth {
  ok: boolean;
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * 包装 Pi ModelRegistry。边界 any 仅在此处：
 * - registry.find / getApiKeyAndHeaders 的签名随 Pi 版本变化，dist 类型不完整，
 *   用运行时可选链 + 结构校验兜底（报告：外部编译器通过不能替代运行时校验）。
 */
export function adaptModelRegistry(registry: unknown): ModelRegistryAdapter {
  // 边界断言：Pi ExtensionContext.modelRegistry 是对象，方法可能缺失旧版本
  const reg = registry as {
    find?: (provider: string, modelId: string) => unknown;
    getApiKeyAndHeaders?: (model: unknown) => Promise<unknown>;
  } | undefined;

  return {
    find(provider, modelId) {
      const found = reg?.find?.(provider, modelId);
      if (!found || typeof found !== "object") return undefined;
      const m = found as Record<string, unknown>;
      return {
        id: typeof m.id === "string" ? m.id : modelId,
        reasoning: typeof m.reasoning === "boolean" ? m.reasoning : undefined,
        contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
        maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : undefined,
      };
    },
    async getAuth(model) {
      const auth = await reg?.getApiKeyAndHeaders?.(model);
      if (!auth || typeof auth !== "object") return { ok: false };
      const a = auth as Record<string, unknown>;
      const headers = (a.headers && typeof a.headers === "object") ? a.headers as Record<string, string> : undefined;
      return {
        ok: a.ok === true,
        apiKey: typeof a.apiKey === "string" ? a.apiKey : undefined,
        headers,
      };
    },
  };
}

/** 认证成功：apiKey 或 headers 任一存在（header-only auth 合法，报告 P1-2） */
export function authUsable(auth: AdapterAuth): boolean {
  return auth.ok && (!!auth.apiKey || (!!auth.headers && Object.keys(auth.headers).length > 0));
}

// —— 流事件访问器（边界 any 收敛）——

/** 边界断言：Pi AssistantMessageEvent 是 { type, ... } 判别联合，字段随版本扩展 */
export interface StreamEventView {
  type: string;
  errorMessage?: string;
  stopReason?: string;
}

export function viewStreamEvent(event: unknown): StreamEventView {
  const e = event as Record<string, any>;
  const message = e?.message;
  return {
    type: typeof e?.type === "string" ? e.type : "unknown",
    errorMessage:
      (typeof e?.error?.errorMessage === "string" && e.error.errorMessage) ||
      (typeof message?.errorMessage === "string" && message.errorMessage) ||
      undefined,
    stopReason: typeof message?.stopReason === "string" ? message.stopReason : undefined,
  };
}

/** 读取 Context.systemPrompt（Pi Context 类型未公开该字段，边界断言） */
export function readSystemPrompt(context: Context): string | undefined {
  const sp = (context as { systemPrompt?: unknown }).systemPrompt;
  return typeof sp === "string" ? sp : undefined;
}

/** tool_result / tool_call 事件的输入访问（边界 any 收敛） */
export function readToolEvent(event: unknown): {
  toolName: string;
  isError: boolean;
  input: Record<string, unknown>;
  text: string;
} {
  const e = event as Record<string, any>;
  const content = Array.isArray(e?.content) ? e.content : [];
  const text = content
    .map((c: any) => (c && typeof c.text === "string" ? c.text : ""))
    .join("\n");
  return {
    toolName: typeof e?.toolName === "string" ? e.toolName : "",
    isError: !!e?.isError,
    input: (e?.input && typeof e.input === "object") ? e.input : {},
    text,
  };
}
