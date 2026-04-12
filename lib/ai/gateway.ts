import { createGateway } from "ai";

export type AiWorkloadScope = "moderation" | "platform" | "plugin";

const SCOPE_KEY_CANDIDATES: Record<AiWorkloadScope, string[]> = {
  moderation: ["AI_GATEWAY_KEY_MODERATION", "AI_GATEWAY_API_KEY"],
  platform: ["AI_GATEWAY_KEY_PLATFORM", "AI_GATEWAY_API_KEY"],
  plugin: ["AI_GATEWAY_KEY_PLUGIN", "AI_GATEWAY_API_KEY_PLATFORM", "AI_GATEWAY_API_KEY"],
};

const gatewayCache = new Map<string, ReturnType<typeof createGateway>>();

function resolveGatewayApiKey(scope: AiWorkloadScope): { key: string; source: string } {
  const keyNames = SCOPE_KEY_CANDIDATES[scope];

  for (const keyName of keyNames) {
    const value = process.env[keyName]?.trim();
    if (value) {
      return { key: value, source: keyName };
    }
  }

  throw new Error(
    `Missing AI Gateway key for '${scope}'. Set one of: ${keyNames.join(", ")}.`,
  );
}

function getGateway(scope: AiWorkloadScope) {
  const { key, source } = resolveGatewayApiKey(scope);
  const cacheKey = `${scope}:${source}:${key}`;

  const cached = gatewayCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const gateway = createGateway({ apiKey: key });
  gatewayCache.set(cacheKey, gateway);
  return gateway;
}

export function gatewayModel(scope: AiWorkloadScope, modelId: string) {
  return getGateway(scope)(modelId);
}
