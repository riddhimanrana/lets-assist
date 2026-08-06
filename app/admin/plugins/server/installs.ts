import "server-only";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { transitionOrganizationPluginInstall } from "@/lib/plugins/control-plane-transition";
import {
  applyConfigDefaults,
  validatePluginConfig,
  type PluginConfigSchema,
} from "@/lib/plugins/config-schema";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { checkSuperAdmin } from "@/app/admin/actions";
import {
  isEntitlementCurrentlyActive,
  type ForceInstallEntitlementCompensation,
  type ForceInstallEntitlementSnapshot,
} from "./shared";

export async function forceUpdateOrganizationPluginInstall(input: {
  organizationId: string;
  pluginKey: string;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const service = getAdminClient();

  const { data: plugin, error: pluginError } = await service
    .from("plugins")
    .select("key, latest_version")
    .eq("key", input.pluginKey)
    .eq("is_active", true)
    .maybeSingle();

  if (pluginError || !plugin) {
    return {
      success: false,
      error: pluginError?.message || "Active plugin catalog entry not found.",
    };
  }

  if (!getRegisteredPlugin(input.pluginKey)) {
    return {
      success: false,
      error: "This plugin package is not loaded in the current deployment.",
    };
  }

  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId: input.organizationId,
    pluginKey: input.pluginKey,
    actor: { id: userId, type: "admin" },
    organizationRole: "admin",
    transition: {
      kind: "version_update",
      targetVersion: plugin.latest_version,
    },
  });

  if (!transitionResult.success) {
    return {
      success: false,
      error: transitionResult.error ?? "Failed to force update plugin.",
    };
  }

  const { data: organization } = await service
    .from("organizations")
    .select("id, username")
    .eq("id", input.organizationId)
    .maybeSingle();

  if (organization) {
    const slug = organization.username || organization.id;
    revalidatePath(`/organization/${slug}`);
    revalidatePath(`/organization/${slug}/settings`);
  }

  revalidatePath("/admin/plugins");
  return { success: true };
}

export async function forceInstallOrganizationPlugin(input: {
  organizationId: string;
  pluginKey: string;
  activateEntitlementForPrivate?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const service = getAdminClient();
  const shouldActivateEntitlement =
    input.activateEntitlementForPrivate !== false;
  let entitlementCompensation: ForceInstallEntitlementCompensation | null =
    null;

  const { data: plugin, error: pluginError } = await service
    .from("plugins")
    .select("key, visibility, latest_version")
    .eq("key", input.pluginKey)
    .eq("is_active", true)
    .maybeSingle();

  if (pluginError || !plugin) {
    return {
      success: false,
      error: pluginError?.message || "Active plugin catalog entry not found.",
    };
  }

  if (!getRegisteredPlugin(input.pluginKey)) {
    return {
      success: false,
      error: "This plugin package is not loaded in the current deployment.",
    };
  }

  if (plugin.visibility === "private") {
    if (shouldActivateEntitlement) {
      const { data: existingEntitlement, error: entitlementLookupError } =
        await service
          .from("organization_plugin_entitlements")
          .select("id, status, starts_at, ends_at, updated_at")
          .eq("organization_id", input.organizationId)
          .eq("plugin_key", input.pluginKey)
          .maybeSingle();

      if (entitlementLookupError) {
        return {
          success: false,
          error: `Failed to inspect private entitlement: ${entitlementLookupError.message}`,
        };
      }

      const previous =
        existingEntitlement as ForceInstallEntitlementSnapshot | null;
      if (!previous) {
        const activationUpdatedAt = new Date().toISOString();
        const { data: createdEntitlement, error: entitlementError } =
          await service
            .from("organization_plugin_entitlements")
            .insert({
              organization_id: input.organizationId,
              plugin_key: input.pluginKey,
              status: "active",
              starts_at: null,
              ends_at: null,
              updated_at: activationUpdatedAt,
            })
            .select("id")
            .single();
        if (entitlementError || !createdEntitlement) {
          return {
            success: false,
            error: `Failed to activate private entitlement: ${entitlementError?.message ?? "missing created entitlement"}`,
          };
        }
        entitlementCompensation = {
          kind: "delete_created",
          id: createdEntitlement.id,
          activationUpdatedAt,
        };
      } else if (!isEntitlementCurrentlyActive(previous, new Date())) {
        const activationUpdatedAt = new Date().toISOString();
        const { data: reactivatedEntitlement, error: entitlementError } =
          await service
            .from("organization_plugin_entitlements")
            .update({
              status: "active",
              starts_at: null,
              ends_at: null,
              updated_at: activationUpdatedAt,
            })
            .eq("id", previous.id)
            .eq("updated_at", previous.updated_at)
            .select("id")
            .maybeSingle();
        if (entitlementError || !reactivatedEntitlement) {
          return {
            success: false,
            error: entitlementError
              ? `Failed to activate private entitlement: ${entitlementError.message}`
              : "Private entitlement changed concurrently. Retry the force install.",
          };
        }
        entitlementCompensation = {
          kind: "restore_reactivated",
          id: previous.id,
          activationUpdatedAt,
          previous,
        };
      }
    } else {
      const { data: entitlement, error: entitlementLookupError } = await service
        .from("organization_plugin_entitlements")
        .select("id, status")
        .eq("organization_id", input.organizationId)
        .eq("plugin_key", input.pluginKey)
        .eq("status", "active")
        .maybeSingle();

      if (entitlementLookupError) {
        return {
          success: false,
          error: `Failed to validate private entitlement: ${entitlementLookupError.message}`,
        };
      }

      if (!entitlement) {
        return {
          success: false,
          error:
            "Private plugin requires an active entitlement. Enable entitlement activation or configure entitlement first.",
        };
      }
    }
  }

  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId: input.organizationId,
    pluginKey: input.pluginKey,
    actor: { id: userId, type: "admin" },
    organizationRole: "admin",
    transition: {
      kind: "install_or_enable",
      targetVersion: plugin.latest_version,
    },
  });

  if (!transitionResult.success) {
    let compensationError: string | null = null;
    if (entitlementCompensation?.kind === "delete_created") {
      const { data, error } = await service
        .from("organization_plugin_entitlements")
        .delete()
        .eq("id", entitlementCompensation.id)
        .eq("updated_at", entitlementCompensation.activationUpdatedAt)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        compensationError =
          error?.message ?? "created entitlement changed concurrently";
      }
    } else if (entitlementCompensation?.kind === "restore_reactivated") {
      const { data, error } = await service
        .from("organization_plugin_entitlements")
        .update({
          status: entitlementCompensation.previous.status,
          starts_at: entitlementCompensation.previous.starts_at,
          ends_at: entitlementCompensation.previous.ends_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entitlementCompensation.id)
        .eq("updated_at", entitlementCompensation.activationUpdatedAt)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        compensationError =
          error?.message ?? "reactivated entitlement changed concurrently";
      }
    }

    return {
      success: false,
      error: [
        transitionResult.error ?? "Failed to force install plugin.",
        compensationError
          ? `Private entitlement rollback also failed: ${compensationError}.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  const { data: organization } = await service
    .from("organizations")
    .select("id, username")
    .eq("id", input.organizationId)
    .maybeSingle();

  if (organization) {
    const slug = organization.username || organization.id;
    revalidatePath(`/organization/${slug}`);
    revalidatePath(`/organization/${slug}/settings`);
  }

  revalidatePath("/admin/plugins");
  return { success: true };
}

export async function setOrganizationPluginInstallStateByAdmin(input: {
  organizationId: string;
  pluginKey: string;
  enabled: boolean;
  activateEntitlementForPrivate?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  "use server";
  if (input.enabled) {
    return forceInstallOrganizationPlugin({
      organizationId: input.organizationId,
      pluginKey: input.pluginKey,
      activateEntitlementForPrivate: input.activateEntitlementForPrivate,
    });
  }

  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const service = getAdminClient();
  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId: input.organizationId,
    pluginKey: input.pluginKey,
    actor: { id: userId, type: "admin" },
    organizationRole: "admin",
    transition: { kind: "disable" },
  });

  if (!transitionResult.success) {
    return {
      success: false,
      error:
        transitionResult.error ?? "Failed to disable organization install.",
    };
  }

  const { data: organization } = await service
    .from("organizations")
    .select("id, username")
    .eq("id", input.organizationId)
    .maybeSingle();

  if (organization) {
    const slug = organization.username || organization.id;
    revalidatePath(`/organization/${slug}`);
    revalidatePath(`/organization/${slug}/settings`);
  }

  revalidatePath("/admin/plugins");
  return { success: true };
}

export async function upsertOrganizationPluginInstallConfiguration(input: {
  organizationId: string;
  pluginKey: string;
  configurationJson: string;
}): Promise<{ success: boolean; error?: string; message?: string }> {
  "use server";
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const rawText = input.configurationJson.trim();
  let parsedConfiguration: Record<string, unknown>;

  if (!rawText) {
    parsedConfiguration = {};
  } else {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return {
          success: false,
          error: "Configuration JSON must be an object.",
        };
      }

      parsedConfiguration = parsed as Record<string, unknown>;
    } catch {
      return { success: false, error: "Configuration JSON is invalid." };
    }
  }

  const definition = getRegisteredPlugin(input.pluginKey);
  if (!definition) {
    return {
      success: false,
      error: "This plugin package is not loaded in the current deployment.",
    };
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
        error: `Configuration validation failed at ${fieldPath}: ${firstError?.message || "Invalid value"}`,
      };
    }
  }

  const service = getAdminClient();

  const { data: existingInstall, error: existingInstallError } = await service
    .from("organization_plugin_installs")
    .select("organization_id, plugin_key")
    .eq("organization_id", input.organizationId)
    .eq("plugin_key", input.pluginKey)
    .maybeSingle();

  if (existingInstallError) {
    return {
      success: false,
      error: `Failed to fetch existing install: ${existingInstallError.message}`,
    };
  }

  if (!existingInstall) {
    return {
      success: false,
      error: "Install the plugin before updating its configuration.",
    };
  }

  const transitionResult = await transitionOrganizationPluginInstall({
    organizationId: input.organizationId,
    pluginKey: input.pluginKey,
    actor: { id: userId, type: "admin" },
    organizationRole: "admin",
    transition: {
      kind: "config_update",
      configuration: normalizedConfiguration,
    },
  });

  if (!transitionResult.success) {
    return {
      success: false,
      error:
        transitionResult.error ?? "Failed to update install configuration.",
    };
  }

  const { data: organization } = await service
    .from("organizations")
    .select("id, username")
    .eq("id", input.organizationId)
    .maybeSingle();

  if (organization) {
    const slug = organization.username || organization.id;
    revalidatePath(`/organization/${slug}`);
    revalidatePath(`/organization/${slug}/settings`);
  }

  revalidatePath("/admin/plugins");

  return {
    success: true,
    message: "Install configuration saved.",
  };
}
