import type { ReactNode } from "react";

import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  OrganizationPluginAccessRole,
  OrganizationPluginSurface,
  OrganizationPluginSurfaceAccessLevel,
  OrganizationPluginSurfaceRenderTargetContext,
  OrganizationPluginTargetingConfig,
} from "@/types";

export interface ResolveOrganizationPluginSurfacesOptions {
  organizationId: string;
  surface: OrganizationPluginSurface;
  viewerRole?: OrganizationPluginAccessRole | null;
  target?: OrganizationPluginSurfaceRenderTargetContext;
  useAdminClient?: boolean;
}

export interface ResolvedOrganizationPluginSurface {
  pluginKey: string;
  node: ReactNode;
}

type PluginInstallRow = {
  plugin_key: string;
  enabled: boolean;
  configuration: Record<string, unknown> | null;
};

type PluginAccessRow = {
  plugin_key: string;
  enabled: boolean;
  is_accessible: boolean;
  configuration: Record<string, unknown> | null;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
};

function isMissingPluginTableError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    (typeof error.message === "string" && error.message.includes("does not exist"))
  );
}

const ROLE_ORDER: Record<OrganizationPluginAccessRole, number> = {
  member: 1,
  staff: 2,
  admin: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeTargeting(
  value: unknown,
): OrganizationPluginTargetingConfig | undefined {
  if (!isRecord(value)) return undefined;

  const modeRaw = typeof value.mode === "string" ? value.mode.toLowerCase() : undefined;
  const mode = modeRaw === "any" ? "any" : modeRaw === "all" ? "all" : undefined;

  const targeting: OrganizationPluginTargetingConfig = {
    ...(mode ? { mode } : {}),
    ...(isNonEmptyArray(value.anonymousSignupIds)
      ? { anonymousSignupIds: value.anonymousSignupIds }
      : {}),
    ...(isNonEmptyArray(value.userProfileIds)
      ? { userProfileIds: value.userProfileIds }
      : {}),
    ...(isNonEmptyArray(value.userIds) ? { userIds: value.userIds } : {}),
    ...(isNonEmptyArray(value.projectIds) ? { projectIds: value.projectIds } : {}),
    ...(isNonEmptyArray(value.anonymousEmails)
      ? { anonymousEmails: value.anonymousEmails }
      : {}),
  };

  return Object.keys(targeting).length > 0 ? targeting : undefined;
}

export function hasSurfaceAccess(
  minimumAccess: OrganizationPluginSurfaceAccessLevel,
  currentRole: OrganizationPluginAccessRole | null | undefined,
): boolean {
  if (minimumAccess === "public") {
    return true;
  }

  if (!currentRole) {
    return false;
  }

  return ROLE_ORDER[currentRole] >= ROLE_ORDER[minimumAccess];
}

export function matchesPluginTargeting(
  targeting: OrganizationPluginTargetingConfig | undefined,
  context: OrganizationPluginSurfaceRenderTargetContext | undefined,
): boolean {
  if (!targeting) {
    return true;
  }

  const checks: boolean[] = [];

  if (isNonEmptyArray(targeting.anonymousSignupIds)) {
    const candidate = normalizeOptionalString(context?.anonymousSignupId);
    checks.push(Boolean(candidate && targeting.anonymousSignupIds.includes(candidate)));
  }

  if (isNonEmptyArray(targeting.userProfileIds)) {
    const candidate = normalizeOptionalString(context?.userProfileId);
    checks.push(Boolean(candidate && targeting.userProfileIds.includes(candidate)));
  }

  if (isNonEmptyArray(targeting.userIds)) {
    const candidate = normalizeOptionalString(context?.userId);
    checks.push(Boolean(candidate && targeting.userIds.includes(candidate)));
  }

  if (isNonEmptyArray(targeting.projectIds)) {
    const candidate = normalizeOptionalString(context?.projectId);
    checks.push(Boolean(candidate && targeting.projectIds.includes(candidate)));
  }

  if (isNonEmptyArray(targeting.anonymousEmails)) {
    const candidate = normalizeOptionalString(context?.anonymousEmail)?.toLowerCase();
    checks.push(
      Boolean(
        candidate &&
          targeting.anonymousEmails.some((email) => email.toLowerCase() === candidate),
      ),
    );
  }

  if (checks.length === 0) {
    return true;
  }

  const mode = targeting.mode ?? "all";
  return mode === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

export async function resolveOrganizationPluginSurfaces(
  options: ResolveOrganizationPluginSurfacesOptions,
): Promise<ResolvedOrganizationPluginSurface[]> {
  const supabase = options.useAdminClient ? getAdminClient() : await createClient();

  const pluginAccessResult = await supabase
    .from("organization_plugin_access")
    .select("plugin_key, enabled, is_accessible, configuration")
    .eq("organization_id", options.organizationId)
    .eq("enabled", true);

  let installRows: PluginInstallRow[] = [];

  if (!isMissingPluginTableError(pluginAccessResult.error)) {
    if (pluginAccessResult.error) {
      throw new Error(
        `Failed to load consolidated plugin access: ${pluginAccessResult.error.message}`,
      );
    }

    installRows = ((pluginAccessResult.data ?? []) as PluginAccessRow[])
      .filter((row) => row.is_accessible)
      .map((row) => ({
        plugin_key: row.plugin_key,
        enabled: row.enabled,
        configuration: row.configuration,
      }));
  } else {
    const { data: installs, error } = await supabase
      .from("organization_plugin_installs")
      .select("plugin_key, enabled, configuration")
      .eq("organization_id", options.organizationId)
      .eq("enabled", true);

    if (isMissingPluginTableError(error)) {
      return [];
    }

    if (error) {
      throw new Error(`Failed to load plugin installs: ${error.message}`);
    }

    installRows = (installs ?? []) as PluginInstallRow[];
  }

  const results: ResolvedOrganizationPluginSurface[] = [];

  for (const install of installRows) {
    const plugin = getRegisteredPlugin(install.plugin_key);
    if (!plugin || !plugin.renderSurface) {
      continue;
    }

    const surfaceAccess =
      plugin.manifest.surfaceAccess?.[options.surface] ??
      plugin.manifest.minimumRole ??
      "member";

    if (!hasSurfaceAccess(surfaceAccess, options.viewerRole)) {
      continue;
    }

    const configuration = isRecord(install.configuration)
      ? (install.configuration as Record<string, unknown>)
      : null;

    const targeting = normalizeTargeting(
      configuration && isRecord(configuration.targeting)
        ? configuration.targeting
        : undefined,
    );

    if (!matchesPluginTargeting(targeting, options.target)) {
      continue;
    }

    const node = await plugin.renderSurface(options.surface, {
      organizationId: options.organizationId,
      pluginConfiguration: configuration,
      viewerRole: options.viewerRole,
      target: options.target,
    });

    if (!node) {
      continue;
    }

    results.push({
      pluginKey: install.plugin_key,
      node,
    });
  }

  return results;
}
