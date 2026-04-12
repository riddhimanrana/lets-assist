import { createClient } from "@/lib/supabase/server";

/**
 * Plugin audit action types
 */
export type PluginAuditAction =
  // Plugin lifecycle
  | "plugin.created"
  | "plugin.updated"
  | "plugin.activated"
  | "plugin.deactivated"
  // Entitlements
  | "entitlement.granted"
  | "entitlement.revoked"
  | "entitlement.updated"
  // Install lifecycle
  | "install.created"
  | "install.enabled"
  | "install.disabled"
  | "install.updated"
  | "install.config_changed"
  | "install.version_updated"
  | "install.removed"
  // Plugin hooks
  | "lifecycle.install"
  | "lifecycle.uninstall"
  | "lifecycle.enable"
  | "lifecycle.disable"
  | "lifecycle.config_update"
  | "lifecycle.version_update"
  | "lifecycle.data_delete"
  // Execution tracking
  | "execution.surface"
  | "execution.behavior"
  | "execution.api"
  | "execution.error";

export type PluginAuditActorType = "user" | "system" | "admin";

export interface PluginAuditLogEntry {
  organization_id?: string | null;
  plugin_key?: string | null;
  action: PluginAuditAction;
  actor_id?: string | null;
  actor_type?: PluginAuditActorType;
  details?: Record<string, unknown>;
  execution_time_ms?: number | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

/**
 * Log a plugin audit event
 */
export async function logPluginAudit(
  entry: PluginAuditLogEntry,
): Promise<string | null> {
  const supabase = await createClient();

  // Get current user if not provided
  let actorId = entry.actor_id;
  if (!actorId && entry.actor_type !== "system") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    actorId = user?.id ?? null;
  }

  const { data, error } = await supabase.rpc("log_plugin_audit", {
    p_organization_id: entry.organization_id ?? null,
    p_plugin_key: entry.plugin_key ?? null,
    p_action: entry.action,
    p_actor_id: actorId ?? null,
    p_actor_type: entry.actor_type ?? "user",
    p_details: entry.details ?? {},
    p_execution_time_ms: entry.execution_time_ms ?? null,
  });

  if (error) {
    console.error("Failed to log plugin audit:", error);
    return null;
  }

  return data as string;
}

/**
 * Track plugin execution metrics
 */
export async function trackPluginExecution(
  organizationId: string,
  pluginKey: string,
  executionTimeMs: number,
  isError: boolean = false,
  errorMessage?: string,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("update_plugin_execution_metrics", {
    p_organization_id: organizationId,
    p_plugin_key: pluginKey,
    p_execution_time_ms: executionTimeMs,
    p_is_error: isError,
    p_error_message: errorMessage ?? null,
  });

  if (error) {
    console.error("Failed to track plugin execution metrics:", error);
  }
}

/**
 * Get audit logs for an organization
 */
export async function getOrganizationPluginAuditLogs(
  organizationId: string,
  options?: {
    pluginKey?: string;
    action?: PluginAuditAction;
    limit?: number;
    offset?: number;
  },
) {
  const supabase = await createClient();

  let query = supabase
    .from("plugin_audit_logs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (options?.pluginKey) {
    query = query.eq("plugin_key", options.pluginKey);
  }

  if (options?.action) {
    query = query.eq("action", options.action);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 50));
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to get audit logs:", error);
    return [];
  }

  return data;
}

/**
 * Helper to wrap plugin execution with timing and error tracking
 */
export async function withPluginExecution<T>(
  organizationId: string,
  pluginKey: string,
  executionType: "surface" | "behavior" | "api",
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  let isError = false;
  let errorMessage: string | undefined;

  try {
    const result = await fn();
    return result;
  } catch (error) {
    isError = true;
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const executionTimeMs = Date.now() - startTime;

    // Track execution metrics
    await trackPluginExecution(
      organizationId,
      pluginKey,
      executionTimeMs,
      isError,
      errorMessage,
    );

    // Log audit event
    await logPluginAudit({
      organization_id: organizationId,
      plugin_key: pluginKey,
      action: isError
        ? "execution.error"
        : (`execution.${executionType}` as PluginAuditAction),
      actor_type: "system",
      execution_time_ms: executionTimeMs,
      details: isError ? { error: errorMessage } : undefined,
    });
  }
}
