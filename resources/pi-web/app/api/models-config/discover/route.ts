import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolveModelDiscoveryAuth } from "@/lib/model-discovery-auth";
import { buildModelsListUrl, parseDiscoveredModels } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

const DISCOVERY_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name);
}

function getSavedProvider(providerName: string): Record<string, unknown> | null {
  const modelsPath = join(getAgentDir(), "models.json");
  if (!existsSync(modelsPath)) return null;
  try {
    const config = JSON.parse(readFileSync(modelsPath, "utf8")) as { providers?: unknown };
    if (!isRecord(config.providers)) return null;
    const provider = config.providers[providerName];
    return isRecord(provider) ? provider : null;
  } catch {
    return null;
  }
}

function buildHeaders(api: string, apiKey: string | undefined, configured: Record<string, string>): Headers {
  const headers = new Headers(configured);
  if (!hasHeader(headers, "accept")) headers.set("Accept", "application/json");
  if (!apiKey) return headers;

  if (api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers.set("x-api-key", apiKey);
    if (!hasHeader(headers, "anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!hasHeader(headers, "x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!hasHeader(headers, "authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { providerName?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ error: "providerName is required" }, { status: 400 });

    // Resolve both the target URL and authentication from the saved provider.
    // Never forward credentials resolved from local auth/settings to a URL
    // supplied by the caller: that would permit SSRF and credential exfiltration.
    const provider = getSavedProvider(providerName);
    if (!provider) return NextResponse.json({ error: `Save provider "${providerName}" before discovering models` }, { status: 400 });
    const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
    if (!baseUrl) return NextResponse.json({ error: "Saved provider has no base URL" }, { status: 400 });
    const api = typeof provider.api === "string" && provider.api
      ? provider.api
      : "openai-completions";

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(baseUrl, api);
    } catch {
      return NextResponse.json({ error: "Base URL is invalid" }, { status: 400 });
    }

    const auth = await resolveModelDiscoveryAuth(providerName, provider);

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: buildHeaders(api, auth.apiKey, auth.headers),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        error: responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`,
        status: response.status,
      }, { status: 502 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ error: "Upstream model list was not valid JSON" }, { status: 502 });
    }
    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return NextResponse.json({ error: "No models found in the upstream response" }, { status: 502 });
    }

    return NextResponse.json({ models, endpoint: endpoint.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
