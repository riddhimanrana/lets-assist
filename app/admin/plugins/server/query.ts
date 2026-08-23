"use server";

import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import {
  coalescePluginVersion,
  isPluginVersionBehind,
} from "@/lib/plugins/versioning";
import { resolvePluginApplicationEnvironment } from "@/lib/plugins/application-environment";
import { publishedPluginReleases } from "@/lib/plugins/published-releases";
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
  type PluginInstallRuntimeSummary,
  type PluginOrganizationOption,
  type PluginRuntimeProfileSummary,
} from "./shared";

type ApplicationRuntimeStatus = {
  applicationEnabled?: boolean;
  applicationVersion?: string | null;
  deploymentHealthy?: boolean;
  deploymentId?: string | null;
};

type ApplicationRuntimeFlagRow = {
  organization_id: string;
  plugin_key: string;
  enabled: boolean;
  metadata: Record<string, unknown> | null;
};

export async function getPluginControlPlaneData(): Promise<PluginControlPlaneData> {
  "use server";
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return {
      plugins: [],
      entitlements: [],
      dataBoundaries: [],
      organizations: [],
      runtimeProfiles: [],
      installRuntimes: [],
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

  const [
    pluginsResult,
    organizationsResult,
    accessResult,
    boundariesResult,
    installsResult,
    runtimeFlagsResult,
  ] = await Promise.all([
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
    service
      .from("organization_plugin_installs")
      .select(
        "organization_id, plugin_key, enabled, installed_version, desired_version, update_policy",
      ),
    service
      .from("organization_plugin_feature_flags")
      .select("organization_id, plugin_key, enabled, metadata")
      .eq("flag_key", "application-runtime"),
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
      runtimeProfiles: [],
      installRuntimes: [],
      error: `Failed to load plugin catalog: ${pluginsResult.error.message}`,
    };
  }

  if (organizationsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      dataBoundaries: [],
      organizations: [],
      runtimeProfiles: [],
      installRuntimes: [],
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

  if (installsResult.error) {
    return {
      plugins: [],
      entitlements: [],
      dataBoundaries: [],
      organizations,
      runtimeProfiles: [],
      installRuntimes: [],
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

  if (isAccessViewMissing) {
    const entitlementsResult = await service
      .from("organization_plugin_entitlements")
      .select(
        "id, organization_id, plugin_key, status, starts_at, ends_at, is_forced, updated_at",
      )
      .order("updated_at", { ascending: false });

    if (isMissingPluginSchemaError(entitlementsResult.error)) {
      return {
        plugins: [],
        entitlements: [],
        dataBoundaries: [],
        organizations,
        runtimeProfiles: [],
        installRuntimes: [],
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
        runtimeProfiles: [],
        installRuntimes: [],
        error: `Failed to load entitlements: ${entitlementsResult.error.message}`,
      };
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
        runtimeProfiles: [],
        installRuntimes: [],
        error: `Failed to load consolidated plugin access: ${accessResult.error.message}`,
      };
    }

    const accessRows = (accessResult.data ?? []) as PluginAccessControlRow[];
    const entitlementById = new Map<string, PluginEntitlementRow>();

    for (const access of accessRows) {
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
      runtimeProfiles: [],
      installRuntimes: [],
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

  const runtimeProfiles: PluginRuntimeProfileSummary[] =
    publishedPluginReleases.map((release) => ({
      plugin_key: release.pluginKey,
      profile: release.runtimeProfile,
      version: release.version,
      signed: release.signer !== null,
      project_name: release.buildArtifact?.projectName ?? null,
      project_id: release.buildArtifact?.projectId ?? null,
    }));

  if (runtimeFlagsResult.error) {
    runtimeContractWarning = [
      runtimeContractWarning,
      "Application runtime selections could not be loaded.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const runtimeFlags = runtimeFlagsResult.error
    ? []
    : ((runtimeFlagsResult.data ?? []) as ApplicationRuntimeFlagRow[]);
  const runtimeFlagByInstall = new Map(
    runtimeFlags.map((flag) => [
      `${flag.organization_id}:${flag.plugin_key}`,
      flag,
    ]),
  );
  const applicationEnvironment = resolvePluginApplicationEnvironment();
  const applicationPluginKeys = new Set(
    runtimeProfiles
      .filter((release) => release.profile === "application")
      .map((release) => release.plugin_key),
  );

  const statusByInstall = new Map<string, ApplicationRuntimeStatus>();
  if (applicationEnvironment) {
    const statusRows = await Promise.all(
      installs
        .filter((install) => applicationPluginKeys.has(install.plugin_key))
        .map(async (install) => {
          const { data: status, error } = await service.rpc(
            "get_plugin_application_runtime_admin_status",
            {
              p_organization_id: install.organization_id,
              p_plugin_key: install.plugin_key,
              p_environment: applicationEnvironment,
            },
          );
          return {
            key: `${install.organization_id}:${install.plugin_key}`,
            status:
              error || !status ? null : (status as ApplicationRuntimeStatus),
          };
        }),
    );
    const failedStatusCount = statusRows.filter((row) => !row.status).length;
    if (failedStatusCount > 0) {
      runtimeContractWarning = [
        runtimeContractWarning,
        "Some application deployment health checks could not be loaded.",
      ]
        .filter(Boolean)
        .join(" ");
    }
    for (const row of statusRows) {
      if (row.status) statusByInstall.set(row.key, row.status);
    }
  }

  const installRuntimes: PluginInstallRuntimeSummary[] = installs.map(
    (install) => {
      const key = `${install.organization_id}:${install.plugin_key}`;
      const flag = runtimeFlagByInstall.get(key);
      const status = statusByInstall.get(key);
      const metadata = flag?.metadata ?? {};
      const metadataEnvironment = metadata.environment;
      const metadataVersion = metadata.runtimeVersion;
      const metadataDeploymentId = metadata.deploymentId;

      return {
        organization_id: install.organization_id,
        organization_name:
          organizationNameById.get(install.organization_id)?.name ??
          "Unknown organization",
        plugin_key: install.plugin_key,
        enabled: install.enabled,
        installed_version: install.installed_version,
        desired_version: install.desired_version,
        update_policy: install.update_policy,
        application_enabled:
          status?.applicationEnabled ?? flag?.enabled ?? false,
        application_environment:
          status && applicationEnvironment
            ? applicationEnvironment
            : metadataEnvironment === "development" ||
                metadataEnvironment === "production"
              ? metadataEnvironment
              : null,
        application_version:
          status?.applicationVersion ??
          (typeof metadataVersion === "string" ? metadataVersion : null),
        deployment_healthy: status ? (status.deploymentHealthy ?? false) : null,
        deployment_id:
          status?.deploymentId ??
          (typeof metadataDeploymentId === "string"
            ? metadataDeploymentId
            : null),
      } satisfies PluginInstallRuntimeSummary;
    },
  );

  return {
    plugins,
    entitlements,
    dataBoundaries,
    organizations,
    runtimeProfiles,
    installRuntimes,
    warning: runtimeContractWarning,
  };
}
