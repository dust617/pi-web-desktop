/**
 * auto-orchestrator / state-repository.ts
 * 阶段 B（报告 P0-1）：session/task 分区 + schemaVersion + revision + 原子持久化。
 *
 * - 每个 sessionKey/taskKey 一个独立状态文件，同 cwd 多会话互不可见；
 * - 只接受 schemaVersion === 2 的持久化数据，其余一律回退初始状态（不静默吞错：返回诊断）；
 * - 写入走 tmp 文件 + rename，避免 last-writer-wins 的半写文件。
 */
import fs from "node:fs";
import path from "node:path";
import {
  createInitialState,
  STATE_SCHEMA_VERSION,
  type OrchestratorState,
} from "./state-reducer.js";

export interface LoadResult {
  state: OrchestratorState;
  source: "fresh" | "loaded" | "invalid-schema" | "parse-error";
}

export interface PersistResult {
  ok: boolean;
  error?: string;
}

function sanitizeKey(key: string): string {
  const clean = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return clean || "default";
}

export class StateRepository {
  constructor(private cwd: string) {}

  private dir(): string {
    return path.join(this.cwd, ".pi", "orchestrator-state");
  }

  fileFor(sessionKey: string, taskKey: string): string {
    return path.join(this.dir(), `${sanitizeKey(sessionKey)}__${sanitizeKey(taskKey)}.json`);
  }

  load(sessionKey: string, taskKey = "default"): LoadResult {
    const initial = createInitialState(sessionKey, taskKey);
    const file = this.fileFor(sessionKey, taskKey);
    try {
      if (!fs.existsSync(file)) {
        return { state: initial, source: "fresh" };
      }
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!raw || typeof raw !== "object" || raw.schemaVersion !== STATE_SCHEMA_VERSION) {
        return { state: initial, source: "invalid-schema" };
      }
      // 合并后强制身份字段与 schema 版本，防止文件被篡改成分区错乱
      const merged: OrchestratorState = {
        ...initial,
        ...raw,
        schemaVersion: STATE_SCHEMA_VERSION,
        sessionKey,
        taskKey,
      };
      return { state: merged, source: "loaded" };
    } catch {
      return { state: initial, source: "parse-error" };
    }
  }

  /** Remove stale session snapshots; state is disposable routing context, not durable project memory. */
  prune(maxAgeMs = 30 * 24 * 60 * 60 * 1000, maxFiles = 200): number {
    try {
      const dir = this.dir();
      if (!fs.existsSync(dir)) return 0;
      const now = Date.now();
      const files = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => ({ file: path.join(dir, entry.name), mtimeMs: fs.statSync(path.join(dir, entry.name)).mtimeMs }))
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
      const victims = new Set(files.filter((entry) => now - entry.mtimeMs > maxAgeMs).map((entry) => entry.file));
      for (const entry of files.filter((entry) => !victims.has(entry.file))) {
        if (files.length - victims.size <= maxFiles) break;
        victims.add(entry.file);
      }
      for (const file of victims) fs.unlinkSync(file);
      return victims.size;
    } catch {
      return 0;
    }
  }

  persist(state: OrchestratorState): PersistResult {
    const file = this.fileFor(state.sessionKey, state.taskKey);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
      try {
        fs.renameSync(tmp, file);
      } catch {
        // Windows 上目标存在时 rename 可能失败：退化为覆盖写并清理 tmp
        fs.copyFileSync(tmp, file);
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
