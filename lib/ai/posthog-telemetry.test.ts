import { describe, expect, it } from "bun:test";

import {
  createPluginTelemetry,
  createPostHogTelemetry,
} from "./posthog-telemetry";

describe("AI telemetry privacy", () => {
  it("never records model inputs or outputs", () => {
    expect(
      createPostHogTelemetry({
        functionId: "paper-signup-scan",
        distinctId: "synthetic-user",
      }),
    ).toMatchObject({
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
    });
  });

  it("keeps plugin telemetry limited to operational metadata", () => {
    const telemetry = createPluginTelemetry({
      functionId: "dvhs-csf-import-review",
      distinctId: "synthetic-user",
      organizationId: "synthetic-organization",
      pluginKey: "dvhs-csf",
      gatewayScope: "plugin",
      feature: "import-review",
    });

    expect(telemetry).toMatchObject({
      recordInputs: false,
      recordOutputs: false,
      metadata: {
        posthog_distinct_id: "synthetic-user",
        organization_id: "synthetic-organization",
        plugin_key: "dvhs-csf",
        gateway_scope: "plugin",
        feature: "import-review",
      },
    });
    expect(JSON.stringify(telemetry)).not.toContain("prompt");
    expect(JSON.stringify(telemetry)).not.toContain("output");
  });
});
