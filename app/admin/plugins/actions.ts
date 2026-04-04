"use server";

import { revalidatePath } from "next/cache";

import { getAdminClient } from "@/lib/supabase/admin";
import { coalescePluginVersion, isPluginVersionBehind } from "@/lib/plugins/versioning";
import { checkSuperAdmin } from "@/app/admin/actions";

type PluginCatalogControlRow = {
  key: string;
  name: string;
  description: string | null;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
  force_update_version: string | null;
  code_repository: string | null;
  code_reference: string | null;
  private_codebase: boolean;
  updated_at: string;
  installed_count: number;
  force_pending_count: number;
};

type PluginEntitlementRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string | null;
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

type PluginOrganizationOption = {
  id: string;
  name: string;
  username: string | null;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
};

type PluginInstallRow = {
  organization_id: string;
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
};

type PluginCatalogBaseRow = {
  key: string;
  name: string;
  description: string | null;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
  force_update_version: string | null;
  code_repository: string | null;
  code_reference: string | null;
  private_codebase: boolean;
  updated_at: string;
};

type EntitlementBaseRow = {
  id: string;
  organization_id: string;
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

export type PluginControlPlaneData = {
  plugins: PluginCatalogControlRow[];
  entitlements: PluginEntitlementRow[];
  organizations: PluginOrganizationOption[];
  error?: string;
  warning?: string;
};

function isMissingPluginSchemaError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    (typeof error.message === "string" && error.message.includes("does not exist"))
  );
}

function normalizeVersionInput(value: string): string {
  const normalized = value.trim().replace(/^v/i, "");
  return normalized || "1.0.0";
}

export async function getPluginControlPlaneData(): Promise<PluginControlPlaneData> {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return {
      plugins: [],
      entitlements: [],
      organizations: [],
      error: "Unauthorized",
    };
  }

  const service = getAdminClient();

  const [pluginsResult, entitlementsResult, organizationsResult, installsResult] =
    await Promise.all([
      service
        .from("plugins")
        .select(
          "key, name, description, visibility, is_active, latest_version, force_update_version, code_repository, code_reference, private_codebase, updated_at",
        )
        .order("name", { ascending: true }),
      service
        .from("organization_plugin_entitlements")
        .select("id, organization_id, plugin_key, status, starts_at, ends_at, updated_at")
        .order("updated_at", { ascending: false }),
      service
        .from("organizations")
        .select("id, name, username")
        .order("name", { ascending: true }),
      service
        .from("organization_plugin_installs")
        .select("organization_id, plugin_key, enabled, installed_version"),
    ]);

  if (
    isMissingPluginSchemaError(pluginsResult.error) ||
    isMissingPluginSchemaError(entitlementsResult.error) ||
    isMissingPluginSchemaError(installsResult.error)
  ) {
    return {
      plugins: [],
      entitlements: [],
      organizations: (organizationsResult.data ?? []) as PluginOrganizationOption[],
      warning:
        "Plugin control tables/columns are not fully initialized. Run local Supabase reset to apply latest migrations.",
    };
  }

  if (pluginsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      organizations: [],
      error: `Failed to load plugin catalog: ${pluginsResult.error.message}`,
    };
  }

  if (entitlementsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      organizations: [],
      error: `Failed to load entitlements: ${entitlementsResult.error.message}`,
    };
  }

  if (organizationsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      organizations: [],
      error: `Failed to load organizations: ${organizationsResult.error.message}`,
    };
  }

  if (installsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      organizations: [],
      error: `Failed to load plugin installs: ${installsResult.error.message}`,
    };
  }

  const organizations = (organizationsResult.data ?? []) as PluginOrganizationOption[];
  const organizationNameById = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );

  const installs = (installsResult.data ?? []) as PluginInstallRow[];
  const installsByPlugin = new Map<string, PluginInstallRow[]>();

  for (const install of installs) {
    if (!installsByPlugin.has(install.plugin_key)) {
      installsByPlugin.set(install.plugin_key, []);
    }
    installsByPlugin.get(install.plugin_key)?.push(install);
  }

  const plugins = ((pluginsResult.data ?? []) as PluginCatalogBaseRow[]).map((plugin) => {
    const pluginInstalls = installsByPlugin.get(plugin.key) ?? [];

    const installedCount = pluginInstalls.filter((install) => install.enabled).length;
    const forcePendingCount = plugin.force_update_version
      ? pluginInstalls.filter((install) => {
          if (!install.enabled) return false;
          const installedVersion = coalescePluginVersion(
            install.installed_version,
            plugin.latest_version,
          );
          return isPluginVersionBehind(installedVersion, plugin.force_update_version);
        }).length
      : 0;

    return {
      ...plugin,
      installed_count: installedCount,
      force_pending_count: forcePendingCount,
    } satisfies PluginCatalogControlRow;
  });

  const entitlements = ((entitlementsResult.data ?? []) as EntitlementBaseRow[]).map(
    (entitlement) => {
      const organization = organizationNameById.get(entitlement.organization_id);

      return {
        id: entitlement.id,
        organization_id: entitlement.organization_id,
        organization_name: organization?.name ?? "Unknown organization",
        organization_slug: organization?.username ?? null,
        plugin_key: entitlement.plugin_key,
        status: entitlement.status,
        starts_at: entitlement.starts_at,
        ends_at: entitlement.ends_at,
        updated_at: entitlement.updated_at,
      } satisfies PluginEntitlementRow;
    },
  );

  return {
    plugins,
    entitlements,
    organizations,
  };
}

export async function upsertPluginCatalogControl(input: {
  key: string;
  name: string;
  description?: string;
  visibility: "global" | "private";
  isActive: boolean;
  latestVersion: string;
  forceUpdateVersion?: string | null;
  codeRepository?: string | null;
  codeReference?: string | null;
  privateCodebase: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const key = input.key.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-_.]*$/.test(key)) {
    return {
      success: false,
      error:
        "Plugin key must start with a lowercase letter/number and only contain lowercase letters, numbers, '-', '_' or '.'.",
    };
  }

  if (!input.name.trim()) {
    return { success: false, error: "Plugin name is required." };
  }

  const latestVersion = normalizeVersionInput(input.latestVersion);
  const forceUpdateVersion = input.forceUpdateVersion
    ? normalizeVersionInput(input.forceUpdateVersion)
    : null;

  if (
    forceUpdateVersion &&
    isPluginVersionBehind(latestVersion, forceUpdateVersion)
  ) {
    return {
      success: false,
      error: "Force-update version cannot be ahead of latest version.",
    };
  }

  const service = getAdminClient();
  const { error } = await service
    .from("plugins")
    .upsert(
      {
        key,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        visibility: input.visibility,
        is_active: input.isActive,
        latest_version: latestVersion,
        force_update_version: forceUpdateVersion,
        code_repository: input.codeRepository?.trim() || null,
        code_reference: input.codeReference?.trim() || null,
        private_codebase: input.privateCodebase,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: "key" },
    );

  if (error) {
    return { success: false, error: `Failed to save plugin catalog control: ${error.message}` };
  }

  revalidatePath("/admin/plugins");
  return { success: true };
}

export async function upsertOrganizationPluginEntitlement(input: {
  organizationId: string;
  pluginKey: string;
  status: "active" | "inactive";
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  if (!input.organizationId || !input.pluginKey) {
    return { success: false, error: "Organization and plugin are required." };
  }

  const startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : null;
  const endsAt = input.endsAt ? new Date(input.endsAt).toISOString() : null;

  const service = getAdminClient();
  const { error } = await service
    .from("organization_plugin_entitlements")
    .upsert(
      {
        organization_id: input.organizationId,
        plugin_key: input.pluginKey,
        status: input.status,
        starts_at: startsAt,
        ends_at: endsAt,
        updated_at: new Date().toISOString(),
        created_by: userId,
      },
      { onConflict: "organization_id,plugin_key" },
    );

  if (error) {
    return { success: false, error: `Failed to save entitlement: ${error.message}` };
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

export async function forceUpdateOrganizationPluginInstall(input: {
  organizationId: string;
  pluginKey: string;
}): Promise<{ success: boolean; error?: string }> {
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

  const now = new Date().toISOString();
  const { data: updatedRows, error: updateError } = await service
    .from("organization_plugin_installs")
    .update({
      installed_version: plugin.latest_version,
      enabled: true,
      auto_update: true,
      last_version_update_at: now,
      updated_by: userId,
      updated_at: now,
    })
    .eq("organization_id", input.organizationId)
    .eq("plugin_key", input.pluginKey)
    .select("id");

  if (updateError) {
    return { success: false, error: `Failed to force update plugin: ${updateError.message}` };
  }

  if (!updatedRows || updatedRows.length === 0) {
    return {
      success: false,
      error: "Plugin is not installed for this organization yet.",
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
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const service = getAdminClient();
  const shouldActivateEntitlement = input.activateEntitlementForPrivate !== false;

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

  if (plugin.visibility === "private") {
    if (shouldActivateEntitlement) {
      const { error: entitlementError } = await service
        .from("organization_plugin_entitlements")
        .upsert(
          {
            organization_id: input.organizationId,
            plugin_key: input.pluginKey,
            status: "active",
            starts_at: null,
            ends_at: null,
            created_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,plugin_key" },
        );

      if (entitlementError) {
        return {
          success: false,
          error: `Failed to activate private entitlement: ${entitlementError.message}`,
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

  const now = new Date().toISOString();
  const { error: installUpsertError } = await service
    .from("organization_plugin_installs")
    .upsert(
      {
        organization_id: input.organizationId,
        plugin_key: input.pluginKey,
        enabled: true,
        installed_version: plugin.latest_version,
        auto_update: true,
        installed_by: userId,
        installed_at: now,
        updated_by: userId,
        last_version_update_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,plugin_key" },
    );

  if (installUpsertError) {
    return {
      success: false,
      error: `Failed to force install plugin: ${installUpsertError.message}`,
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
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
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

  if (existingInstall) {
    const { error: updateError } = await service
      .from("organization_plugin_installs")
      .update({
        configuration: parsedConfiguration,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", input.organizationId)
      .eq("plugin_key", input.pluginKey);

    if (updateError) {
      return {
        success: false,
        error: `Failed to update install configuration: ${updateError.message}`,
      };
    }
  } else {
    const { error: insertError } = await service
      .from("organization_plugin_installs")
      .insert({
        organization_id: input.organizationId,
        plugin_key: input.pluginKey,
        enabled: false,
        auto_update: true,
        configuration: parsedConfiguration,
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      return {
        success: false,
        error: `Failed to create install configuration: ${insertError.message}`,
      };
    }
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