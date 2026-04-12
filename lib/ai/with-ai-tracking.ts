/**
 * AI Tracking Wrapper
 *
 * Higher-order utilities that wrap AI SDK calls with both:
 *   1. PostHog telemetry (via experimental_telemetry → $ai_generation events)
 *   2. Local usage logging (via plugin_data.ai_usage_log → billing)
 *
 * This is the recommended way to make AI calls from plugin code.
 */

import type { AiWorkloadScope } from "./gateway";
import { gatewayModel } from "./gateway";
import { createPluginTelemetry, createPostHogTelemetry } from "./posthog-telemetry";
import { logAiUsage } from "./usage-tracker";

// Re-export for convenience
export { gatewayModel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiTrackingContext {
  /** AI Gateway scope for key resolution */
  scope: AiWorkloadScope;
  /** User who triggered the call */
  userId?: string;
  /** Organization context for billing */
  organizationId?: string;
  /** Plugin making the call (null for core platform) */
  pluginKey?: string;
  /** Feature name for grouping (e.g. 'content-moderation', 'judge-optimizer') */
  feature: string;
}

export interface TrackedAiOptions {
  /** Context for tracking */
  context: AiTrackingContext;
  /** AI model identifier (e.g. 'anthropic/claude-sonnet-4.6') */
  modelId: string;
}

export interface TrackedAiResult {
  /** PostHog telemetry config — pass to `experimental_telemetry` */
  telemetry: ReturnType<typeof createPostHogTelemetry>;
  /** Model instance — pass to `model` */
  model: ReturnType<typeof gatewayModel>;
  /** Gateway provider options — pass to `providerOptions.gateway` if you want Vercel tags */
  gatewayOptions: {
    user?: string;
    tags?: string[];
  };
  /**
   * Call this AFTER the AI response to log usage for billing.
   * Token counts are optional — the AI SDK provides them via `usage` in the response.
   */
  logUsage: (usage?: {
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    success?: boolean;
    errorMessage?: string;
    estimatedCostUsd?: number;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Prepare a tracked AI call. Returns everything you need for a `generateText`
 * or `streamText` call, plus a `logUsage` callback to call after.
 *
 * @example
 * ```ts
 * const tracked = prepareTrackedAiCall({
 *   context: {
 *     scope: 'plugin',
 *     userId: user.id,
 *     organizationId: org.id,
 *     pluginKey: 'dv-speech-debate',
 *     feature: 'judge-optimizer',
 *   },
 *   modelId: 'anthropic/claude-sonnet-4.6',
 * });
 *
 * const result = await generateText({
 *   model: tracked.model,
 *   prompt: '...',
 *   experimental_telemetry: tracked.telemetry,
 * });
 *
 * await tracked.logUsage({
 *   promptTokens: result.usage?.promptTokens,
 *   completionTokens: result.usage?.completionTokens,
 * });
 * ```
 */
export function prepareTrackedAiCall(options: TrackedAiOptions): TrackedAiResult {
  const { context, modelId } = options;
  const { scope, userId, organizationId, pluginKey, feature } = context;

  // Build the function ID for PostHog
  const functionId = pluginKey ? `${pluginKey}-${feature}` : feature;

  // PostHog telemetry
  const telemetry = pluginKey
    ? createPluginTelemetry({
        functionId,
        distinctId: userId,
        organizationId,
        pluginKey,
        gatewayScope: scope,
        feature,
      })
    : createPostHogTelemetry({
        functionId,
        distinctId: userId,
        metadata: {
          gateway_scope: scope,
          feature,
          ...(organizationId ? { organization_id: organizationId } : {}),
        },
      });

  // Model instance
  const model = gatewayModel(scope, modelId);

  // Vercel AI Gateway tags
  const tags: string[] = [];
  if (organizationId) tags.push(`org:${organizationId}`);
  if (pluginKey) tags.push(`plugin:${pluginKey}`);
  tags.push(`feature:${feature}`);

  const gatewayOptions = {
    ...(userId ? { user: userId } : {}),
    tags,
  };

  // Usage logger (call after response)
  const logUsage = async (usage?: {
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    success?: boolean;
    errorMessage?: string;
    estimatedCostUsd?: number;
  }) => {
    await logAiUsage({
      organizationId,
      userId,
      pluginKey,
      gatewayScope: scope,
      modelId,
      feature,
      inputTokens: usage?.promptTokens ?? 0,
      outputTokens: usage?.completionTokens ?? 0,
      latencyMs: usage?.latencyMs,
      success: usage?.success ?? true,
      errorMessage: usage?.errorMessage,
      estimatedCostUsd: usage?.estimatedCostUsd,
      metadata: { tags },
    });
  };

  return {
    telemetry,
    model,
    gatewayOptions,
    logUsage,
  };
}
