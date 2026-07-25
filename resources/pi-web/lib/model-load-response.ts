import type { ModelsData } from "./models-cache";

/** Convert model-registry loading into a non-leaking HTTP response. */
export async function modelLoadResponse(load: () => Promise<ModelsData>): Promise<Response> {
  try {
    return Response.json(await load());
  } catch (error) {
    const errorKind = error instanceof Error ? error.name : typeof error;
    console.error(`[models] failed to load model configuration (${errorKind})`);
    return Response.json({ error: "Failed to load model configuration" }, { status: 500 });
  }
}
