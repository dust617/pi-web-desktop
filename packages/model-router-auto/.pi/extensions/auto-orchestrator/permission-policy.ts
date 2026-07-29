/**
 * auto-orchestrator / permission-policy.ts
 * 阶段 D（报告 P0-2）：fail-closed 权限引擎（纯函数）。
 *
 * 与旧 permission-gate 的关键差异：
 * 1. 未知工具默认 confirm（非交互 → deny），不再伪装成 read_only 放行；
 * 2. bash 用"动词结构化分类"而非纯关键词黑名单：只读动词放行，破坏性/外部动词
 *    需确认，未知动词在非交互模式阻断；
 * 3. edit/write 路径规范化后必须落在 workspace 内，否则 deny（防 ../ 与绝对路径逃逸）；
 * 4. 高风险关键词只叠加在非只读命令上，避免 `grep token file` 一类只读命令误触发；
 * 5. 子 Agent（denyWriteForSubAgent）的一切非只读操作直接 deny。
 *
 * 日志脱敏在 telemetry.logPermission 完成：只记类别 + 命令哈希，不记原始命令。
 */
import path from "node:path";
import { createHash } from "node:crypto";

export type RiskLevel = "read_only" | "local_write" | "command_execution" | "external_write" | "high_risk";
export type PermissionAction = "allow" | "confirm" | "deny";

export interface PermissionDecision {
  level: RiskLevel;
  action: PermissionAction;
  reason: string;
  category: string;
}

export interface ClassifyOptions {
  cwd: string;
  interactive: boolean;
  isSubAgent?: boolean;
}

/** 只读工具白名单（能力元数据，显式枚举而非默认放行） */
const READ_ONLY_TOOLS = new Set([
  "read", "grep", "find", "ls", "ffgrep", "fffind",
  "ctx_search", "ctx_stats", "ctx_execute_file", "ctx_doctor",
  "memory-recall", "memory-status", "memory-review",
]);

const LOCAL_WRITE_TOOLS = new Set(["edit", "write"]);
const COMMAND_TOOLS = new Set(["bash"]);

/** 只读 shell 动词：参数视为数据，不做关键词拦截（修复 `grep token file` 误报） */
const READ_ONLY_VERBS = new Set([
  "ls", "dir", "cat", "type", "echo", "printf", "pwd", "grep", "rg", "ag", "find",
  "head", "tail", "wc", "sort", "uniq", "diff", "stat", "file", "which", "where",
  "whereis", "env", "printenv", "true", "date", "whoami", "hostname", "basename",
  "dirname", "realpath", "readlink", "test", "expr", "uname", "id", "less", "more",
]);

/** 构建/测试动词：命令执行但无外部副作用，允许 */
const BUILD_VERBS = new Set([
  "npm", "npx", "pnpm", "bun", "yarn", "node", "deno", "tsc", "eslint", "prettier",
  "jest", "vitest", "mocha", "ava", "tape", "cargo", "go", "make", "cmake", "ctest",
  "mvn", "gradle", "dotnet", "python", "python3", "pip", "pip3", "pytest", "ruby",
  "perl", "php", "java", "javac", "swift", "swiftc", "rustc",
]);

/** 破坏性动词：本地不可逆删除/权限变更 */
const DESTRUCTIVE_VERBS = new Set([
  "rm", "rmdir", "del", "erase", "rd", "shred", "format", "mkfs", "dd",
  "sudo", "doas", "su", "chmod", "chown", "icacls", "takeown", "remove-item",
]);

/** 外部副作用动词：网络/集群/远端状态变更 */
const EXTERNAL_VERBS = new Set([
  "terraform", "ansible", "helm", "kubectl", "oc", "aws", "gcloud", "az", "doctl",
  "docker", "podman", "nerdctl", "ssh", "scp", "sftp", "rsync", "nc", "ncat", "telnet",
  "ftp", "smbclient", "gh", "glab", "heroku", "vercel", "netlify", "fly", "flyctl",
]);

/** 高风险关键词：仅叠加在非只读命令上（资金/账号/部署/删库） */
const HIGH_RISK_PATTERN =
  /\b(deploy|publish|release)\b|\bpay(ment)?\b|转账|提现|\brefund\b|\bwithdraw\b|\bdrop\s+(table|database)\b/i;

/** git 只读子命令 */
const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "branch", "remote", "rev-parse", "ls-files",
  "ls-tree", "describe", "tag", "stash", "reflog", "shortlog", "blame",
]);

/** 包管理器发布子命令 */
const PUBLISH_SUBCOMMANDS = new Set(["publish", "release"]);

export function commandHash(command: string): string {
  return createHash("sha256").update(command).digest("hex").slice(0, 16);
}

/** 路径规范化后是否落在 workspace 内（防 ../ 与绝对路径逃逸） */
export function isWithinWorkspace(cwd: string, target: string): boolean {
  if (!target) return false;
  const root = path.resolve(cwd);
  const resolved = path.resolve(cwd, target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** 把命令拆成段（管道/链式/子 shell），逐段分类取最高风险 */
function splitCommandSegments(command: string): string[] {
  return command
    .split(/;|&&|\|\||\||\n|`|\$\(|\)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstVerb(segment: string): { verb: string; args: string[] } {
  const tokens = segment.split(/\s+/).filter(Boolean);
  // 跳过环境变量赋值前缀（FOO=bar cmd）
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  const verb = (tokens[i] ?? "").toLowerCase().replace(/["']/g, "");
  return { verb, args: tokens.slice(i + 1) };
}

function classifySegment(segment: string): { level: RiskLevel; category: string } {
  const { verb, args } = firstVerb(segment);
  if (!verb) return { level: "command_execution", category: "empty-segment" };

  if (READ_ONLY_VERBS.has(verb)) return { level: "read_only", category: `read-only:${verb}` };

  if (verb === "git") {
    const sub = (args[0] ?? "").toLowerCase();
    if (GIT_READ_ONLY_SUBCOMMANDS.has(sub)) return { level: "read_only", category: `git:${sub}` };
    if (sub === "push") return { level: "external_write", category: "git:push" };
    return { level: "command_execution", category: `git:${sub || "unknown"}` };
  }

  if (BUILD_VERBS.has(verb)) {
    const sub = (args[0] ?? "").toLowerCase();
    if (PUBLISH_SUBCOMMANDS.has(sub)) return { level: "external_write", category: `${verb}:${sub}` };
    return { level: "command_execution", category: `build:${verb}` };
  }

  if (verb === "curl" || verb === "wget") {
    const joined = segment.toLowerCase();
    if (/-x\s*(post|put|delete|patch)\b|--data\b|--form\b|-d\b|--upload-file\b|-t\b/.test(joined)) {
      return { level: "external_write", category: `${verb}:write` };
    }
    return { level: "command_execution", category: `${verb}:get` };
  }

  if (DESTRUCTIVE_VERBS.has(verb)) return { level: "external_write", category: `destructive:${verb}` };
  if (EXTERNAL_VERBS.has(verb)) return { level: "external_write", category: `external:${verb}` };

  return { level: "command_execution", category: `unknown-verb:${verb}` };
}

function classifyBash(command: string): { level: RiskLevel; category: string } {
  const segments = splitCommandSegments(command);
  let worst: { level: RiskLevel; category: string } = { level: "read_only", category: "empty" };
  const rank: Record<RiskLevel, number> = {
    read_only: 0, local_write: 1, command_execution: 2, external_write: 3, high_risk: 4,
  };
  for (const seg of segments) {
    const c = classifySegment(seg);
    if (rank[c.level] > rank[worst.level]) worst = c;
  }
  // 高风险关键词只叠加在非只读命令上（只读动词的参数是数据，不触发）
  if (worst.level !== "read_only" && HIGH_RISK_PATTERN.test(command)) {
    return { level: "high_risk", category: `high-risk-keyword+${worst.category}` };
  }
  return worst;
}

/**
 * 权限分类主入口。返回的 action 已按 interactive 解析：
 * confirm 在非交互模式降级为 deny（fail-closed）。
 */
export function classifyPermission(
  toolName: string,
  input: any,
  options: ClassifyOptions,
): PermissionDecision {
  const resolve = (level: RiskLevel, action: PermissionAction, reason: string, category: string): PermissionDecision => {
    // 子 Agent 非只读操作一律 deny（宗旨五：子 Agent 默认只读）
    if (options.isSubAgent && level !== "read_only") {
      return { level, action: "deny", reason: `sub-agent denied: ${reason}`, category };
    }
    // confirm 在非交互模式 fail-closed
    const finalAction = action === "confirm" && !options.interactive ? "deny" : action;
    return { level, action: finalAction, reason, category };
  };

  // 只读工具白名单
  if (READ_ONLY_TOOLS.has(toolName)) {
    return resolve("read_only", "allow", "read-only tool", `tool:${toolName}`);
  }

  // 本地写：workspace 路径约束
  if (LOCAL_WRITE_TOOLS.has(toolName)) {
    const target = String(input?.path ?? input?.file ?? "");
    if (!target) {
      return resolve("local_write", "confirm", "write without explicit path", `tool:${toolName}`);
    }
    if (!isWithinWorkspace(options.cwd, target)) {
      return resolve("local_write", "deny", `path escapes workspace: ${target}`, `tool:${toolName}:outside-workspace`);
    }
    if (/(^|[\\/])(\.env|secrets?|credentials?|\.npmrc|id_rsa|id_ed25519|\.pfx|\.p12)\b/i.test(target)) {
      return resolve("high_risk", "confirm", `writing sensitive file: ${target}`, `tool:${toolName}:sensitive`);
    }
    return resolve("local_write", "allow", `local write: ${target}`, `tool:${toolName}`);
  }

  // 命令执行：动词结构化分类
  if (COMMAND_TOOLS.has(toolName)) {
    const cmd = String(input?.command ?? "");
    const { level, category } = classifyBash(cmd);
    if (level === "read_only") {
      return resolve("read_only", "allow", "read-only command", category);
    }
    if (level === "high_risk") {
      return resolve("high_risk", "confirm", "high-risk command", category);
    }
    if (level === "external_write") {
      return resolve("external_write", "confirm", "external/destructive command", category);
    }
    // command_execution：已知构建动词允许；未知动词在非交互模式 fail-closed
    if (category.startsWith("unknown-verb")) {
      return resolve("command_execution", options.interactive ? "allow" : "confirm", `unknown command verb`, category);
    }
    return resolve("command_execution", "allow", "build/test command", category);
  }

  // 未知工具：fail-closed（不再伪装 read_only 放行）
  return resolve("high_risk", "confirm", `unclassified tool: ${toolName}`, `tool:${toolName}:unclassified`);
}
