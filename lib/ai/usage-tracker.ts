/**
 * AI Usage Tracker
 *
 * Logs every AI call to `plugin_data.ai_usage_log` for billing attribution.
 * This is the "local DB" side of the dual-write strategy:
 *   - PostHog: dashboards, alerts, model performance (via experimental_telemetry)
 *   - This: billing per org, usage caps, cost tracking
 *
 * Should be called after every AI Gateway response.
 */

import { createClient } from "@/lib/supabase/server";
import type { AiWorkloadScope } from "./gateway";

export interface AiUsageRecord {
  /** Organization that should be billed. Null for platform-level calls. */
  organizationId?: string | null;
  /** User who triggered the AI call */
  userId?: string | null;
  /** Plugin that made the call (null for core platform features) */
  pluginKey?: string | null;
  /** Gateway scope used: moderation, platform, plugin */
  gatewayScope: AiWorkloadScope;
  /** Model identifier, e.g. 'anthropic/claude-sonnet-4.6' */
  modelId: string;
  /** Feature name for grouping, e.g. 'content-moderation', 'judge-optimizer' */
  feature?: string;
  /** Input (prompt) tokens */
  inputTokens?: number;
  /** Output (completion) tokens */
  outputTokens?: number;
  /** Pre-calculated cost in USD, if available */
  estimatedCostUsd?: number;
  /** Response latency in milliseconds */
  latencyMs?: number;
  /** Whether the call succeeded */
  success?: boolean;
  /** Error message if failed */
  errorMessage?: string;
  /** Any additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Log an AI usage record for billing attribution.
 *
 * This is fire-and-forget — failures are logged but don't propagate.
 * We never want a billing log failure to break user-facing AI features.
 */
export async function logAiUsage(record: AiUsageRecord): Promise<void> {
  try {
    const supabase = await createClient();

    const { error } = await supabase.rpc("execute_sql" as never, {
      query: `
        INSERT INTO plugin_data.ai_usage_log (
          organization_id, user_id, plugin_key, gateway_scope,
          model_id, feature, input_tokens, output_tokens,
          estimated_cost_usd, latency_ms, success, error_message, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
      `,
      args: [
        record.organizationId ?? null,
        record.userId ?? null,
        record.pluginKey ?? null,
        record.gatewayScope,
        record.modelId,
        record.feature ?? null,
        record.inputTokens ?? 0,
        record.outputTokens ?? 0,
        record.estimatedCostUsd ?? null,
        record.latencyMs ?? null,
        record.success ?? true,
        record.errorMessage ?? null,
        JSON.stringify(record.metadata ?? {}),
      ],
    } as never);

    if (error) {
      // Log but don't throw — billing logging should never break features
      console.error("[ai-usage-tracker] Failed to log AI usage:", error.message);
    }
  } catch (err) {
    console.error(
      "[ai-usage-tracker] Unexpected error logging AI usage:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Batch log multiple AI usage records.
 * Useful when a single user action triggers multiple AI calls.
 */
export async function logAiUsageBatch(records: AiUsageRecord[]): Promise<void> {
  await Promise.allSettled(records.map(logAiUsage));
}
