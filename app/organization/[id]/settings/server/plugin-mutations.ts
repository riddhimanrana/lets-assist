"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { getPluginDataDeletionReadiness } from "@/lib/plugins/plugin-data-deletion-readiness";
import { resolvePluginApplicationEnvironment } from "@/lib/plugins/application-environment";
import {
  describePluginUninstallImpact,
  extractDataAccessPurposes,
} from "@/lib/plugins/plugin-uninstall-impact";
import { transitionOrganizationPluginInstall } from "@/lib/plugins/control-plane-transition";
import {
  applyConfigDefaults,
  validatePluginConfig,
  type PluginConfigSchema,
} from "@/lib/plugins/config-schema";
import {
  isMissingPluginTableError,
  isOrganizationAdminForSettings,
  isPlainObjectRecord,
  type SupabaseLikeError,
} from "./plugin-shared";

export async function setOrganizationPluginInstallState(options: {
  organizationId: string;
  pluginKey: string;
  enabled: boolean;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  const { organizationId, pluginKey, enabled } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to manage plugins" };
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
      error: "Only organization admins can manage plugins",
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

  const { data: pluginCatalog, error: pluginCatalogError } =
    (await adminSupabase
      .from("plugins")
      .select("key, visibility, is_active, latest_version")
      .eq("key", pluginKey)
      .eq("is_active", true)
      .maybeSingle()) as {
      data: {
        key: string;
        visibility: "global" | "private";
        is_active: boolean;
        latest_version: string;
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

  if (!pluginCatalog) {
    return { success: false, error: "Plugin is not active in the catalog." };
  }

  // Check if plugin is forced via entitlement
  const { data: entitlement } = await adminSupabase
    .from("organization_plugin_entitlements")
    .select("id, is_forced, status, starts_at, ends_at")
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey)
    .maybeSingle();

  if (entitlement?.is_forced && !enabled) {
    return {
      success: false,
      error:
        "This plugin is managed by platform administrators and cannot be disabled.",
    };
  }

  if (pluginCatalog.visibility !== "global") {
    // Check for entitlement if not global
    const { data: entitlement } = await adminSupabase
      .from("organization_plugin_entitlements")
      .select("id, status, starts_at, ends_at")
      .eq("organization_id", organizationId)
      .eq("plugin_key", pluginKey)
      .eq("status", "active")
      .maybeSingle();

    const now = new Date();
    const isEntitled =
      entitlement &&
      (!entitlement.starts_at || new Date(entitlement.starts_at) <= now) &&
      (!entitlement.ends_at || new Date(entitlement.ends_at) >= now);

    if (!isEntitled) {
      return {
        success: false,
        error:
          "Private plugins require an active entitlement. Contact support for assistance.",
      };
    }
  }

  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId,
    pluginKey,
    actor: { id: user.id, type: "user" },
    organizationRole: "admin",
    transition: enabled
      ? {
          kind: "install_or_enable",
          targetVersion: pluginCatalog.latest_version,
        }
      : { kind: "disable" },
  });

  if (!transitionResult.success) {
    return {
      success: false,
      error:
        transitionResult.error ??
        `Failed to ${enabled ? "enable" : "disable"} plugin.`,
    };
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return { success: true };
}

export async function uninstallOrganizationPlugin(options: {
  organizationId: string;
  pluginKey: string;
}): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  changed?: boolean;
}> {
  "use server";
  const { organizationId, pluginKey } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to manage plugins" };
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
      error: "Only organization admins can manage plugins",
    };
  }

  const { data: pluginCatalog, error: pluginCatalogError } =
    (await adminSupabase
      .from("plugins")
      .select("key, name, visibility")
      .eq("key", pluginKey)
      .maybeSingle()) as {
      data: {
        key: string;
        name: string;
        visibility: "global" | "private";
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

  // Check if plugin is forced via entitlement
  const { data: entitlement } = await adminSupabase
    .from("organization_plugin_entitlements")
    .select("id, is_forced")
    .eq("organization_id", organizationId)
    .eq("plugin_key", pluginKey)
    .maybeSingle();

  if (entitlement?.is_forced) {
    return {
      success: false,
      error:
        "This plugin is managed by platform administrators and cannot be uninstalled.",
    };
  }

  if (pluginCatalog?.visibility === "private") {
    // Check for entitlement if private
    const { data: entitlement } = await adminSupabase
      .from("organization_plugin_entitlements")
      .select("id, status, starts_at, ends_at")
      .eq("organization_id", organizationId)
      .eq("plugin_key", pluginKey)
      .eq("status", "active")
      .maybeSingle();

    const now = new Date();
    const isEntitled =
      entitlement &&
      (!entitlement.starts_at || new Date(entitlement.starts_at) <= now) &&
      (!entitlement.ends_at || new Date(entitlement.ends_at) >= now);

    if (!isEntitled) {
      return {
        success: false,
        error:
          "Private plugins require an active entitlement. Contact support for assistance.",
      };
    }
  }

  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId,
    pluginKey,
    actor: { id: user.id, type: "user" },
    organizationRole: "admin",
    transition: { kind: "uninstall" },
  });

  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.error ?? "Failed to uninstall plugin.",
    };
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  if (!transitionResult.changed) {
    // No install row existed for this organization/plugin pair by the time
    // this ran (a retried request, a lost first response, a double click).
    // Nothing was removed and no hook ran this time — say so truthfully
    // instead of repeating the "just uninstalled" copy for an action that
    // didn't happen.
    return {
      success: true,
      changed: false,
      message:
        "This plugin was already uninstalled. The platform's own operation did not request deletion of any stored plugin data; it remains scoped to your organization.",
    };
  }

  const definition = getRegisteredPlugin(pluginKey);
  // Use the catalog name (same source as the dialog title) to avoid
  // manifest/catalog drift when the two names differ.
  const displayName =
    pluginCatalog?.name ?? definition?.manifest.name ?? pluginKey;
  // definition is guaranteed non-null here (transitionOrganizationPluginInstall
  // returns success:false when the plugin isn't registered), but optional
  // chaining handles the technically-unreachable null without a defensive branch.
  return {
    success: true,
    changed: true,
    message: describePluginUninstallImpact({
      pluginName: displayName,
      dataAccessPurposes: extractDataAccessPurposes(
        definition?.manifest.dataAccess,
      ),
      permanentDeletionAvailable: definition
        ? getPluginDataDeletionReadiness(definition).ready
        : false,
    }).summary,
  };
}

export async function updateOrganizationPluginToLatest(options: {
  organizationId: string;
  pluginKey: string;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  const { organizationId, pluginKey } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to update plugins" };
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
      error: "Only organization admins can update plugins",
    };
  }

  const { data: pluginCatalog, error: pluginCatalogError } =
    (await adminSupabase
      .from("plugins")
      .select("key, visibility, is_active, latest_version")
      .eq("key", pluginKey)
      .eq("is_active", true)
      .maybeSingle()) as {
      data: {
        key: string;
        visibility: "global" | "private";
        is_active: boolean;
        latest_version: string;
      } | null;
      error: SupabaseLikeError | null;
    };

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to load plugin catalog entry: ${pluginCatalogError.message}`,
    };
  }

  if (!pluginCatalog) {
    return { success: false, error: "Plugin is not active in catalog." };
  }

  if (pluginCatalog.visibility !== "global") {
    // Check for entitlement if not global
    const { data: entitlement } = await adminSupabase
      .from("organization_plugin_entitlements")
      .select("id, status, starts_at, ends_at")
      .eq("organization_id", organizationId)
      .eq("plugin_key", pluginKey)
      .eq("status", "active")
      .maybeSingle();

    const now = new Date();
    const isEntitled =
      entitlement &&
      (!entitlement.starts_at || new Date(entitlement.starts_at) <= now) &&
      (!entitlement.ends_at || new Date(entitlement.ends_at) >= now);

    if (!isEntitled) {
      return {
        success: false,
        error:
          "Private plugins require an active entitlement. Contact support for assistance.",
      };
    }
  }

  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId,
    pluginKey,
    actor: { id: user.id, type: "user" },
    organizationRole: "admin",
    transition: {
      kind: "version_update",
      targetVersion: pluginCatalog.latest_version,
    },
  });

  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.error ?? "Failed to update plugin.",
    };
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return { success: true };
}

export async function setOrganizationPluginApplicationRuntime(options: {
  organizationId: string;
  pluginKey: string;
  enabled: boolean;
  targetVersion?: string;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  const { organizationId, pluginKey, enabled, targetVersion } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "You must be logged in to manage plugins" };
  }

  const environment = resolvePluginApplicationEnvironment();
  if (!environment) {
    return {
      success: false,
      error:
        "Application runtime changes are available on hosted Development and Production only.",
    };
  }
  if (enabled && !targetVersion) {
    return { success: false, error: "Choose a published application version." };
  }

  const adminSupabase = getAdminClient();
  if (
    !(await isOrganizationAdminForSettings(
      organizationId,
      user.id,
      adminSupabase,
    ))
  ) {
    return {
      success: false,
      error: "Only organization admins can change the plugin runtime",
    };
  }

  const { error } = await adminSupabase.rpc("set_plugin_application_runtime", {
    p_organization_id: organizationId,
    p_plugin_key: pluginKey,
    p_target_version: enabled ? targetVersion : null,
    p_environment: environment,
    p_enabled: enabled,
    p_actor_id: user.id,
    p_request_id: crypto.randomUUID(),
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);
  return { success: true };
}

export async function updateOrganizationPluginConfiguration(options: {
  organizationId: string;
  pluginKey: string;
  configurationJson: string;
}): Promise<{ success: boolean; error?: string; message?: string }> {
  "use server";
  const { organizationId, pluginKey, configurationJson } = options;
  const { user } = await getAuthUser();

  if (!user) {
    return {
      success: false,
      error: "You must be logged in to update plugin settings",
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
      error: "Only organization admins can update plugin settings",
    };
  }

  const definition = getRegisteredPlugin(pluginKey);
  if (!definition) {
    return {
      success: false,
      error: "This plugin package is not loaded in the current deployment.",
    };
  }

  if (definition.manifest.visibility !== "global") {
    // Check for entitlement if not global
    const { data: entitlement } = await adminSupabase
      .from("organization_plugin_entitlements")
      .select("id, status, starts_at, ends_at")
      .eq("organization_id", organizationId)
      .eq("plugin_key", pluginKey)
      .eq("status", "active")
      .maybeSingle();

    const now = new Date();
    const isEntitled =
      entitlement &&
      (!entitlement.starts_at || new Date(entitlement.starts_at) <= now) &&
      (!entitlement.ends_at || new Date(entitlement.ends_at) >= now);

    if (!isEntitled) {
      return {
        success: false,
        error:
          "Private plugins require an active entitlement. Contact support for assistance.",
      };
    }
  }

  const { data: pluginCatalog, error: pluginCatalogError } =
    (await adminSupabase
      .from("plugins")
      .select("key, visibility, is_active")
      .eq("key", pluginKey)
      .eq("is_active", true)
      .maybeSingle()) as {
      data: {
        key: string;
        visibility: "global" | "private";
        is_active: boolean;
      } | null;
      error: SupabaseLikeError | null;
    };

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to load plugin catalog entry: ${pluginCatalogError.message}`,
    };
  }

  if (!pluginCatalog) {
    return { success: false, error: "Plugin is not active in catalog." };
  }

  if (pluginCatalog.visibility !== "global") {
    return {
      success: false,
      error:
        "Private plugins are managed by the Let's Assist team. Contact support for changes.",
    };
  }

  const { data: existingInstall, error: existingInstallError } =
    (await adminSupabase
      .from("organization_plugin_installs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("plugin_key", pluginKey)
      .maybeSingle()) as {
      data: { id: string } | null;
      error: SupabaseLikeError | null;
    };

  if (existingInstallError) {
    return {
      success: false,
      error: `Failed to load plugin install state: ${existingInstallError.message}`,
    };
  }

  if (!existingInstall) {
    return {
      success: false,
      error: "Install the plugin before updating its settings.",
    };
  }

  const trimmed = configurationJson.trim();

  let parsedConfiguration: Record<string, unknown> = {};
  if (trimmed.length > 0) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isPlainObjectRecord(parsed)) {
        return {
          success: false,
          error: "Plugin settings must be a JSON object.",
        };
      }

      parsedConfiguration = parsed;
    } catch {
      return {
        success: false,
        error: "Plugin settings JSON is invalid.",
      };
    }
  }

  const schema = definition.manifest.configSchema;
  let normalizedConfiguration = parsedConfiguration;

  if (schema) {
    normalizedConfiguration = applyConfigDefaults(
      parsedConfiguration,
      schema as PluginConfigSchema,
    );

    const validation = validatePluginConfig(
      normalizedConfiguration,
      schema as PluginConfigSchema,
    );

    if (!validation.valid) {
      const firstError = validation.errors[0];
      const fieldPath =
        firstError?.path && firstError.path !== "/" ? firstError.path : "root";

      return {
        success: false,
        error: `Settings validation failed at ${fieldPath}: ${firstError?.message || "Invalid value"}`,
      };
    }
  }

  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId,
    pluginKey,
    actor: { id: user.id, type: "user" },
    organizationRole: "admin",
    transition: {
      kind: "config_update",
      configuration: normalizedConfiguration,
    },
  });

  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.error ?? "Failed to save plugin settings.",
    };
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("id, username")
    .eq("id", organizationId)
    .maybeSingle();

  if (organization) {
    const organizationSlug = organization.username || organization.id;
    revalidatePath(`/organization/${organizationSlug}`);
    revalidatePath(`/organization/${organizationSlug}/settings`);
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return {
    success: true,
    message: "Plugin settings saved.",
  };
}
