/**
 * auto-orchestrator / analyzer.ts
 * 局势分析（纯函数）。阶段 B：改读不可变 OrchestratorState 快照。
 * 宗旨四：判断停滞优先看测试/错误/工具结果，不只看对话轮数。
 *
 * 停滞信号映射（报告 P0-3 字段生命周期）：
 * - 工具失败 streak → toolFailuresThisAttempt（attempt scope，ATTEMPT_STARTED 清零）
 * - 模型失败 streak → modelFailuresThisAttempt（attempt scope）
 * - 同错误签名 → sameErrorSignatureCount（跨 attempt，成功/正测试增量清零）
 * - 重复假设 → repeatedHypothesisCount（turn scope，TURN_STARTED 清零）
 * - 测试增量 → testsPassedDelta（turn scope，TURN_ENDED 归零）
 */
import type { Context } from "@earendil-works/pi-ai";
import type { OrchestratorState } from "./state-reducer.js";
import type { Situation, Phase } from "./types.js";

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (item && typeof item === "object" && "text" in item && typeof (item as any).text === "string") {
        return (item as any).text;
      }
      return "";
    })
    .join("\n");
}

function getRecentText(context: Context): string {
  // 取所有 user 角色消息，过滤掉扩展注入的提示（context-mode/project_memory_brief 等），返回真实用户输入
  const userMsgs = (context.messages ?? [])
    .filter((m: any) => m?.role === "user")
    .map((m: any) => contentToText(m.content))
    .filter((t: string) => {
      if (!t) return false;
      const low = t.toLowerCase();
      if (low.startsWith("context-mode active")) return false;
      if (low.startsWith("<project_memory_brief>")) return false;
      if (low.startsWith("ctx_")) return false;
      return true;
    });
  return (userMsgs[userMsgs.length - 1] ?? "").toLowerCase();
}

export function analyzeSituation(context: Context, state: OrchestratorState): Situation {
  const text = getRecentText(context);
  let complexity = 0.25;
  let risk = state.riskScore;
  let confidence = state.confidence;
  const reasons: string[] = [];
  const capabilities = new Set<string>();

  if (/架构|重构|整个项目|完整方案|系统设计|迁移|architecture|refactor/.test(text)) {
    complexity += 0.35;
    capabilities.add("planning");
    capabilities.add("long_context");
    reasons.push("任务涉及架构或较大范围修改");
  }

  if (/修改|实现|修复|运行测试|代码库|仓库|implement|fix|test/.test(text)) {
    complexity += 0.2;
    capabilities.add("coding");
    capabilities.add("tool_use");
  }

  if (/不确定|核实|印证|第二意见|高风险|资金|生产环境|安全|verify/.test(text)) {
    risk += 0.3;
    reasons.push("任务需要更高可靠性或独立验证");
  }

  const userSaysUnresolved = /还是不行|没有解决|又失败|仍然报错|没效果|不对|问题没解决|重复刚才/.test(text);
  const testsDelta = state.testsPassedDelta ?? 0;
  const lastAttemptMadeNoObjectiveProgress = testsDelta <= 0 && state.progressScore < 0.4;
  const stalledByErrorSig = state.sameErrorSignatureCount >= 2 && state.progressScore < 0.25;
  const stalledByRepetition = state.repeatedHypothesisCount >= 2 && state.noNewEvidence;
  const stalledByUser = userSaysUnresolved && lastAttemptMadeNoObjectiveProgress;
  const stalledByToolFail = state.toolFailuresThisAttempt >= 2;
  const stalledByModelFail = state.modelFailuresThisAttempt >= 2;
  const testRegression = testsDelta < 0 && state.testRunCount >= 2;

  if (testRegression) {
    risk += 0.15;
    reasons.push(`测试通过数减少（${testsDelta}），疑似回归`);
  } else if (testsDelta > 0) {
    reasons.push(`测试通过数增加（+${testsDelta}），有客观进展`);
  }

  const isStalled =
    stalledByErrorSig ||
    stalledByRepetition ||
    stalledByUser ||
    stalledByToolFail ||
    stalledByModelFail ||
    testRegression ||
    (state.attemptCountThisTurn >= 2 && state.progressScore < 0.25);

  if (isStalled) {
    complexity += 0.25;
    confidence -= 0.2;
    reasons.push("连续尝试没有获得足够进展");
    if (stalledByErrorSig) reasons.push("同一错误签名重复≥2次");
    if (stalledByRepetition) reasons.push("重复假设≥2次且无新证据");
    if (stalledByUser) reasons.push("用户明确反馈未解决且无客观进展");
    if (stalledByToolFail) reasons.push("连续工具失败≥2次");
    if (stalledByModelFail) reasons.push("本 attempt 模型失败≥2次");
    if (testRegression) reasons.push("测试回归（通过数减少）");
  }

  const escalationActive = !!state.escalation && !state.escalation.consumed;
  const needsPlanning =
    (!state.plan || !!state.replanRequested) &&
    (complexity >= 0.55 || capabilities.has("planning") || !!state.replanRequested);
  const needsDiagnosis = isStalled || (state.phase === "debugging" && state.sameFailureCount >= 1);
  const needsConsensus = risk >= 0.78 || escalationActive;

  let phase: Phase = state.phase || "discovery";
  // 显式阶段转换优先于文本启发式（报告 P1-6）
  if (state.replanRequested) phase = "planning";
  else if (needsConsensus) phase = "consensus";
  else if (isStalled) phase = "stalled";
  else if (needsPlanning) phase = "planning";
  else if (state.plan && state.phase === "planning") phase = "execution";

  return {
    phase,
    complexity: Math.max(0, Math.min(1, complexity)),
    risk: Math.max(0, Math.min(1, risk)),
    confidence: Math.max(0, Math.min(1, confidence)),
    needsPlanning,
    needsDiagnosis,
    needsConsensus,
    isStalled,
    hasProgress: testsDelta > 0 || state.progressScore >= 0.5,
    requiredCapabilities: [...capabilities],
    reasons,
  };
}
