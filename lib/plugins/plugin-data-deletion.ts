import "server-only";

import crypto from "node:crypto";

import { logPluginAuditStrict } from "@/lib/plugins/audit";
import { runPluginDataDelete } from "@/lib/plugins/lifecycle";
import { buildPluginDataDeletionConfirmationPhrase } from "@/lib/plugins/plugin-data-deletion-confirmation";
import { getPluginDataDeletionReadiness } from "@/lib/plugins/plugin-data-deletion-readiness";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { getAdminClient } from "@/lib/supabase/admin";
import { hasActiveOrganizationAdminMembership } from "@/lib/organization/active-membership";
import type {
  OrganizationPluginAccessRole,
  OrganizationWithRole,
} from "@/types/plugin";

type OrganizationRow = {
  id: string;
  name: string;
  username: string | null;
  description: string | null;
  logo_url: string | null;
  type: string;
  verified: boolean | null;
  allowed_email_domains: string[] | null;
  show_members_publicly: boolean | null;
};

type PluginCatalogRow = {
  key: string;
  visibility: "global" | "private";
  is_active: boolean;
};

type EntitlementRow = {
  status: string;
  is_forced: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type BeginReceipt = {
  request_id: string;
  decision: "execute" | "in_progress" | "succeeded" | "manual_reconciliation";
  status:
    "processing" | "retryable_failed" | "succeeded" | "manual_reconciliation";
  claim_token: string | null;
  attempt_count: number;
  safe_error_code: string | null;
  audit_status: "pending" | "succeeded" | "failed";
};

export type PluginDataDeletionActor = {
  id: string;
  type: "user" | "admin";
};

export type PluginDataDeletionInput = {
  organizationId: string;
  pluginKey: string;
  actor: PluginDataDeletionActor;
  organizationRole?: OrganizationPluginAccessRole;
  confirmationText: string;
  requestKey: string;
};

export type PluginDataDeletionResult = {
  success: boolean;
  error?: string;
  idempotent?: boolean;
  status?:
    "succeeded" | "in_progress" | "retryable_failed" | "manual_reconciliation";
  canRetry?: boolean;
  auditWarning?: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function organizationContext(
  organization: OrganizationRow,
  role: OrganizationPluginAccessRole,
): OrganizationWithRole {
  return {
    id: organization.id,
    name: organization.name,
    username: organization.username || organization.id,
    description: organization.description ?? undefined,
    logo_url: organization.logo_url ?? undefined,
    type: organization.type,
    verified: Boolean(organization.verified),
    allowed_email_domains: organization.allowed_email_domains,
    show_members_publicly: organization.show_members_publicly,
    role,
  };
}

function computeRequestFingerprint(input: {
  organizationId: string;
  pluginKey: string;
  actorId: string;
  confirmationText: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        operation: "plugin_data_delete",
        organizationId: input.organizationId,
        pluginKey: input.pluginKey,
        actorId: input.actorId,
        confirmationText: input.confirmationText,
      }),
    )
    .digest("hex");
}

function entitlementIsActive(
  entitlement: EntitlementRow | null,
  now: Date,
): boolean {
  return Boolean(
    entitlement &&
    entitlement.status === "active" &&
    (!entitlement.starts_at || new Date(entitlement.starts_at) <= now) &&
    (!entitlement.ends_at || new Date(entitlement.ends_at) >= now),
  );
}

/**
 * Destructive service boundary. The Server Action performs fresh/MFA-aware
 * authentication; this layer independently revalidates exact current
 * membership, registry, catalog, entitlement, install, confirmation, and
 * receipt state immediately before invoking plugin code.
 *
 * Receipt ordering is intentionally hook -> durable completion -> audit.
 * Therefore an audit failure can produce an audit warning, but can never
 * rewrite successful deletion into a failed/replayable hook attempt.
 */
export async function runPermanentPluginDataDeletion(
  input: PluginDataDeletionInput,
): Promise<PluginDataDeletionResult> {
  if (
    !UUID_PATTERN.test(input.requestKey) ||
    !UUID_PATTERN.test(input.organizationId) ||
    !UUID_PATTERN.test(input.actor.id)
  ) {
    return {
      success: false,
      error: "Valid organization, actor, and request identifiers are required.",
    };
  }

  const definition = getRegisteredPlugin(input.pluginKey);
  if (!definition) {
    return {
      success: false,
      error: "This plugin package is not loaded in the current deployment.",
    };
  }

  const readiness = getPluginDataDeletionReadiness(definition);
  if (!readiness.ready) {
    return {
      success: false,
      error:
        "Permanent data deletion is not available because this plugin has no complete, reviewed, retry-safe deletion contract.",
    };
  }

  const service = getAdminClient();
  const lockToken = crypto.randomUUID();
  const { data: acquired, error: acquireError } = await service.rpc(
    "acquire_plugin_control_plane_transition_lock",
    {
      p_organization_id: input.organizationId,
      p_plugin_key: input.pluginKey,
      p_lock_token: lockToken,
      p_ttl_seconds: 900,
    },
  );
  if (acquireError) {
    return {
      success: false,
      error: `Failed to acquire the plugin transition lock: ${acquireError.message}`,
    };
  }
  if (acquired !== true) {
    return {
      success: false,
      error:
        "Another install, uninstall, or deletion transition is already running for this plugin.",
    };
  }

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  try {
    refreshTimer = setInterval(() => {
      void (async () => {
        try {
          await service.rpc("refresh_plugin_control_plane_transition_lock", {
            p_organization_id: input.organizationId,
            p_plugin_key: input.pluginKey,
            p_lock_token: lockToken,
            p_ttl_seconds: 900,
          });
        } catch {
          // The initial 15-minute lease exceeds the current request runtime.
          // A refresh is defense in depth for future longer-running hooks.
        }
      })();
    }, 300_000);

    return await runPermanentPluginDataDeletionWithLease({
      input,
      definition,
      service,
    });
  } finally {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    try {
      await service.rpc("release_plugin_control_plane_transition_lock", {
        p_organization_id: input.organizationId,
        p_plugin_key: input.pluginKey,
        p_lock_token: lockToken,
      });
    } catch {
      // The lease expires automatically. Releasing it must not rewrite a
      // terminal destructive receipt or produce a misleading replay state.
    }
  }
}

async function runPermanentPluginDataDeletionWithLease(options: {
  input: PluginDataDeletionInput;
  definition: NonNullable<ReturnType<typeof getRegisteredPlugin>>;
  service: ReturnType<typeof getAdminClient>;
}): Promise<PluginDataDeletionResult> {
  const { input, definition, service } = options;
  const { data: organizationRow, error: organizationError } = await service
    .from("organizations")
    .select(
      "id, name, username, description, logo_url, type, verified, allowed_email_domains, show_members_publicly",
    )
    .eq("id", input.organizationId)
    .maybeSingle();
  if (organizationError) {
    return {
      success: false,
      error: `Failed to load organization context: ${organizationError.message}`,
    };
  }
  if (!organizationRow) {
    return { success: false, error: "Organization was not found." };
  }
  const organization = organizationRow as OrganizationRow;

  if (
    input.actor.type !== "user" ||
    !(await hasActiveOrganizationAdminMembership(
      service,
      input.organizationId,
      input.actor.id,
    ))
  ) {
    return {
      success: false,
      error: "A current organization admin is required for permanent deletion.",
    };
  }

  const { data: pluginCatalog, error: catalogError } = await service
    .from("plugins")
    .select("key, visibility, is_active")
    .eq("key", input.pluginKey)
    .maybeSingle();
  if (catalogError) {
    return {
      success: false,
      error: `Failed to validate plugin availability: ${catalogError.message}`,
    };
  }
  const catalog = pluginCatalog as PluginCatalogRow | null;
  if (!catalog || !catalog.is_active) {
    return { success: false, error: "Plugin is not active in the catalog." };
  }

  const { data: entitlementRow, error: entitlementError } = await service
    .from("organization_plugin_entitlements")
    .select("status, is_forced, starts_at, ends_at")
    .eq("organization_id", input.organizationId)
    .eq("plugin_key", input.pluginKey)
    .maybeSingle();
  if (entitlementError) {
    return {
      success: false,
      error: `Failed to validate plugin entitlement: ${entitlementError.message}`,
    };
  }
  const entitlement = entitlementRow as EntitlementRow | null;
  const hasActiveEntitlement = entitlementIsActive(entitlement, new Date());
  if (hasActiveEntitlement && entitlement?.is_forced) {
    return {
      success: false,
      error:
        "This plugin is managed by platform administrators. Contact platform support to request permanent data deletion.",
    };
  }
  if (catalog.visibility === "private" && !hasActiveEntitlement) {
    return {
      success: false,
      error:
        "Private plugins require an active entitlement before data deletion.",
    };
  }

  const { data: install, error: installError } = await service
    .from("organization_plugin_installs")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("plugin_key", input.pluginKey)
    .maybeSingle();
  if (installError) {
    return {
      success: false,
      error: `Failed to validate plugin install state: ${installError.message}`,
    };
  }
  if (install) {
    return {
      success: false,
      error:
        "Uninstall this plugin before permanently deleting its retained data.",
    };
  }

  const expectedConfirmation = buildPluginDataDeletionConfirmationPhrase(
    organization.name,
    input.organizationId,
    input.pluginKey,
  );
  if (input.confirmationText.trim() !== expectedConfirmation) {
    return {
      success: false,
      error: `Confirmation text did not match. Type "${expectedConfirmation}" exactly to permanently delete this plugin's data.`,
    };
  }

  const requestFingerprint = computeRequestFingerprint({
    organizationId: input.organizationId,
    pluginKey: input.pluginKey,
    actorId: input.actor.id,
    confirmationText: expectedConfirmation,
  });
  if (
    !(await hasActiveOrganizationAdminMembership(
      service,
      input.organizationId,
      input.actor.id,
    ))
  ) {
    return {
      success: false,
      error: "A current organization admin is required for permanent deletion.",
    };
  }
  const { data: beginRows, error: beginError } = await service.rpc(
    "begin_plugin_data_deletion_request",
    {
      p_organization_id: input.organizationId,
      p_plugin_key: input.pluginKey,
      p_request_key: input.requestKey,
      p_request_fingerprint: requestFingerprint,
      p_actor_id: input.actor.id,
    },
  );
  if (beginError) {
    return {
      success: false,
      error: `Failed to claim the plugin data deletion request: ${beginError.message}`,
    };
  }
  const receipt = (
    Array.isArray(beginRows) ? beginRows[0] : beginRows
  ) as BeginReceipt | null;
  if (!receipt) {
    return {
      success: false,
      error: "Failed to claim the plugin data deletion request.",
    };
  }

  if (receipt.decision === "succeeded") {
    return {
      success: true,
      status: "succeeded",
      idempotent: true,
      auditWarning: receipt.audit_status === "failed",
    };
  }
  if (receipt.decision === "in_progress") {
    return {
      success: false,
      status: "in_progress",
      idempotent: true,
      canRetry: false,
      error:
        "This deletion request is already processing or its prior outcome is unknown. Do not retry plugin code; contact platform support if it does not resolve.",
    };
  }
  if (receipt.decision === "manual_reconciliation") {
    return {
      success: false,
      status: "manual_reconciliation",
      idempotent: true,
      canRetry: false,
      error:
        "This deletion request requires manual reconciliation and cannot be retried automatically.",
    };
  }
  if (!receipt.claim_token) {
    return {
      success: false,
      status: "manual_reconciliation",
      canRetry: false,
      error:
        "The deletion attempt was not assigned a finalization claim. Contact platform support.",
    };
  }

  const hookResult = await runPluginDataDelete(definition, {
    organization: organizationContext(organization, "admin"),
    actor: input.actor,
  });

  if (!hookResult.success) {
    const { data: completed, error: completeError } = await service.rpc(
      "complete_plugin_data_deletion_request",
      {
        p_request_id: receipt.request_id,
        p_claim_token: receipt.claim_token,
        p_status: "retryable_failed",
        p_safe_error_code: "hook_reported_failure",
      },
    );
    if (completeError || completed !== true) {
      return {
        success: false,
        status: "manual_reconciliation",
        canRetry: false,
        error:
          "The plugin reported a deletion failure, but its durable receipt could not be finalized. The outcome may be partial; contact platform support and do not retry.",
      };
    }

    await auditReceipt({
      service,
      requestId: receipt.request_id,
      organizationId: input.organizationId,
      pluginKey: input.pluginKey,
      actor: input.actor,
      requestKey: input.requestKey,
      status: "retryable_failed",
      attemptCount: receipt.attempt_count,
    });
    return {
      success: false,
      status: "retryable_failed",
      canRetry: true,
      error:
        "Permanent data deletion did not complete. The hook may have made partial progress; this idempotent request can be retried.",
    };
  }

  const { data: completed, error: completeError } = await service.rpc(
    "complete_plugin_data_deletion_request",
    {
      p_request_id: receipt.request_id,
      p_claim_token: receipt.claim_token,
      p_status: "succeeded",
      p_safe_error_code: null,
    },
  );
  if (completeError || completed !== true) {
    return {
      success: false,
      status: "manual_reconciliation",
      canRetry: false,
      error:
        "Plugin data deletion completed, but its durable receipt could not be finalized. Do not retry; contact platform support for reconciliation.",
    };
  }

  const auditSucceeded = await auditReceipt({
    service,
    requestId: receipt.request_id,
    organizationId: input.organizationId,
    pluginKey: input.pluginKey,
    actor: input.actor,
    requestKey: input.requestKey,
    status: "succeeded",
    attemptCount: receipt.attempt_count,
  });
  return {
    success: true,
    status: "succeeded",
    auditWarning: !auditSucceeded,
  };
}

async function auditReceipt(options: {
  service: ReturnType<typeof getAdminClient>;
  requestId: string;
  organizationId: string;
  pluginKey: string;
  actor: PluginDataDeletionActor;
  requestKey: string;
  status: "succeeded" | "retryable_failed";
  attemptCount: number;
}): Promise<boolean> {
  try {
    const auditEventId = await logPluginAuditStrict({
      organization_id: options.organizationId,
      plugin_key: options.pluginKey,
      action: "lifecycle.data_delete",
      actor_id: options.actor.id,
      actor_type: options.actor.type,
      details: {
        requestKey: options.requestKey,
        status: options.status,
        attemptCount: options.attemptCount,
      },
    });
    const { data, error } = await options.service.rpc(
      "record_plugin_data_deletion_audit_result",
      {
        p_request_id: options.requestId,
        p_audit_status: "succeeded",
        p_audit_event_id: auditEventId,
        p_audit_error_code: null,
      },
    );
    if (error || data !== true) {
      throw new Error("Failed to attach the audit outcome to the receipt.");
    }
    return true;
  } catch {
    try {
      await options.service.rpc("record_plugin_data_deletion_audit_result", {
        p_request_id: options.requestId,
        p_audit_status: "failed",
        p_audit_event_id: null,
        p_audit_error_code: "audit_write_failed",
      });
    } catch {
      // The deletion receipt is already terminal. Never rewrite or replay it
      // merely because attaching the independent audit outcome also failed.
    }
    return false;
  }
}
