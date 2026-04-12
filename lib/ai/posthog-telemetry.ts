/**
 * PostHog AI Observability Telemetry
 *
 * Creates telemetry metadata for the Vercel AI SDK's `experimental_telemetry`
 * option. This sends `$ai_generation` events to PostHog automatically, including
 * token counts, latency, model info, and custom properties.
 *
 * Enhanced to support org/plugin context for granular analytics.
 */

export type PostHogTelemetryMetadata = Record<string, string | number | boolean | null | undefined>;

type CreatePostHogTelemetryOptions = {
  /** Unique identifier for the AI function being called (e.g. 'content-moderation', 'dv-sd-judge-optimizer') */
  functionId: string;
  /** PostHog distinct ID — typically the user's ID */
  distinctId?: string;
  /** Additional metadata sent with every $ai_generation event */
  metadata?: PostHogTelemetryMetadata;
};

/**
 * Convenience options for plugin-scoped AI calls.
 * Automatically adds org/plugin context to PostHog events.
 */
type CreatePluginTelemetryOptions = CreatePostHogTelemetryOptions & {
  organizationId?: string;
  pluginKey?: string;
  /** The AI Gateway scope being used */
  gatewayScope?: 'moderation' | 'platform' | 'plugin';
  /** The specific feature within the plugin (e.g. 'judge-optimizer', 'membership-review') */
  feature?: string;
};

export function createPostHogTelemetry({
  functionId,
  distinctId,
  metadata = {},
}: CreatePostHogTelemetryOptions) {
  return {
    isEnabled: true,
    functionId,
    metadata: {
      ...metadata,
      ...(distinctId ? { posthog_distinct_id: distinctId } : {}),
    },
  };
}

/**
 * Creates PostHog telemetry with plugin/org context pre-filled.
 * Use this for any AI calls made from plugin code.
 *
 * @example
 * ```ts
 * const telemetry = createPluginTelemetry({
 *   functionId: 'dv-sd-judge-optimizer',
 *   distinctId: userId,
 *   organizationId: orgId,
 *   pluginKey: 'dv-speech-debate',
 *   feature: 'judge-optimizer',
 *   gatewayScope: 'plugin',
 * });
 *
 * const result = await generateText({
 *   model: gatewayModel('plugin', 'anthropic/claude-sonnet-4.6'),
 *   prompt: '...',
 *   experimental_telemetry: telemetry,
 * });
 * ```
 */
export function createPluginTelemetry({
  functionId,
  distinctId,
  organizationId,
  pluginKey,
  gatewayScope,
  feature,
  metadata = {},
}: CreatePluginTelemetryOptions) {
  return createPostHogTelemetry({
    functionId,
    distinctId,
    metadata: {
      ...metadata,
      ...(organizationId ? { organization_id: organizationId } : {}),
      ...(pluginKey ? { plugin_key: pluginKey } : {}),
      ...(gatewayScope ? { gateway_scope: gatewayScope } : {}),
      ...(feature ? { feature } : {}),
    },
  });
}