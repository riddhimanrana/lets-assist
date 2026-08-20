import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const gatewayOptions: Array<{ apiKey?: string }> = [];

mock.module("ai", () => ({
  createGateway(options: { apiKey?: string } = {}) {
    gatewayOptions.push(options);
    return (modelId: string) => ({ modelId });
  },
}));

const { gatewayModel } = await import("./gateway");

const AUTH_ENV_NAMES = [
  "AI_GATEWAY_KEY_MODERATION",
  "AI_GATEWAY_API_KEY_MODERATION",
  "AI_GATEWAY_KEY_PLATFORM",
  "AI_GATEWAY_API_KEY_PLATFORM",
  "AI_GATEWAY_KEY_PLUGINS",
  "AI_GATEWAY_KEY_PLUGIN",
  "AI_GATEWAY_API_KEY_PLUGIN",
  "AI_GATEWAY_API_KEY",
] as const;

function clearAuthEnvironment() {
  for (const name of AUTH_ENV_NAMES) delete process.env[name];
}

describe("AI Gateway authentication routing", () => {
  test("keeps plugin, platform, shared, and OIDC authentication distinct", () => {
    const saved = Object.fromEntries(
      AUTH_ENV_NAMES.map((name) => [name, process.env[name]]),
    );

    try {
      clearAuthEnvironment();
      process.env.AI_GATEWAY_KEY_MODERATION = "moderation-key";
      gatewayModel("moderation", "test/model");
      expect(gatewayOptions.at(-1)).toEqual({ apiKey: "moderation-key" });

      process.env.AI_GATEWAY_KEY_MODERATION = "rotated-moderation-key";
      gatewayModel("moderation", "test/model");
      expect(gatewayOptions.at(-1)).toEqual({
        apiKey: "rotated-moderation-key",
      });

      clearAuthEnvironment();
      process.env.AI_GATEWAY_API_KEY_PLATFORM = "old-platform-key";
      gatewayModel("platform", "test/model");
      expect(gatewayOptions.at(-1)).toEqual({ apiKey: "old-platform-key" });

      clearAuthEnvironment();
      process.env.AI_GATEWAY_KEY_PLUGINS = "plugin-key";
      gatewayModel("plugin", "test/model");
      expect(gatewayOptions.at(-1)).toEqual({ apiKey: "plugin-key" });

      clearAuthEnvironment();
      process.env.AI_GATEWAY_KEY_PLATFORM = "platform-key";
      process.env.AI_GATEWAY_API_KEY_PLATFORM = "old-platform-key";
      process.env.AI_GATEWAY_API_KEY = "shared-key";
      gatewayModel("plugin", "test/model");
      expect(gatewayOptions.at(-1)).toEqual({ apiKey: "shared-key" });

      clearAuthEnvironment();
      gatewayModel("plugin", "test/model");
      expect(gatewayOptions.at(-1)).toEqual({});
      expect(gatewayOptions).toHaveLength(6);
    } finally {
      clearAuthEnvironment();
      for (const name of AUTH_ENV_NAMES) {
        const value = saved[name];
        if (value !== undefined) process.env[name] = value;
      }
    }
  });
});
