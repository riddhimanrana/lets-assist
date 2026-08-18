import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import {
  isEntitlementActive,
  loadAccessibleOrganizationPluginAccess,
  type PluginAccessFailureMode,
} from "@/lib/plugins/organization-plugin-access";
import {
  coalescePluginVersion,
  isPluginVersionBehind,
  isPluginRuntimeVersionExact,
} from "@/lib/plugins/versioning";
import type {
  OrganizationPluginAccessRole,
  OrganizationPluginExperience,
  ResolvedOrganizationPlugin,
} from "@/types";
import { getActiveOrganizationMembershipRole } from "@/lib/organization/active-membership";

export interface ResolvedOrganizationPluginExperience {
  organizationId: string;
  pluginKey: string;
  experience: OrganizationPluginExperience;
}

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

export { isEntitlementActive };

export async function resolveOrganizationPluginExperiences(
  organizationIds: string[],
): Promise<ResolvedOrganizationPluginExperience[]> {
  const uniqueOrganizationIds = Array.from(
    new Set(organizationIds.filter(Boolean)),
  );
  if (uniqueOrganizationIds.length === 0) return [];

  let supabase;
  try {
    supabase = getAdminClient();
  } catch {
    supabase = await createClient();
  }

  const accessRows = await loadAccessibleOrganizationPluginAccess({
    supabase,
    organizationIds: uniqueOrganizationIds,
  });

  return accessRows
    .flatMap((row) => {
      const definition = getRegisteredPlugin(row.plugin_key);
      const installedVersion = coalescePluginVersion(
        row.installed_version,
        row.latest_version,
      );
      if (
        !definition ||
        !isPluginRuntimeVersionExact(
          installedVersion,
          definition.manifest.version,
        )
      ) {
        return [];
      }
      const experience = definition.manifest.organizationExperience;
      if (!experience) return [];
      return [
        {
          organizationId: row.organization_id,
          pluginKey: row.plugin_key,
          experience,
        },
      ];
    })
    .sort((left, right) => left.pluginKey.localeCompare(right.pluginKey));
}

export async function resolveOrganizationPlugins(options: {
  organizationId: string;
  userRole: OrganizationPluginAccessRole | null;
  viewerUserId?: string;
  allowPublicAccess?: boolean;
  failureMode?: PluginAccessFailureMode;
}): Promise<ResolvedOrganizationPlugin[]> {
  const { organizationId } = options;

  if (
    !options.userRole &&
    !options.viewerUserId &&
    !options.allowPublicAccess
  ) {
    return [];
  }

  let supabase;
  try {
    supabase = getAdminClient();
  } catch {
    supabase = await createClient();
  }

  const userRole = options.viewerUserId
    ? await getActiveOrganizationMembershipRole(
        supabase,
        organizationId,
        options.viewerUserId,
      )
    : options.userRole;
  if (!userRole && !options.allowPublicAccess) return [];

  const accessRows = await loadAccessibleOrganizationPluginAccess({
    supabase,
    organizationIds: [organizationId],
    failureMode: options.failureMode,
  });
  const resolved: ResolvedOrganizationPlugin[] = [];

  for (const access of accessRows) {
    const definition = getRegisteredPlugin(access.plugin_key);
    if (!definition) {
      continue;
    }

    const installedVersion = coalescePluginVersion(
      access.installed_version,
      access.latest_version,
    );
    const forceUpdateRequired =
      Boolean(access.force_update_version) &&
      isPluginVersionBehind(installedVersion, access.force_update_version);

    if (forceUpdateRequired) {
      continue;
    }
    if (
      !isPluginRuntimeVersionExact(
        installedVersion,
        definition.manifest.version,
      )
    ) {
      continue;
    }

    const minimumRole = definition.manifest.minimumRole ?? "member";
    if (
      !options.allowPublicAccess &&
      !hasOrganizationPluginAccess(userRole, minimumRole)
    ) {
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
      installedAt: access.installed_at,
      enabled: access.enabled,
      configuration: access.configuration,
      latestVersion: access.latest_version,
      installedVersion,
      forceUpdateVersion: access.force_update_version,
      forceUpdateRequired,
    });
  }

  return resolved.sort((a, b) => a.navLabel.localeCompare(b.navLabel));
}

export async function resolveOrganizationPluginByKey(options: {
  organizationId: string;
  userRole: OrganizationPluginAccessRole | null;
  viewerUserId?: string;
  allowPublicAccess?: boolean;
  pluginKey: string;
  failureMode?: PluginAccessFailureMode;
}): Promise<ResolvedOrganizationPlugin | null> {
  const plugins = await resolveOrganizationPlugins({
    organizationId: options.organizationId,
    userRole: options.userRole,
    viewerUserId: options.viewerUserId,
    allowPublicAccess: options.allowPublicAccess,
    failureMode: options.failureMode,
  });

  return plugins.find((plugin) => plugin.key === options.pluginKey) ?? null;
}
