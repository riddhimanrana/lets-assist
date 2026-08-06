import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import {
  coalescePluginVersion,
  isPluginVersionBehind,
} from "@/lib/plugins/versioning";
import { syncRegisteredPluginRuntimeContracts } from "@/lib/plugins/runtime-contracts";
import { checkSuperAdmin } from "@/app/admin/actions";
import {
  isMissingPluginSchemaError,
  type EntitlementBaseRow,
  type PluginAccessControlRow,
  type PluginCatalogBaseRow,
  type PluginCatalogControlRow,
  type PluginControlPlaneData,
  type PluginDataBoundaryRow,
  type PluginEntitlementRow,
  type PluginInstallRow,
  type PluginOrganizationOption,
} from "./shared";

export async function getPluginControlPlaneData(): Promise<PluginControlPlaneData> {
  "use server";
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return {
      plugins: [],
      entitlements: [],
      dataBoundaries: [],
      organizations: [],
      error: "Unauthorized",
    };
  }

  const service = getAdminClient();
  let runtimeContractWarning: string | undefined;

  try {
    await syncRegisteredPluginRuntimeContracts();
  } catch (error) {
    runtimeContractWarning =
      error instanceof Error
        ? error.message
        : "Failed to sync plugin runtime contracts.";
  }

  const [pluginsResult, organizationsResult, accessResult, boundariesResult] =
    await Promise.all([
      service
        .from("plugins")
        .select(
          "key, name, description, visibility, is_active, latest_version, force_update_version, code_repository, code_reference, private_codebase, updated_at",
        )
        .order("name", { ascending: true }),
      service
        .from("organizations")
        .select("id, name, username")
        .order("name", { ascending: true }),
      service
        .from("organization_plugin_access")
        .select(
          "organization_id, plugin_key, enabled, installed_version, install_created_at, entitlement_id, entitlement_status, entitlement_starts_at, entitlement_ends_at, entitlement_is_forced, entitlement_updated_at",
        ),
      service
        .from("organization_plugin_data_boundaries")
        .select(
          "id, organization_id, plugin_key, boundary_status, data_schema, data_prefix, isolation_mode, direct_client_access, updated_at",
        )
        .order("updated_at", { ascending: false }),
    ]);

  const isAccessViewMissing = isMissingPluginSchemaError(accessResult.error);
  const isBoundariesTableMissing = isMissingPluginSchemaError(
    boundariesResult.error,
  );

  if (pluginsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      dataBoundaries: [],
      organizations: [],
      error: `Failed to load plugin catalog: ${pluginsResult.error.message}`,
    };
  }

  if (organizationsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      dataBoundaries: [],
      organizations: [],
      error: `Failed to load organizations: ${organizationsResult.error.message}`,
    };
  }

  const organizations = (organizationsResult.data ??
    []) as PluginOrganizationOption[];
  const organizationNameById = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );

  const installsByPlugin = new Map<string, PluginInstallRow[]>();
  let entitlements: PluginEntitlementRow[] = [];

  if (isAccessViewMissing) {
    const [entitlementsResult, installsResult] = await Promise.all([
      service
        .from("organization_plugin_entitlements")
        .select(
          "id, organization_id, plugin_key, status, starts_at, ends_at, is_forced, updated_at",
        )
        .order("updated_at", { ascending: false }),
      service
        .from("organization_plugin_installs")
        .select("organization_id, plugin_key, enabled, installed_version"),
    ]);

    if (
      isMissingPluginSchemaError(entitlementsResult.error) ||
      isMissingPluginSchemaError(installsResult.error)
    ) {
      return {
        plugins: [],
        entitlements: [],
        dataBoundaries: [],
        organizations,
        warning:
          "Plugin control tables/columns are not fully initialized. Run local Supabase reset to apply latest migrations.",
      };
    }

    if (entitlementsResult.error) {
      return {
        plugins: [],
        entitlements: [],
        dataBoundaries: [],
        organizations: [],
        error: `Failed to load entitlements: ${entitlementsResult.error.message}`,
      };
    }

    if (installsResult.error) {
      return {
        plugins: [],
        entitlements: [],
        dataBoundaries: [],
        organizations: [],
        error: `Failed to load plugin installs: ${installsResult.error.message}`,
      };
    }

    const installs = (installsResult.data ?? []) as PluginInstallRow[];
    for (const install of installs) {
      if (!installsByPlugin.has(install.plugin_key)) {
        installsByPlugin.set(install.plugin_key, []);
      }
      installsByPlugin.get(install.plugin_key)?.push(install);
    }

    entitlements = (
      (entitlementsResult.data ?? []) as EntitlementBaseRow[]
    ).map((entitlement) => {
      const organization = organizationNameById.get(
        entitlement.organization_id,
      );

      return {
        id: entitlement.id,
        organization_id: entitlement.organization_id,
        organization_name: organization?.name ?? "Unknown organization",
        organization_slug: organization?.username ?? null,
        plugin_key: entitlement.plugin_key,
        status: entitlement.status,
        starts_at: entitlement.starts_at,
        ends_at: entitlement.ends_at,
        is_forced: entitlement.is_forced,
        updated_at: entitlement.updated_at,
      } satisfies PluginEntitlementRow;
    });
  } else {
    if (accessResult.error) {
      return {
        plugins: [],
        entitlements: [],
        dataBoundaries: [],
        organizations: [],
        error: `Failed to load consolidated plugin access: ${accessResult.error.message}`,
      };
    }

    const accessRows = (accessResult.data ?? []) as PluginAccessControlRow[];
    const entitlementById = new Map<string, PluginEntitlementRow>();

    for (const access of accessRows) {
      if (access.install_created_at) {
        if (!installsByPlugin.has(access.plugin_key)) {
          installsByPlugin.set(access.plugin_key, []);
        }

        installsByPlugin.get(access.plugin_key)?.push({
          organization_id: access.organization_id,
          plugin_key: access.plugin_key,
          enabled: access.enabled,
          installed_version: access.installed_version,
        });
      }

      if (
        access.entitlement_id &&
        !entitlementById.has(access.entitlement_id)
      ) {
        const organization = organizationNameById.get(access.organization_id);

        entitlementById.set(access.entitlement_id, {
          id: access.entitlement_id,
          organization_id: access.organization_id,
          organization_name: organization?.name ?? "Unknown organization",
          organization_slug: organization?.username ?? null,
          plugin_key: access.plugin_key,
          status: (access.entitlement_status ?? "inactive") as
            "active" | "inactive",
          starts_at: access.entitlement_starts_at,
          ends_at: access.entitlement_ends_at,
          is_forced: access.entitlement_is_forced ?? false,
          updated_at:
            access.entitlement_updated_at ?? new Date(0).toISOString(),
        });
      }
    }

    entitlements = Array.from(entitlementById.values()).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
  }

  let dataBoundaries: PluginDataBoundaryRow[] = [];
  if (isBoundariesTableMissing) {
    runtimeContractWarning = [
      runtimeContractWarning,
      "Plugin data boundary table is not initialized. Run local Supabase reset to apply latest migrations.",
    ]
      .filter(Boolean)
      .join(" ");
  } else if (boundariesResult.error) {
    return {
      plugins: [],
      entitlements: [],
      dataBoundaries: [],
      organizations: [],
      error: `Failed to load plugin data boundaries: ${boundariesResult.error.message}`,
    };
  } else {
    dataBoundaries = (
      (boundariesResult.data ?? []) as Omit<
        PluginDataBoundaryRow,
        "organization_name" | "organization_slug"
      >[]
    ).map((boundary) => {
      const organization = organizationNameById.get(boundary.organization_id);

      return {
        ...boundary,
        organization_name: organization?.name ?? "Unknown organization",
        organization_slug: organization?.username ?? null,
      } satisfies PluginDataBoundaryRow;
    });
  }

  const plugins = ((pluginsResult.data ?? []) as PluginCatalogBaseRow[]).map(
    (plugin) => {
      const pluginInstalls = installsByPlugin.get(plugin.key) ?? [];

      const installedCount = pluginInstalls.filter(
        (install) => install.enabled,
      ).length;
      const forcePendingCount = plugin.force_update_version
        ? pluginInstalls.filter((install) => {
            if (!install.enabled) return false;
            const installedVersion = coalescePluginVersion(
              install.installed_version,
              plugin.latest_version,
            );
            return isPluginVersionBehind(
              installedVersion,
              plugin.force_update_version,
            );
          }).length
        : 0;

      return {
        ...plugin,
        installed_count: installedCount,
        force_pending_count: forcePendingCount,
      } satisfies PluginCatalogControlRow;
    },
  );

  return {
    plugins,
    entitlements,
    dataBoundaries,
    organizations,
    warning: runtimeContractWarning,
  };
}
