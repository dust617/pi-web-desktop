/**
 * auto-orchestrator / state.ts
 * 阶段 B（报告 P0-1/P0-3）：状态外置存储重构为 dispatch + 不可变快照。
 *
 * - 唯一变更入口是 dispatch(event) → reduce()；模块不得拿到可变引用；
 * - get()/snapshot() 返回深拷贝快照，调用方修改不影响内部状态；
 * - bind(sessionKey, taskKey) 后按 session 分区持久化（StateRepository）；
 * - 持久化失败不阻塞运行，但计入健康计数（telemetry v2 上报）。
 *
 * 兼容别名：旧代码中的 StateStore 名称保留为 OrchestratorStore 的别名。
 */
import { reduce, createInitialState, type OrchestratorState } from "./state-reducer.js";
import { StateRepository } from "./state-repository.js";
import type { OrchestratorEvent } from "./events.js";

export type { OrchestratorState };

export class OrchestratorStore {
  private state: OrchestratorState;
  private bound = false;
  private persistFailures = 0;
  private repo: StateRepository;

  constructor(private cwd: string, repo?: StateRepository) {
    this.repo = repo ?? new StateRepository(cwd);
    this.state = createInitialState("unbound", "default");
  }

  /** 绑定到具体 session/task 分区；重复绑定同一分区为 no-op。 */
  bind(sessionKey: string, taskKey = "default"): void {
    if (this.bound && this.state.sessionKey === sessionKey && this.state.taskKey === taskKey) {
      return;
    }
    const loaded = this.repo.load(sessionKey, taskKey);
    this.state = loaded.state;
    this.bound = true;
  }

  isBound(): boolean {
    return this.bound;
  }

  /** 唯一状态变更入口。返回变更后的内部状态（勿直接修改）。 */
  dispatch(event: OrchestratorEvent): OrchestratorState {
    this.state = reduce(this.state, event);
    if (this.bound) {
      const result = this.repo.persist(this.state);
      if (!result.ok) this.persistFailures += 1;
    }
    return this.state;
  }

  /** 不可变深拷贝快照。OrchestratorState 全为可结构化克隆的纯数据（无函数/Date/Map）。 */
  snapshot(): OrchestratorState {
    return structuredClone(this.state);
  }

  /** @deprecated 使用 snapshot()。保留只为减少迁移面，行为同 snapshot()。 */
  get(): OrchestratorState {
    return this.snapshot();
  }

  reset(): void {
    this.state = createInitialState(this.state.sessionKey, this.state.taskKey);
    if (this.bound) {
      const result = this.repo.persist(this.state);
      if (!result.ok) this.persistFailures += 1;
    }
  }

  getPersistFailureCount(): number {
    return this.persistFailures;
  }

  getCwd(): string {
    return this.cwd;
  }
}

/** 兼容旧导入名。 */
export type StateStore = OrchestratorStore;
