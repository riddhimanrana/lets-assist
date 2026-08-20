"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { listRegisteredPlugins } from "@/lib/plugins/registry";
import { getPublishedPluginRelease } from "@/lib/plugins/published-releases";
import {
  buildOrganizationPluginAdminSettings,
  type RuntimePluginInfo,
} from "@/lib/plugins/organization-plugin-settings";
import { extractDataAccessPurposes } from "@/lib/plugins/plugin-uninstall-impact";
import { getPluginDataDeletionReadiness } from "@/lib/plugins/plugin-data-deletion-readiness";
import {
  isMissingPluginTableError,
  isOrganizationAdminForSettings,
  type OrganizationPluginSettingsResult,
  type PluginAccessRow,
  type PluginCatalogRow,
  type PluginEntitlementRow,
  type PluginInstallRow,
} from "./plugin-shared";

function listRuntimePluginsForSettings(): RuntimePluginInfo[] {
  return listRegisteredPlugins().map((plugin) => {
    const release = getPublishedPluginRelease(plugin.manifest.key);
    if (!release) {
      throw new Error(
        `Registered plugin ${plugin.manifest.key} has no published release contract.`,
      );
    }

    return {
      key: plugin.manifest.key,
      navLabel: plugin.manifest.navLabel ?? plugin.manifest.name,
      version: plugin.manifest.version,
      supportedInstallContracts: release.supportedInstallContracts,
      minimumRole: plugin.manifest.minimumRole ?? "member",
      ownerName: plugin.manifest.owner?.name ?? "Let's Assist",
      ownerType: plugin.manifest.owner?.type ?? "platform-official",
      detailedDescription:
        plugin.manifest.detailedDescription ??
        plugin.manifest.description ??
        `${plugin.manifest.name} plugin for organization workflows.`,
      capabilityHighlights: plugin.manifest.capabilityHighlights ?? [],
      dataAccess:
        plugin.manifest.dataAccess?.map(
          (entry) =>
            `${entry.access}: ${entry.schema}.${entry.relation} - ${entry.purpose}`,
        ) ??
        plugin.manifest.dataScope ??
        [],
      dataAccessPurposes: extractDataAccessPurposes(plugin.manifest.dataAccess),
      routes: plugin.manifest.routes ?? [],
      backendCapabilities: plugin.manifest.backendCapabilities ?? [],
      configSchema: plugin.manifest.configSchema ?? null,
      requiredScopes: plugin.manifest.requiredScopes ?? [],
      dataDeletionAvailable: getPluginDataDeletionReadiness(plugin).ready,
      dataDeletionExternalSystemsNotCovered:
        plugin.manifest.dataDeletion?.externalSystemsNotCovered ?? [],
    };
  });
}

export async function getOrganizationPluginSettings(
  organizationId: string,
): Promise<OrganizationPluginSettingsResult> {
  "use server";
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    return {
      plugins: [],
      error: "You must be logged in to view plugin settings",
    };
  }

  const isAdmin = await isOrganizationAdminForSettings(organizationId, user.id);
  if (!isAdmin) {
    return {
      plugins: [],
      error: "Only organization admins can manage plugins",
    };
  }

  const [catalogResult, accessResult] = await Promise.all([
    supabase
      .from("plugins")
      .select(
        "key, name, description, visibility, is_active, latest_version, force_update_version, code_repository, code_reference, private_codebase, updated_at",
      )
      .eq("is_active", true),
    supabase
      .from("organization_plugin_access")
      .select(
        "plugin_key, enabled, installed_version, configuration, install_created_at, entitlement_status, entitlement_starts_at, entitlement_ends_at, entitlement_is_forced",
      )
      .eq("organization_id", organizationId),
  ]);

  if (
    isMissingPluginTableError(catalogResult.error) ||
    isMissingPluginTableError(accessResult.error)
  ) {
    const [entitlementResult, installResult] = await Promise.all([
      supabase
        .from("organization_plugin_entitlements")
        .select("plugin_key, status, starts_at, ends_at, is_forced")
        .eq("organization_id", organizationId),
      supabase
        .from("organization_plugin_installs")
        .select("plugin_key, enabled, installed_version, configuration")
        .eq("organization_id", organizationId),
    ]);

    if (
      isMissingPluginTableError(entitlementResult.error) ||
      isMissingPluginTableError(installResult.error)
    ) {
      return {
        plugins: [],
        warning:
          "Plugin platform tables are not initialized in this environment yet. Run a local Supabase reset after applying migrations.",
      };
    }

    if (catalogResult.error) {
      return {
        plugins: [],
        error: `Failed to load plugin catalog: ${catalogResult.error.message}`,
      };
    }

    if (entitlementResult.error) {
      return {
        plugins: [],
        error: `Failed to load plugin entitlements: ${entitlementResult.error.message}`,
      };
    }

    if (installResult.error) {
      return {
        plugins: [],
        error: `Failed to load plugin installs: ${installResult.error.message}`,
      };
    }

    const runtimePlugins = listRuntimePluginsForSettings();

    const plugins = buildOrganizationPluginAdminSettings({
      catalog: (catalogResult.data ?? []) as PluginCatalogRow[],
      entitlements: (entitlementResult.data ?? []) as PluginEntitlementRow[],
      installs: (installResult.data ?? []) as PluginInstallRow[],
      runtimePlugins,
    });

    return { plugins };
  }

  if (catalogResult.error) {
    return {
      plugins: [],
      error: `Failed to load plugin catalog: ${catalogResult.error.message}`,
    };
  }

  if (accessResult.error) {
    return {
      plugins: [],
      error: `Failed to load consolidated plugin access: ${accessResult.error.message}`,
    };
  }

  const runtimePlugins = listRuntimePluginsForSettings();

  const accessRows = (accessResult.data ?? []) as PluginAccessRow[];

  const entitlements = accessRows
    .filter((row) => row.entitlement_status !== null)
    .map((row) => ({
      plugin_key: row.plugin_key,
      status: row.entitlement_status as "active" | "inactive",
      starts_at: row.entitlement_starts_at,
      ends_at: row.entitlement_ends_at,
      is_forced: row.entitlement_is_forced ?? false,
    })) as PluginEntitlementRow[];

  const installs = accessRows
    .filter((row) => row.install_created_at !== null)
    .map((row) => ({
      plugin_key: row.plugin_key,
      enabled: row.enabled,
      installed_version: row.installed_version,
      configuration: row.configuration,
    })) as PluginInstallRow[];

  const plugins = buildOrganizationPluginAdminSettings({
    catalog: (catalogResult.data ?? []) as PluginCatalogRow[],
    entitlements,
    installs,
    runtimePlugins,
  });

  return { plugins };
}
