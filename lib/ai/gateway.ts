import "server-only";

import { createHash } from "node:crypto";
import { createGateway } from "ai";

export type AiWorkloadScope = "moderation" | "platform" | "plugin";

const SCOPE_KEY_CANDIDATES: Record<AiWorkloadScope, string[]> = {
  moderation: ["AI_GATEWAY_KEY_MODERATION", "AI_GATEWAY_API_KEY_MODERATION"],
  platform: ["AI_GATEWAY_KEY_PLATFORM", "AI_GATEWAY_API_KEY_PLATFORM"],
  plugin: [
    "AI_GATEWAY_KEY_PLUGINS",
    "AI_GATEWAY_KEY_PLUGIN",
    "AI_GATEWAY_API_KEY_PLUGIN",
  ],
};

const gatewayCache = new Map<string, ReturnType<typeof createGateway>>();

interface GatewayAuthResolution {
  apiKey?: string;
  source: string;
}

function resolveGatewayAuth(
  scope: AiWorkloadScope,
  environment: Record<string, string | undefined> = process.env,
): GatewayAuthResolution {
  const keyNames = SCOPE_KEY_CANDIDATES[scope];

  for (const keyName of keyNames) {
    const value = environment[keyName]?.trim();
    if (value) {
      return { apiKey: value, source: keyName };
    }
  }

  const sharedKey = environment.AI_GATEWAY_API_KEY?.trim();
  if (sharedKey) {
    return { apiKey: sharedKey, source: "AI_GATEWAY_API_KEY" };
  }

  // createGateway() obtains and refreshes the Vercel OIDC token. Passing an
  // empty apiKey would override that path and turn a valid deployment into an
  // authentication failure.
  return { source: "vercel-oidc" };
}

function getGateway(scope: AiWorkloadScope) {
  const { apiKey, source } = resolveGatewayAuth(scope);
  const credentialIdentity = apiKey
    ? createHash("sha256").update(apiKey).digest("hex")
    : "oidc";
  const cacheKey = `${scope}:${source}:${credentialIdentity}`;

  const cached = gatewayCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const gateway = apiKey ? createGateway({ apiKey }) : createGateway();
  gatewayCache.set(cacheKey, gateway);
  return gateway;
}

export function gatewayModel(scope: AiWorkloadScope, modelId: string) {
  return getGateway(scope)(modelId);
}
