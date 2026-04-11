import { createClient } from "@/lib/supabase/server";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import {
  coalescePluginVersion,
  isPluginVersionBehind,
} from "@/lib/plugins/versioning";
import type {
  OrganizationPluginAccessRole,
  ResolvedOrganizationPlugin,
} from "@/types";

type PluginCatalogRow = {
  key: string;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
  force_update_version: string | null;
};

type PluginEntitlementRow = {
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
};

type PluginInstallRow = {
  plugin_key: string;
  enabled: boolean;
  configuration: Record<string, unknown> | null;
  installed_at: string | null;
  installed_version: string | null;
};

type PluginAccessRow = {
  plugin_key: string;
  enabled: boolean;
  configuration: Record<string, unknown> | null;
  installed_at: string | null;
  installed_version: string | null;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
  force_update_version: string | null;
  is_accessible: boolean;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
};

const rolePriority: Record<OrganizationPluginAccessRole, number> = {
  member: 1,
  staff: 2,
  admin: 3,
};

export function hasOrganizationPluginAccess(
  userRole: OrganizationPluginAccessRole | null,
  minimumRole: OrganizationPluginAccessRole = "member",
): boolean {
  if (!userRole) return false;
  return rolePriority[userRole] >= rolePriority[minimumRole];
}

export function isEntitlementActive(
  entitlement: PluginEntitlementRow,
  now = new Date(),
): boolean {
  if (entitlement.status !== "active") return false;

  const startsAt = entitlement.starts_at ? new Date(entitlement.starts_at) : null;
  const endsAt = entitlement.ends_at ? new Date(entitlement.ends_at) : null;

  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;

  return true;
}

function isMissingPluginTableError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    (typeof error.message === "string" &&
      error.message.includes("does not exist"))
  );
}

export async function resolveOrganizationPlugins(options: {
  organizationId: string;
  userRole: OrganizationPluginAccessRole | null;
}): Promise<ResolvedOrganizationPlugin[]> {
  const { organizationId, userRole } = options;

  if (!userRole) {
    return [];
  }

  const supabase = await createClient();

  const unifiedAccessResult = await supabase
    .from("organization_plugin_access")
    .select(
      "plugin_key, enabled, configuration, installed_at, installed_version, visibility, is_active, latest_version, force_update_version, is_accessible",
    )
    .eq("organization_id", organizationId)
    .eq("enabled", true);

  if (!isMissingPluginTableError(unifiedAccessResult.error)) {
    if (unifiedAccessResult.error) {
      throw new Error(
        `Failed to load consolidated plugin access: ${unifiedAccessResult.error.message}`,
      );
    }

    const rows = (unifiedAccessResult.data ?? []) as PluginAccessRow[];
    const resolved: ResolvedOrganizationPlugin[] = [];

    for (const row of rows) {
      if (!row.enabled || !row.is_active || !row.is_accessible) continue;

      const definition = getRegisteredPlugin(row.plugin_key);
      if (!definition) continue;

      const installedVersion = coalescePluginVersion(
        row.installed_version,
        row.latest_version,
      );

      const forceUpdateRequired =
        Boolean(row.force_update_version) &&
        isPluginVersionBehind(installedVersion, row.force_update_version);

      if (forceUpdateRequired) continue;

      const minimumRole = definition.manifest.minimumRole ?? "member";
      if (!hasOrganizationPluginAccess(userRole, minimumRole)) continue;

      resolved.push({
        key: definition.manifest.key,
        name: definition.manifest.name,
        description: definition.manifest.description,
        navLabel: definition.manifest.navLabel ?? definition.manifest.name,
        version: definition.manifest.version,
        visibility: definition.manifest.visibility,
        minimumRole,
        installedAt: row.installed_at,
        enabled: row.enabled,
        configuration: row.configuration,
        latestVersion: row.latest_version,
        installedVersion,
        forceUpdateVersion: row.force_update_version,
        forceUpdateRequired,
      });
    }

    return resolved.sort((a, b) => a.navLabel.localeCompare(b.navLabel));
  }

  const [catalogResult, entitlementResult, installResult] = await Promise.all([
    supabase
      .from("plugins")
      .select("key, visibility, is_active, latest_version, force_update_version")
      .eq("is_active", true),
    supabase
      .from("organization_plugin_entitlements")
      .select("plugin_key, status, starts_at, ends_at")
      .eq("organization_id", organizationId),
    supabase
      .from("organization_plugin_installs")
      .select("plugin_key, enabled, configuration, installed_at, installed_version")
      .eq("organization_id", organizationId)
      .eq("enabled", true),
  ]);

  if (
    isMissingPluginTableError(catalogResult.error) ||
    isMissingPluginTableError(entitlementResult.error) ||
    isMissingPluginTableError(installResult.error)
  ) {
    return [];
  }

  if (catalogResult.error) {
    throw new Error(`Failed to load plugin catalog: ${catalogResult.error.message}`);
  }

  if (entitlementResult.error) {
    throw new Error(
      `Failed to load plugin entitlements: ${entitlementResult.error.message}`,
    );
  }

  if (installResult.error) {
    throw new Error(`Failed to load plugin installs: ${installResult.error.message}`);
  }

  const catalog = (catalogResult.data ?? []) as PluginCatalogRow[];
  const entitlements = (entitlementResult.data ?? []) as PluginEntitlementRow[];
  const installs = (installResult.data ?? []) as PluginInstallRow[];
  const now = new Date();

  const catalogByKey = new Map(catalog.map((row) => [row.key, row]));
  const activeEntitlementKeys = new Set(
    entitlements
      .filter((entitlement) => isEntitlementActive(entitlement, now))
      .map((entitlement) => entitlement.plugin_key),
  );

  const resolved: ResolvedOrganizationPlugin[] = [];

  for (const install of installs) {
    if (!install.enabled) continue;

    const catalogItem = catalogByKey.get(install.plugin_key);
    if (!catalogItem || !catalogItem.is_active) continue;

    if (
      catalogItem.visibility === "private" &&
      !activeEntitlementKeys.has(install.plugin_key)
    ) {
      continue;
    }

    const definition = getRegisteredPlugin(install.plugin_key);
    if (!definition) {
      continue;
    }

    const installedVersion = coalescePluginVersion(
      install.installed_version,
      catalogItem.latest_version,
    );
    const forceUpdateRequired =
      Boolean(catalogItem.force_update_version) &&
      isPluginVersionBehind(installedVersion, catalogItem.force_update_version);

    if (forceUpdateRequired) {
      continue;
    }

    const minimumRole = definition.manifest.minimumRole ?? "member";
    if (!hasOrganizationPluginAccess(userRole, minimumRole)) {
      continue;
    }

    resolved.push({
      key: definition.manifest.key,
      name: definition.manifest.name,
      description: definition.manifest.description,
      navLabel: definition.manifest.navLabel ?? definition.manifest.name,
      version: definition.manifest.version,
      visibility: definition.manifest.visibility,
      minimumRole,
      installedAt: install.installed_at,
      enabled: install.enabled,
      configuration: install.configuration,
      latestVersion: catalogItem.latest_version,
      installedVersion,
      forceUpdateVersion: catalogItem.force_update_version,
      forceUpdateRequired,
    });
  }

  return resolved.sort((a, b) => a.navLabel.localeCompare(b.navLabel));
}

export async function resolveOrganizationPluginByKey(options: {
  organizationId: string;
  userRole: OrganizationPluginAccessRole | null;
  pluginKey: string;
}): Promise<ResolvedOrganizationPlugin | null> {
  const plugins = await resolveOrganizationPlugins({
    organizationId: options.organizationId,
    userRole: options.userRole,
  });

  return plugins.find((plugin) => plugin.key === options.pluginKey) ?? null;
}