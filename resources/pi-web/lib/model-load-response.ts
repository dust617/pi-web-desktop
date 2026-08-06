import type { ModelsData } from "./models-cache";

export const MODEL_LOAD_FAILURE_MESSAGE = "模型列表暂时不可用，请检查配置后重试。";

/** Keep server-side model/config failures actionable without exposing details. */
export function withSafeModelLoadFailure(data: ModelsData): ModelsData {
  return { ...data, modelError: MODEL_LOAD_FAILURE_MESSAGE };
}
