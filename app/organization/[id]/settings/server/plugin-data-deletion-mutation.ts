"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { getPluginDataDeletionReadiness } from "@/lib/plugins/plugin-data-deletion-readiness";
import { buildPluginDataDeletionConfirmationPhrase } from "@/lib/plugins/plugin-data-deletion-confirmation";
import { runPermanentPluginDataDeletion } from "@/lib/plugins/plugin-data-deletion";
import {
  isMissingPluginTableError,
  isOrganizationAdminForSettings,
  type SupabaseLikeError,
} from "./plugin-shared";

const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PermanentlyDeleteOrganizationPluginDataResult = {
  success: boolean;
  error?: string;
  message?: string;
  idempotent?: boolean;
  status?:
    "succeeded" | "in_progress" | "retryable_failed" | "manual_reconciliation";
  canRetry?: boolean;
  auditWarning?: boolean;
};

/**
 * Permanently and irreversibly erases one organization's data for one
 * plugin. Distinct from `uninstallOrganizationPlugin`, which never runs
 * plugin code and never touches plugin-owned data — this action requires
 * fresh, MFA-aware authentication, organization-admin authorization,
 * catalog/entitlement validation identical to install/uninstall, a
 * manifest-declared and mechanically-gated deletion contract, and a typed
 * confirmation binding the exact organization and plugin identity before
 * it runs `onDataDelete`.
 *
 * `requestKey` must be a fresh UUID generated when the confirmation dialog
 * opens, then reused for that exact confirmation through retries. The
 * underlying request receipt (`private.plugin_data_deletion_requests`) uses
 * it to return a lost response without re-running the hook and permits a new
 * attempt only after an explicitly retryable hook failure.
 */
export async function permanentlyDeleteOrganizationPluginData(options: {
  organizationId: string;
  pluginKey: string;
  confirmationText: string;
  requestKey: string;
}): Promise<PermanentlyDeleteOrganizationPluginDataResult> {
  "use server";
  const { organizationId, pluginKey, confirmationText, requestKey } = options;

  if (!REQUEST_KEY_PATTERN.test(requestKey)) {
    return {
      success: false,
      error: "A valid request identifier is required.",
    };
  }

  // Sensitive + MFA-aware auth: this is a permanent, irreversible action,
  // so it uses the same freshness bar as password/email changes rather
  // than the fast-path JWT-claims check most plugin actions use.
  const authResult = await getAuthUser({
    sensitive: true,
    checkMfa: true,
  }).catch(() => null);

  if (!authResult || authResult.error) {
    return {
      success: false,
      error:
        "Unable to verify your authentication for permanent deletion. Try again after authentication is available.",
    };
  }

  const { user, requiresMfa } = authResult;

  if (!user) {
    return {
      success: false,
      error: requiresMfa
        ? "Verify your identity with two-factor authentication before permanently deleting plugin data."
        : "You must be logged in to permanently delete plugin data.",
    };
  }

  const adminSupabase = getAdminClient();
  const isAdmin = await isOrganizationAdminForSettings(
    organizationId,
    user.id,
    adminSupabase,
  );
  if (!isAdmin) {
    return {
      success: false,
      error: "Only organization admins can permanently delete plugin data",
    };
  }

  const definition = getRegisteredPlugin(pluginKey);
  if (!definition) {
    return {
      success: false,
      error:
        "This plugin package is not loaded in the current deployment yet. Please try again in a moment.",
    };
  }

  const readiness = getPluginDataDeletionReadiness(definition);
  if (!readiness.ready) {
    return {
      success: false,
      error:
        "Permanent data deletion is not available for this plugin. Its manifest has not declared a reviewed deletion contract, or it has no data-deletion hook implemented. Contact platform support.",
    };
  }

  const { data: pluginCatalog, error: pluginCatalogError } =
    (await adminSupabase
      .from("plugins")
      .select("key, name, visibility, is_active")
      .eq("key", pluginKey)
      .maybeSingle()) as {
      data: {
        key: string;
        name: string;
        visibility: "global" | "private";
        is_active: boolean;
      } | null;
      error: SupabaseLikeError | null;
    };

  if (isMissingPluginTableError(pluginCatalogError)) {
    return {
      success: false,
      error:
        "Plugin platform tables are not initialized in this environment yet.",
    };
  }

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to validate plugin availability: ${pluginCatalogError.message}`,
    };
  }

  if (!pluginCatalog || !pluginCatalog.is_active) {
    return { success: false, error: "Plugin is not active in the catalog." };
  }

  const { data: entitlement } = await adminSupabase
    .from("organization_plugin_entitlements")
    .select("id, is_forced, status, starts_at, ends_at")
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey)
    .maybeSingle();

  const now = new Date();
  const entitlementIsActive =
    Boolean(entitlement) &&
    entitlement?.status === "active" &&
    (!entitlement.starts_at || new Date(entitlement.starts_at) <= now) &&
    (!entitlement.ends_at || new Date(entitlement.ends_at) >= now);

  if (entitlement?.is_forced && entitlementIsActive) {
    return {
      success: false,
      error:
        "This plugin is managed by platform administrators. Contact platform support to request permanent data deletion.",
    };
  }

  if (pluginCatalog.visibility === "private" && !entitlementIsActive) {
    return {
      success: false,
      error:
        "Private plugins require an active entitlement. Contact support for assistance.",
    };
  }

  const { data: organization, error: organizationError } = await adminSupabase
    .from("organizations")
    .select("id, name, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError) {
    return {
      success: false,
      error: `Failed to load organization: ${organizationError.message}`,
    };
  }
  if (!organization) {
    return { success: false, error: "Organization was not found." };
  }

  const expectedConfirmation = buildPluginDataDeletionConfirmationPhrase(
    organization.name,
    organizationId,
    pluginKey,
  );
  if (confirmationText.trim() !== expectedConfirmation) {
    return {
      success: false,
      error: `Confirmation text did not match. Type "${expectedConfirmation}" exactly to permanently delete this plugin's data.`,
    };
  }

  const result = await runPermanentPluginDataDeletion({
    organizationId,
    pluginKey,
    actor: { id: user.id, type: "user" },
    organizationRole: "admin",
    confirmationText: confirmationText.trim(),
    requestKey,
  });

  const organizationSlug = organization.username || organization.id;
  revalidatePath(`/organization/${organizationSlug}`);
  revalidatePath(`/organization/${organizationSlug}/settings`);
  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to permanently delete plugin data.",
      idempotent: result.idempotent,
      status: result.status,
      canRetry: result.canRetry,
      auditWarning: result.auditWarning,
    };
  }

  return {
    success: true,
    idempotent: result.idempotent,
    status: result.status,
    auditWarning: result.auditWarning,
    message: result.auditWarning
      ? `${pluginCatalog.name}'s data was permanently deleted, but its audit record could not be confirmed. Do not retry; contact platform support.`
      : result.idempotent
        ? `${pluginCatalog.name}'s data for this organization was already permanently deleted by this request.`
        : `${pluginCatalog.name}'s data for this organization has been permanently deleted. This cannot be undone.`,
  };
}
