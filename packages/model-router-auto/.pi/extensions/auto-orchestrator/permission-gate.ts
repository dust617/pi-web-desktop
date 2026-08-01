/**
 * auto-orchestrator / permission-gate.ts
 * 统一权限层（阶段 D 重构）。本文件是 permission-policy 的运行时薄适配器：
 * 分类逻辑在 permission-policy.ts（纯函数、可测试），这里只做事件接线与 UI 确认。
 *
 * 宗旨五：权限独立于模型强弱，子 Agent 默认只读。
 * 硬拦截在 tool_call 阶段（不依赖模型遵守系统提示词）。
 * --print 模式无 UI，confirm 操作 fail-closed 直接 block。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Telemetry } from "./telemetry.js";
import { classifyPermission, commandHash } from "./permission-policy.js";

export function registerPermissionGate(
  pi: ExtensionAPI,
  telemetry: Telemetry,
  options: { denyWriteForSubAgent?: boolean } = {},
): void {
  pi.on("tool_call", async (event: any, ctx: any) => {
    const toolName: string = event?.toolName ?? "";
    const input = event?.input ?? {};
    const interactive: boolean = !!ctx?.hasUI;

    const decision = classifyPermission(toolName, input, {
      cwd: ctx?.cwd ?? process.cwd(),
      interactive,
      isSubAgent: !!options.denyWriteForSubAgent,
    });

    // 记录所有非只读操作（脱敏：类别 + 命令哈希，不写原始命令）
    if (decision.level !== "read_only") {
      telemetry.logPermissionDecision({
        tool: toolName,
        level: decision.level,
        action: decision.action,
        category: decision.category,
        commandHash: toolName === "bash" ? commandHash(String(input?.command ?? "")) : undefined,
      });
    }

    if (decision.action === "allow") return undefined;

    if (decision.action === "deny") {
      return { block: true, reason: `Permission denied: ${decision.reason}` };
    }

    // confirm 分支：非交互已在 classifyPermission 降级为 deny，这里只会是交互模式
    const approved = await ctx.ui?.confirm?.(
      `⚠️ ${decision.level} 操作`,
      `${decision.category}: ${decision.reason}`,
    );
    if (!approved) {
      return { block: true, reason: `User rejected: ${decision.reason}` };
    }
    return undefined;
  });
}
