import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import type { ProjectTrustStatus } from "./api-types";

const TRUST_REQUIRING_PI_RESOURCES = [
  "settings.json", "extensions", "skills", "prompts", "themes", "SYSTEM.md", "APPEND_SYSTEM.md",
];

/**
 * Mirrors Pi's project-resource boundary but avoids a POSIX-like `HOME` when
 * running on Windows. Such shells can make the SDK mistake the user's global
 * `.agents/skills` for a project ancestor and prompt for trust on clean dirs.
 */
function normalizePathForComparison(path: string): string {
  try {
    return realpathSync.native(path).toLocaleLowerCase();
  } catch {
    return resolve(path).toLocaleLowerCase();
  }
}

function hasProjectTrustRequiringResources(cwd: string): boolean {
  const resolvedCwd = resolve(cwd);
  const userHome = resolve(process.platform === "win32" ? (process.env.USERPROFILE || homedir()) : homedir());
  const userAgentsSkills = normalizePathForComparison(join(userHome, ".agents", "skills"));
  const piDir = join(resolvedCwd, ".pi");
  if (TRUST_REQUIRING_PI_RESOURCES.some((entry) => existsSync(join(piDir, entry)))) return true;

  let current = resolvedCwd;
  while (true) {
    const agentsSkills = join(current, ".agents", "skills");
    if (existsSync(agentsSkills) && normalizePathForComparison(agentsSkills) !== userAgentsSkills) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && hasProjectTrustRequiringResources(cwd);
  if (!requiresTrust) return { requiresTrust: false, trusted: true };

  const trustStore = new ProjectTrustStore(agentDir);
  return {
    requiresTrust: true,
    trusted: trustStore.get(cwd) === true,
  };
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;

  new ProjectTrustStore(agentDir).set(cwd, true);
  return { requiresTrust: true, trusted: true };
}

/**
 * Reload options that gate project-local, trust-requiring resources — a
 * repository's `.pi/extensions`, project `.pi/settings.json` extension
 * entries, and `.agents/skills` — behind the SDK's project-trust store.
 *
 * Pi Web *executes* project extensions when it builds session services: their
 * factory runs on import and their `session_start` handlers run on startup.
 * Without a trust gate, merely opening an untrusted repository in Pi Web runs
 * repository-controlled code locally (issue #236). The SDK's resource loader
 * only imports project extensions once `resolveProjectTrust` resolves true, so
 * denying trust keeps them dormant.
 *
 * Pi Web and the `pi` CLI share the same trust store. Projects with gated
 * resources default to untrusted until either client records a trust decision.
 * Returns `undefined` when the project has no trust-requiring resources,
 * leaving ordinary projects on their existing load path.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return undefined;
  const trustStore = new ProjectTrustStore(agentDir);
  return { resolveProjectTrust: async () => trustStore.get(cwd) === true };
}
