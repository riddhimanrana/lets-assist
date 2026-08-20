import { isEntitlementActive } from "@/lib/plugins/resolve-org-plugins";
import {
  coalescePluginVersion,
  isPluginVersionBehind,
  isPluginRuntimeVersionExact,
  isPluginVersionWithinContractRange,
} from "@/lib/plugins/versioning";
import type { PluginInstallContractRange } from "@/lib/plugins/versioning";
import type { OrganizationPluginAdminSetting } from "@/types";

export type PluginCatalogForSettings = {
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
  updated_at: string | null;
};

export type PluginEntitlementForSettings = {
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  is_forced: boolean;
};

export type PluginInstallForSettings = {
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
  configuration: Record<string, unknown> | null;
};

export type RuntimePluginInfo = {
  key: string;
  navLabel: string;
  version: string;
  supportedInstallContracts: PluginInstallContractRange;
  minimumRole: "admin" | "staff" | "member";
  ownerName?: OrganizationPluginAdminSetting["ownerName"];
  ownerType?: OrganizationPluginAdminSetting["ownerType"];
  detailedDescription?: OrganizationPluginAdminSetting["detailedDescription"];
  capabilityHighlights?: OrganizationPluginAdminSetting["capabilityHighlights"];
  dataAccess?: OrganizationPluginAdminSetting["dataAccess"];
  dataAccessPurposes?: OrganizationPluginAdminSetting["dataAccessPurposes"];
  routes?: Array<{ path: string; label: string }>;
  backendCapabilities?: Array<{
    key: string;
    kind: string;
    description: string;
  }>;
  configSchema?: OrganizationPluginAdminSetting["configSchema"];
  requiredScopes?: OrganizationPluginAdminSetting["requiredScopes"];
  dataDeletionAvailable?: boolean;
  dataDeletionExternalSystemsNotCovered?: string[];
};

export function buildOrganizationPluginAdminSettings(input: {
  catalog: PluginCatalogForSettings[];
  entitlements: PluginEntitlementForSettings[];
  installs: PluginInstallForSettings[];
  runtimePlugins: RuntimePluginInfo[];
  now?: Date;
}): OrganizationPluginAdminSetting[] {
  const now = input.now ?? new Date();
  const runtimeByKey = new Map(
    input.runtimePlugins.map((plugin) => [plugin.key, plugin]),
  );
  const installByKey = new Map(
    input.installs.map((install) => [install.plugin_key, install]),
  );
  const entitledPrivateKeys = new Set(
    input.entitlements
      .filter((entitlement) => isEntitlementActive(entitlement, now))
      .map((entitlement) => entitlement.plugin_key),
  );
  const forcedPrivateKeys = new Set(
    input.entitlements
      .filter(
        (entitlement) =>
          entitlement.is_forced && isEntitlementActive(entitlement, now),
      )
      .map((entitlement) => entitlement.plugin_key),
  );

  return input.catalog
    .filter((plugin) => plugin.is_active)
    .map((plugin) => {
      const runtimePlugin = runtimeByKey.get(plugin.key);
      const install = installByKey.get(plugin.key);
      const ownerName = runtimePlugin?.ownerName?.trim() || "Let's Assist";
      const ownerType = runtimePlugin?.ownerType ?? "platform-official";
      const entitled =
        plugin.visibility === "global" || entitledPrivateKeys.has(plugin.key);
      const isForced = forcedPrivateKeys.has(plugin.key);

      const description = plugin.description?.trim() || undefined;
      const detailedDescription =
        runtimePlugin?.detailedDescription?.trim() ||
        description ||
        `${plugin.name} plugin for organization workflows.`;

      let blockedReason: string | null = null;
      if (!runtimePlugin) {
        blockedReason = "Plugin package is not loaded in this deployment.";
      } else if (!entitled) {
        blockedReason =
          "This organization does not currently have an active entitlement.";
      }

      const installedVersion = coalescePluginVersion(
        install?.installed_version,
        plugin.latest_version,
      );
      const forceUpdateRequired =
        Boolean(plugin.force_update_version) &&
        isPluginVersionBehind(installedVersion, plugin.force_update_version);
      const updateAvailable = isPluginVersionBehind(
        installedVersion,
        plugin.latest_version,
      );
      const updateDeployedInRuntime = Boolean(
        runtimePlugin &&
        isPluginRuntimeVersionExact(
          plugin.latest_version,
          runtimePlugin.version,
        ),
      );

      if (!blockedReason && forceUpdateRequired) {
        blockedReason =
          "A platform-enforced update is required before this plugin can be used.";
      } else if (
        !blockedReason &&
        runtimePlugin &&
        !isPluginVersionWithinContractRange(
          installedVersion,
          runtimePlugin.supportedInstallContracts,
        )
      ) {
        blockedReason =
          "Update this installation before using the plugin version loaded by the platform.";
      }

      return {
        key: plugin.key,
        name: plugin.name,
        description,
        detailedDescription,
        ownerName,
        ownerType,
        capabilityHighlights: runtimePlugin?.capabilityHighlights ?? [],
        dataAccess: runtimePlugin?.dataAccess ?? [
          ...(runtimePlugin?.routes ?? []).map(
            (route) =>
              `Route: ${route.label} (/plugins/${plugin.key}/${route.path})`,
          ),
          ...(runtimePlugin?.backendCapabilities ?? []).map(
            (capability) => `${capability.kind}: ${capability.description}`,
          ),
        ],
        dataAccessPurposes: runtimePlugin?.dataAccessPurposes ?? [],
        visibility: plugin.visibility,
        navLabel: runtimePlugin?.navLabel ?? plugin.name,
        version: runtimePlugin?.version ?? "unregistered",
        minimumRole: runtimePlugin?.minimumRole ?? "member",
        availableInRuntime: Boolean(runtimePlugin),
        entitled,
        isForced,
        installed: Boolean(install),
        enabled: install?.enabled ?? false,
        blockedReason,
        latestVersion: plugin.latest_version,
        installedVersion: install?.installed_version ?? null,
        forceUpdateVersion: plugin.force_update_version,
        updateAvailable,
        updateDeployedInRuntime,
        forceUpdateRequired,
        codeRepository: plugin.code_repository,
        codeReference: plugin.code_reference,
        privateCodebase: plugin.private_codebase,
        lastUpdatedAt: plugin.updated_at,
        configuration: install?.configuration ?? null,
        configSchema: runtimePlugin?.configSchema ?? null,
        requiredScopes: runtimePlugin?.requiredScopes ?? [],
        dataDeletionAvailable: Boolean(
          runtimePlugin?.dataDeletionAvailable &&
          entitled &&
          !isForced &&
          !install,
        ),
        dataDeletionExternalSystemsNotCovered:
          runtimePlugin?.dataDeletionExternalSystemsNotCovered ?? [],
      } satisfies OrganizationPluginAdminSetting;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
