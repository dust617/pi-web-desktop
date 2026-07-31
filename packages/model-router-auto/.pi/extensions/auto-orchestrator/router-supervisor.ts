import fs from "node:fs";
import path from "node:path";

import type { Context } from "@earendil-works/pi-ai";

import { analyzeSituation } from "./analyzer.js";
import type { OrchestratorState } from "./state-reducer.js";

export const ROUTER_SUPERVISOR_HINT_SCHEMA_VERSION = 1;
export const ROUTER_SUPERVISOR_MAX_TTL_MS = 120_000;

export type SupervisorHintMode = "high" | "ultra";

export interface RouterSupervisorHint {
  schemaVersion: typeof ROUTER_SUPERVISOR_HINT_SCHEMA_VERSION;
  sessionId: string;
  turnId: string;
  mode: SupervisorHintMode;
  createdAt: number;
  expiresAt: number;
  /** 仅限稳定 reason code；禁止存入原始 prompt、路径、命令或报错。 */
  reasonCodes: string[];
}

export interface SupervisorRecommendation {
  hint?: RouterSupervisorHint;
  phase: string;
  complexity: number;
  risk: number;
  /** 0..1：只表示是否应提高 Pi Router 能力下限，不是模型分。 */
  score: number;
  reasonCodes: string[];
}

const HIGH_SCORE_THRESHOLD = 0.52;
const ULTRA_SCORE_THRESHOLD = 0.86;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function addReason(reasons: string[], code: string): void {
  if (!reasons.includes(code)) reasons.push(code);
}

/**
 * 把“规划/停滞/风险/近期进展”合成为一个能力下限分。
 * 这是 supervisor 自己的轻量评分；具体模型仍由 pi-model-auto 的 Pareto/成本/缓存/quota 选择。
 */
function scoreSupervisorNeed(situation: ReturnType<typeof analyzeSituation>, state: OrchestratorState): { score: number; reasonCodes: string[] } {
  let score = 0;
  const reasonCodes: string[] = [];

  score += situation.complexity * 0.25;
  score += situation.risk * 0.25;

  if (situation.needsPlanning) {
    score += 0.42;
    addReason(reasonCodes, "planning_required");
  }
  if (situation.needsDiagnosis || situation.isStalled) {
    score += 0.5;
    addReason(reasonCodes, "stalled_or_diagnosis");
  }
  if (situation.needsConsensus || situation.risk >= 0.78) {
    score += 0.55;
    addReason(reasonCodes, "high_risk_or_consensus");
  } else if (situation.risk >= 0.45) {
    score += 0.22;
    addReason(reasonCodes, "elevated_risk");
  }
  if (!situation.needsPlanning && situation.complexity >= 0.75) {
    score += 0.22;
    addReason(reasonCodes, "high_complexity");
  }
  if (situation.confidence < 0.35) {
    score += 0.1;
    addReason(reasonCodes, "low_confidence");
  }
  if (state.sameErrorSignatureCount >= 2 || state.sameFailureCount >= 2) {
    score += 0.1;
    addReason(reasonCodes, "repeated_failure");
  }

  // 有客观进展时，降低“惯性升级”。但规划/复核/高风险硬信号不因进展被压掉。
  if (!situation.needsPlanning && !situation.needsConsensus && state.progressScore >= 0.65) score -= 0.18;
  if (!situation.needsPlanning && !situation.needsConsensus && (state.testsPassedDelta ?? 0) > 0) score -= 0.12;

  return { score: clamp01(score), reasonCodes };
}

/**
 * Supervisor 只在现有 auto 路由可能低估风险/复杂度时抬高能力下限，绝不指定具体模型。
 * 普通任务保持 undefined，仍由 pi-model-auto 的能力/成本 Pareto 路由决定。
 */
export function recommendRouteHint(
  context: Context,
  state: OrchestratorState,
  sessionId: string,
  turnId: string,
  now = Date.now(),
): SupervisorRecommendation {
  const situation = analyzeSituation(context, state);
  const scored = scoreSupervisorNeed(situation, state);
  let mode: SupervisorHintMode | undefined;

  if (situation.needsConsensus || situation.risk >= 0.78 || (scored.score >= ULTRA_SCORE_THRESHOLD && situation.risk >= 0.55)) {
    mode = "ultra";
    addReason(scored.reasonCodes, "high_risk_or_consensus");
  } else if (scored.score >= HIGH_SCORE_THRESHOLD || situation.risk >= 0.45 || situation.complexity >= 0.75) {
    mode = "high";
  }

  const base = {
    phase: situation.phase,
    complexity: situation.complexity,
    risk: situation.risk,
    score: scored.score,
    reasonCodes: scored.reasonCodes,
  };

  if (!mode) return base;

  return {
    ...base,
    hint: {
      schemaVersion: ROUTER_SUPERVISOR_HINT_SCHEMA_VERSION,
      sessionId,
      turnId,
      mode,
      createdAt: now,
      expiresAt: now + ROUTER_SUPERVISOR_MAX_TTL_MS,
      reasonCodes: scored.reasonCodes,
    },
  };
}

export function hintFile(cwd: string): string {
  return path.join(cwd, ".pi", "router-supervisor-hint.json");
}

/** 原子写；监督提示是短暂派生态，不携带用户原文。 */
export function writeRouteHint(cwd: string, hint: RouterSupervisorHint): void {
  const file = hintFile(cwd);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(tmp, JSON.stringify(hint), "utf8");
    fs.renameSync(tmp, file);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // 提示文件写入失败不能阻断真实任务。
    }
  }
}

/** 仅清理本 session 自己写入的 hint，避免并发会话误删。 */
export function clearOwnRouteHint(cwd: string, sessionId: string): void {
  const file = hintFile(cwd);
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || (raw as { sessionId?: unknown }).sessionId !== sessionId) return;
    fs.unlinkSync(file);
  } catch {
    // 不存在、损坏或并发替换都安全忽略。
  }
}
