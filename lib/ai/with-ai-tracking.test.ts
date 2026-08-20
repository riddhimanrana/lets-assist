import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { prepareTrackedAiCall } = await import("./with-ai-tracking");

describe("tracked AI accounting identity", () => {
  test("plugin scope requires both tenant and plugin identity", () => {
    expect(() =>
      prepareTrackedAiCall({
        context: {
          scope: "plugin",
          feature: "missing-identity",
        } as never,
        modelId: "test/model",
      }),
    ).toThrow(/organizationId and pluginKey/u);
  });

  test("host scopes cannot claim plugin billing identity", () => {
    expect(() =>
      prepareTrackedAiCall({
        context: {
          scope: "platform",
          pluginKey: "dvhs-csf",
          feature: "wrong-scope",
        } as never,
        modelId: "test/model",
      }),
    ).toThrow(/cannot claim a plugin accounting identity/u);
  });
});
