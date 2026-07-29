/**
 * auto-orchestrator / config.ts
 * 阶段 E（报告 P2-3）：配置 schema + 默认值 + 范围校验 + model ref 校验 + 未知字段告警。
 * 非法配置在启动时给出可操作错误，而非运行期崩溃。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface OrchestratorConfig {
  virtualModel: {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
  };
  models: {
    fast: string;
    executor: string;
    planner: string;
    diagnostician: string;
    reviewers: string[];
  };
  fallback: string[];
  limits: {
    maxSwitchesPerTurn: number;
    maxRetriesPerError: number;
    maxReviewers: number;
    modelStickinessTurns: number;
  };
  thinking?: Record<string, string>;
  verifier?: {
    perReviewerTimeoutMs?: number;
    overallTimeoutMs?: number;
  };
  /** 固定策略 holdout 基线配置（阶段0）。enabled=false 时行为等价于改动前。 */
  holdout?: {
    enabled: boolean;
    /** 基线模型 ref（provider/modelId）。推荐用 executor。 */
    model: string;
    /** fallback 列表，默认空 */
    fallback?: string[];
  };
}

const VALID_THINKING = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const KNOWN_TOP_FIELDS = new Set(["_comment", "virtualModel", "models", "fallback", "limits", "thinking", "verifier", "holdout"]);

export function isValidModelRef(ref: unknown): ref is string {
  if (typeof ref !== "string") return false;
  const slash = ref.indexOf("/");
  return slash > 0 && slash < ref.length - 1;
}

function fail(msg: string): never {
  throw new Error(`orchestrator.json: ${msg}`);
}

function requireInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(`${field} 必须是整数（收到 ${JSON.stringify(value)}）`);
  }
  if (value < min || value > max) {
    fail(`${field} 超出范围 [${min}, ${max}]（收到 ${value}）`);
  }
  return value;
}

/**
 * 校验并规范化配置。缺失的可选字段填默认值；非法字段抛可操作错误。
 * 返回 { config, warnings }，warnings 为未知字段等非致命提示。
 */
export function validateConfig(raw: unknown): { config: OrchestratorConfig; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") fail("配置必须是 JSON 对象");
  const r = raw as Record<string, unknown>;

  for (const key of Object.keys(r)) {
    if (!KNOWN_TOP_FIELDS.has(key)) warnings.push(`未知顶层字段: ${key}`);
  }

  // virtualModel
  const vm = r.virtualModel as Record<string, unknown> | undefined;
  if (!vm || typeof vm !== "object") fail("缺少 virtualModel");
  const virtualModel = {
    provider: typeof vm.provider === "string" ? vm.provider : "orchestrator",
    id: typeof vm.id === "string" ? vm.id : "auto",
    name: typeof vm.name === "string" ? vm.name : "Auto Orchestrator",
    contextWindow: requireInt(vm.contextWindow ?? 200000, "virtualModel.contextWindow", 1024, 10_000_000),
    maxTokens: requireInt(vm.maxTokens ?? 32000, "virtualModel.maxTokens", 1, 1_000_000),
  };

  // models：五个角色必须齐备且为合法 model ref
  const m = r.models as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") fail("缺少 models");
  for (const role of ["fast", "executor", "planner", "diagnostician"] as const) {
    if (!isValidModelRef(m[role])) fail(`models.${role} 必须是 'provider/modelId' 格式（收到 ${JSON.stringify(m[role])}）`);
  }
  if (!Array.isArray(m.reviewers)) fail("models.reviewers 必须是数组");
  const reviewers = (m.reviewers as unknown[]).map((ref, i) => {
    if (!isValidModelRef(ref)) fail(`models.reviewers[${i}] 必须是 'provider/modelId' 格式（收到 ${JSON.stringify(ref)}）`);
    return ref;
  });
  const models = {
    fast: m.fast as string,
    executor: m.executor as string,
    planner: m.planner as string,
    diagnostician: m.diagnostician as string,
    reviewers,
  };

  // fallback（可选，默认空）
  const fallbackRaw = r.fallback ?? [];
  if (!Array.isArray(fallbackRaw)) fail("fallback 必须是数组");
  const fallback = (fallbackRaw as unknown[]).map((ref, i) => {
    if (!isValidModelRef(ref)) fail(`fallback[${i}] 必须是 'provider/modelId' 格式`);
    return ref;
  });

  // limits：带默认值与范围
  const lim = (r.limits ?? {}) as Record<string, unknown>;
  const limits = {
    maxSwitchesPerTurn: requireInt(lim.maxSwitchesPerTurn ?? 2, "limits.maxSwitchesPerTurn", 0, 20),
    maxRetriesPerError: requireInt(lim.maxRetriesPerError ?? 2, "limits.maxRetriesPerError", 0, 20),
    maxReviewers: requireInt(lim.maxReviewers ?? 3, "limits.maxReviewers", 1, 10),
    modelStickinessTurns: requireInt(lim.modelStickinessTurns ?? 3, "limits.modelStickinessTurns", 0, 100),
  };

  // thinking（可选）：值必须合法
  let thinking: Record<string, string> | undefined;
  if (r.thinking !== undefined) {
    if (!r.thinking || typeof r.thinking !== "object") fail("thinking 必须是对象");
    thinking = {};
    for (const [role, level] of Object.entries(r.thinking as Record<string, unknown>)) {
      if (typeof level !== "string" || !VALID_THINKING.has(level)) {
        fail(`thinking.${role} 非法（收到 ${JSON.stringify(level)}，合法值: ${[...VALID_THINKING].join(", ")}）`);
      }
      thinking[role] = level;
    }
  }

  // verifier（可选）：超时范围
  let verifier: OrchestratorConfig["verifier"];
  if (r.verifier !== undefined) {
    const v = r.verifier as Record<string, unknown>;
    verifier = {};
    if (v.perReviewerTimeoutMs !== undefined) {
      verifier.perReviewerTimeoutMs = requireInt(v.perReviewerTimeoutMs, "verifier.perReviewerTimeoutMs", 1000, 600_000);
    }
    if (v.overallTimeoutMs !== undefined) {
      verifier.overallTimeoutMs = requireInt(v.overallTimeoutMs, "verifier.overallTimeoutMs", 1000, 1_800_000);
    }
  }

  // holdout（可选，默认禁用）
  let holdout: OrchestratorConfig["holdout"];
  if (r.holdout !== undefined) {
    const h = r.holdout as Record<string, unknown>;
    if (!h || typeof h !== "object") fail("holdout 必须是对象");
    if (typeof h.enabled !== "boolean") fail("holdout.enabled 必须是布尔值");
    if (!isValidModelRef(h.model)) fail(`holdout.model 必须是 'provider/modelId' 格式（收到 ${JSON.stringify(h.model)}）`);
    let hoFallback: string[] | undefined;
    if (h.fallback !== undefined) {
      if (!Array.isArray(h.fallback)) fail("holdout.fallback 必须是数组");
      hoFallback = (h.fallback as unknown[]).map((ref, i) => {
        if (!isValidModelRef(ref)) fail(`holdout.fallback[${i}] 必须是 'provider/modelId' 格式`);
        return ref as string;
      });
    }
    holdout = { enabled: h.enabled, model: h.model as string, fallback: hoFallback };
  }

  return {
    config: { virtualModel, models, fallback, limits, thinking, verifier, holdout },
    warnings,
  };
}

/** 当前项目优先；全局配置使已安装扩展可在其他项目复用。 */
export function findConfigFile(cwd: string): string | undefined {
  const projectFile = path.join(cwd, ".pi", "orchestrator.json");
  if (fs.existsSync(projectFile)) return projectFile;

  const piConfigDir = process.env.PI_CONFIG_DIR ?? path.join(os.homedir(), ".pi", "agent");
  const globalFile = path.join(piConfigDir, "auto-orchestrator", "orchestrator.json");
  return fs.existsSync(globalFile) ? globalFile : undefined;
}

export function loadConfig(cwd: string): OrchestratorConfig {
  const file = findConfigFile(cwd);
  if (!file) {
    throw new Error(`orchestrator config not found in ${path.join(cwd, ".pi")} or global Pi config`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { config, warnings } = validateConfig(raw);
  for (const w of warnings) {
    console.warn(`[orchestrator] config warning: ${w}`);
  }
  return config;
}
