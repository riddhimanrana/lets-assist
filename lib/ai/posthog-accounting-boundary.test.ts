import { describe, expect, mock, test } from "bun:test";

const usageRecords: unknown[] = [];
const model = { id: "synthetic-model" };
mock.module("./gateway", () => ({ gatewayModel: () => model }));
mock.module("./usage-tracker", () => ({
  logAiUsage: async (record: unknown) => {
    usageRecords.push(record);
  },
}));

const { prepareTrackedAiCall } = await import("./with-ai-tracking");

describe("AI analytics and billing separation", () => {
  test("keeps plugin billing and gateway attribution while excluding identities from telemetry", async () => {
    const environment: Record<string, string | undefined> = process.env;
    const priorNode = process.env.NODE_ENV;
    const priorVercel = process.env.VERCEL_ENV;
    try {
      environment.NODE_ENV = "production";
      process.env.VERCEL_ENV = "production";
      const tracked = prepareTrackedAiCall({
        context: {
          scope: "plugin",
          organizationId: "synthetic-organization",
          userId: "synthetic-user",
          pluginKey: "dvhs-csf",
          feature: "application-sheet-mapping",
        },
        modelId: "synthetic-provider/model",
      });
      expect(Object.is(tracked.model, model)).toBe(true);
      expect(tracked.gatewayOptions).toEqual({
        user: "synthetic-user",
        tags: [
          "org:synthetic-organization",
          "plugin:dvhs-csf",
          "feature:application-sheet-mapping",
        ],
      });
      expect(tracked.telemetry.isEnabled).toBe(true);
      expect(tracked.telemetry.metadata).toEqual({
        feature: "application-sheet-mapping",
        gateway_scope: "plugin",
        plugin_key: "dvhs-csf",
      });
      expect(JSON.stringify(tracked.telemetry)).not.toContain("synthetic");
      await tracked.logUsage({
        promptTokens: 12,
        completionTokens: 3,
        latencyMs: 100,
        success: true,
      });
      expect(usageRecords).toEqual([
        {
          organizationId: "synthetic-organization",
          userId: "synthetic-user",
          pluginKey: "dvhs-csf",
          gatewayScope: "plugin",
          modelId: "synthetic-provider/model",
          feature: "application-sheet-mapping",
          inputTokens: 12,
          outputTokens: 3,
          latencyMs: 100,
          success: true,
          errorMessage: undefined,
          estimatedCostUsd: undefined,
          metadata: {
            tags: [
              "org:synthetic-organization",
              "plugin:dvhs-csf",
              "feature:application-sheet-mapping",
            ],
          },
        },
      ]);
    } finally {
      if (priorNode === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = priorNode;
      if (priorVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = priorVercel;
    }
  });
});
