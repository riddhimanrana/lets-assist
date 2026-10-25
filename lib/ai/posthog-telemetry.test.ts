import { describe, expect, test } from "bun:test";
import {
  createPluginTelemetry,
  createPostHogTelemetry,
  type PostHogTelemetryMetadata,
} from "./posthog-telemetry";

function inEnvironment<T>(
  node: string | undefined,
  vercel: string | undefined,
  run: () => T,
): T {
  const environment: Record<string, string | undefined> = process.env;
  const prior = { node: process.env.NODE_ENV, vercel: process.env.VERCEL_ENV };
  try {
    if (node === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = node;
    if (vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercel;
    return run();
  } finally {
    if (prior.node === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = prior.node;
    if (prior.vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prior.vercel;
  }
}

describe("AI telemetry privacy", () => {
  test("keeps static operational context, never caller identities or content", () => {
    const telemetry = inEnvironment("production", "production", () =>
      createPluginTelemetry({
        functionId: "dvhs-csf-application-sheet-mapping",
        distinctId: "synthetic-person@example.test",
        organizationId: "synthetic-private-organization",
        pluginKey: "synthetic-private-plugin",
        gatewayScope: "platform",
        feature: "synthetic-private-document",
        metadata: {
          prompt: "synthetic-private-prompt",
          output: "synthetic-private-response",
          email: "synthetic-person@example.test",
          feature: "synthetic-private-feature",
          gateway_scope: "platform",
          organization_id: "synthetic-private-organization",
          posthog_distinct_id: "synthetic-person@example.test",
        },
      }),
    );
    expect(telemetry).toEqual({
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
      functionId: "dvhs-csf-application-sheet-mapping",
      metadata: {
        feature: "application-sheet-mapping",
        gateway_scope: "plugin",
        plugin_key: "dvhs-csf",
      },
    });
    expect(JSON.stringify(telemetry)).not.toContain("synthetic");
  });

  test.each([
    ["development", undefined],
    ["test", undefined],
    ["production", undefined],
    ["production", "preview"],
    ["production", "development"],
    [undefined, "production"],
  ])("does not enable AI telemetry for %s / %s", (node, vercel) => {
    const telemetry = inEnvironment(node, vercel, () =>
      createPostHogTelemetry({ functionId: "parse-project" }),
    );
    expect(telemetry.isEnabled).toBe(false);
    expect(telemetry.recordInputs).toBe(false);
    expect(telemetry.recordOutputs).toBe(false);
  });

  test.each([
    "synthetic-person@example.test",
    "constructor",
    "__proto__",
    "dv-speech-debate-judge-optimizer",
    "future-ai-feature",
    "parse-project synthetic-content",
  ])("suppresses unreviewed operation %s", (functionId) => {
    const telemetry = inEnvironment("production", "production", () =>
      createPostHogTelemetry({
        functionId,
        metadata: { prompt: "synthetic-private-prompt" },
      }),
    );
    expect(telemetry).toEqual({
      isEnabled: false,
      recordInputs: false,
      recordOutputs: false,
      functionId: "unreviewed-ai-operation",
      metadata: {},
    });
  });

  test("does not read arbitrary metadata or identity getters", () => {
    let reads = 0;
    const options = {
      functionId: "paper-signup-scan",
      get distinctId(): string {
        reads++;
        throw new Error("private fixture");
      },
      get metadata(): PostHogTelemetryMetadata {
        reads++;
        throw new Error("private fixture");
      },
    };
    const telemetry = inEnvironment("production", "production", () =>
      createPostHogTelemetry(options),
    );
    expect(telemetry.isEnabled).toBe(true);
    expect(telemetry.metadata).toEqual({
      feature: "paper-signup-scan",
      gateway_scope: "platform",
    });
    expect(reads).toBe(0);
  });

  test("returns independent metadata so one caller cannot poison later events", () => {
    const first = createPostHogTelemetry({ functionId: "moderate-image" });
    first.metadata.feature = "synthetic-private-value";
    expect(
      createPostHogTelemetry({ functionId: "moderate-image" }).metadata,
    ).toEqual({ feature: "moderate-image", gateway_scope: "moderation" });
  });
});
