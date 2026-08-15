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

import { getAdminClient } from "@/lib/supabase/admin";
import type { AiWorkloadScope } from "./gateway";

/**
 * Set once the first write failure has been reported.
 *
 * A broken write path is not a per-call incident, it is a standing outage: the
 * previous implementation called a nonexistent RPC and logged the same error on
 * every AI call, which is precisely the shape of noise that gets filtered out
 * and ignored. The first failure is therefore reported loudly and the rest are
 * counted, so a permanent breakage stays visible without flooding the log.
 */
let writeFailuresSinceStartup = 0;

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
 * Report a usage-write failure.
 *
 * Deliberately not silent. The previous implementation caught every failure and
 * emitted an indistinguishable one-line console.error, so a write path that was
 * broken for the lifetime of the project looked identical to a transient blip
 * and nobody noticed the table was empty.
 *
 * The first failure carries the full record so the cause is diagnosable from a
 * single log line, and every failure re-states the running total so a permanent
 * outage is legible as one.
 */
function reportUsageWriteFailure(
  record: AiUsageRecord,
  cause: string,
  detail?: unknown,
): void {
  writeFailuresSinceStartup += 1;

  const summary =
    `[ai-usage-tracker] BILLING WRITE FAILED (${writeFailuresSinceStartup} since startup) — ` +
    `AI usage is NOT being recorded. cause=${cause} ` +
    `scope=${record.gatewayScope} model=${record.modelId} feature=${record.feature ?? "none"}`;

  if (writeFailuresSinceStartup === 1) {
    console.error(summary, {
      organizationId: record.organizationId ?? null,
      userId: record.userId ?? null,
      pluginKey: record.pluginKey ?? null,
      inputTokens: record.inputTokens ?? 0,
      outputTokens: record.outputTokens ?? 0,
      detail,
    });
    return;
  }

  console.error(summary);
}

/**
 * Log an AI usage record for billing attribution.
 *
 * Writes through public.log_ai_usage, a service-role-only SECURITY DEFINER
 * function. plugin_data is not exposed through the Data API, so a direct
 * supabase-js insert cannot reach it.
 *
 * Failures still do not propagate — a billing log must never break a
 * user-facing AI feature — but they are reported loudly rather than swallowed.
 * See reportUsageWriteFailure.
 */
export async function logAiUsage(record: AiUsageRecord): Promise<void> {
  try {
    const supabase = getAdminClient();

    const { error } = await supabase.rpc("log_ai_usage", {
      p_gateway_scope: record.gatewayScope,
      p_model_id: record.modelId,
      p_organization_id: record.organizationId ?? null,
      p_user_id: record.userId ?? null,
      p_plugin_key: record.pluginKey ?? null,
      p_feature: record.feature ?? null,
      p_input_tokens: record.inputTokens ?? 0,
      p_output_tokens: record.outputTokens ?? 0,
      p_estimated_cost_usd: record.estimatedCostUsd ?? null,
      p_latency_ms: record.latencyMs ?? null,
      p_success: record.success ?? true,
      p_error_message: record.errorMessage ?? null,
      p_metadata: record.metadata ?? {},
    });

    if (error) {
      reportUsageWriteFailure(record, error.code || "rpc_error", error.message);
    }
  } catch (err) {
    reportUsageWriteFailure(
      record,
      "unexpected_error",
      err instanceof Error ? `${err.name}: ${err.message}` : err,
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
