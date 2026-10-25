import { telemetryRuntime } from "../telemetry-runtime";

export type PostHogTelemetryMetadata = Record<
  string,
  string | number | boolean | null | undefined
>;
type CreatePostHogTelemetryOptions = {
  functionId: string;
  /** Caller compatibility only. Identities and arbitrary metadata are never exported. */
  distinctId?: string;
  metadata?: PostHogTelemetryMetadata;
};
type CreatePluginTelemetryOptions = CreatePostHogTelemetryOptions & {
  organizationId?: string;
  pluginKey?: string;
  gatewayScope?: "moderation" | "platform" | "plugin";
  feature?: string;
};
type Operation = {
  feature: string;
  gateway_scope: "moderation" | "platform" | "plugin";
  plugin_key?: "dvhs-csf";
};

// These names come from reviewed call sites, never user text or tenant IDs.
const OPERATIONS = new Map<string, Operation>([
  [
    "moderate-image",
    { feature: "moderate-image", gateway_scope: "moderation" },
  ],
  ["moderate-text", { feature: "moderate-text", gateway_scope: "moderation" }],
  [
    "ai-moderation-scan",
    { feature: "ai-moderation-scan", gateway_scope: "moderation" },
  ],
  [
    "ai-moderation-report-review",
    { feature: "ai-moderation-report-review", gateway_scope: "moderation" },
  ],
  [
    "ai-moderation-project-review",
    { feature: "ai-moderation-project-review", gateway_scope: "moderation" },
  ],
  ["parse-project", { feature: "parse-project", gateway_scope: "platform" }],
  [
    "paper-signup-scan",
    { feature: "paper-signup-scan", gateway_scope: "platform" },
  ],
  [
    "waiver-analysis",
    { feature: "waiver-analysis", gateway_scope: "platform" },
  ],
  [
    "waiver-analysis-vision-fallback",
    { feature: "waiver-analysis-vision-fallback", gateway_scope: "platform" },
  ],
  [
    "dvhs-csf-application-sheet-mapping",
    {
      feature: "application-sheet-mapping",
      gateway_scope: "plugin",
      plugin_key: "dvhs-csf",
    },
  ],
  [
    "dvhs-csf-partner-form-extraction",
    {
      feature: "partner-form-extraction",
      gateway_scope: "plugin",
      plugin_key: "dvhs-csf",
    },
  ],
]);

/** Keep AI observability separate from the restricted usage/billing ledger. */
export function createPostHogTelemetry({
  functionId,
}: CreatePostHogTelemetryOptions) {
  const operation =
    typeof functionId === "string" ? OPERATIONS.get(functionId) : undefined;
  const metadata: Record<string, string> = operation
    ? {
        feature: operation.feature,
        gateway_scope: operation.gateway_scope,
        ...(operation.plugin_key ? { plugin_key: operation.plugin_key } : {}),
      }
    : {};
  return {
    isEnabled: Boolean(operation) && telemetryRuntime().enabled,
    recordInputs: false,
    recordOutputs: false,
    functionId: operation ? functionId : "unreviewed-ai-operation",
    metadata,
  };
}

export function createPluginTelemetry(options: CreatePluginTelemetryOptions) {
  return createPostHogTelemetry({ functionId: options.functionId });
}
