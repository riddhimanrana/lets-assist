import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  coalescePluginVersion,
  isPluginVersionBehind,
} from "@/lib/plugins/versioning";
import { withRetryableSupabaseQuery } from "@/lib/supabase/retry-query";

export type PluginAccessQueryClient = Pick<SupabaseClient, "from">;
export type PluginAccessFailureMode = "empty" | "throw";

export class OrganizationPluginAccessUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Organization plugin access is temporarily unavailable.", { cause });
    this.name = "OrganizationPluginAccessUnavailableError";
  }
}

type PluginCatalogRow = {
  key: string;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
  force_update_version: string | null;
};

export type PluginEntitlementRow = {
  organization_id?: string;
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  is_forced: boolean;
};

type PluginInstallRow = {
  organization_id: string;
  plugin_key: string;
  enabled: boolean;
  configuration: Record<string, unknown> | null;
  installed_at: string | null;
  installed_version: string | null;
};

export type OrganizationPluginAccessRow = {
  organization_id: string;
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

export function isEntitlementActive(
  entitlement: Pick<PluginEntitlementRow, "status" | "starts_at" | "ends_at">,
  now = new Date(),
): boolean {
  if (entitlement.status !== "active") return false;

  const startsAt = entitlement.starts_at
    ? new Date(entitlement.starts_at)
    : null;
  const endsAt = entitlement.ends_at ? new Date(entitlement.ends_at) : null;

  if (startsAt && !Number.isFinite(startsAt.getTime())) return false;
  if (endsAt && !Number.isFinite(endsAt.getTime())) return false;
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;

  return true;
}

function isMissingPluginAccessReadModelError(
  error: SupabaseLikeError | null,
): boolean {
  if (!error) return false;

  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("could not find the relation")
  );
}

function isBlockedByForcedUpdate(row: {
  installed_version: string | null;
  latest_version: string;
  force_update_version: string | null;
}): boolean {
  const installedVersion = coalescePluginVersion(
    row.installed_version,
    row.latest_version,
  );

  return Boolean(
    row.force_update_version &&
    isPluginVersionBehind(installedVersion, row.force_update_version),
  );
}

function handlePluginAccessReadFailure(
  failureMode: PluginAccessFailureMode,
  cause?: unknown,
): [] {
  if (failureMode === "throw") {
    throw new OrganizationPluginAccessUnavailableError(cause);
  }
  return [];
}

export function filterConsolidatedPluginAccessRows(
  rows: OrganizationPluginAccessRow[],
): OrganizationPluginAccessRow[] {
  return rows.filter(
    (row) =>
      row.enabled &&
      row.is_active &&
      row.is_accessible &&
      !isBlockedByForcedUpdate(row),
  );
}

export function resolveLegacyOrganizationPluginAccess(input: {
  catalog: PluginCatalogRow[];
  entitlements: PluginEntitlementRow[];
  installs: PluginInstallRow[];
  now?: Date;
}): OrganizationPluginAccessRow[] {
  const now = input.now ?? new Date();
  const catalogByKey = new Map(input.catalog.map((row) => [row.key, row]));
  const activeEntitlementByOrganizationPlugin = new Map<
    string,
    PluginEntitlementRow
  >();

  for (const entitlement of input.entitlements) {
    if (
      !entitlement.organization_id ||
      !isEntitlementActive(entitlement, now)
    ) {
      continue;
    }

    activeEntitlementByOrganizationPlugin.set(
      `${entitlement.organization_id}:${entitlement.plugin_key}`,
      entitlement,
    );
  }

  const installByOrganizationPlugin = new Map<string, PluginInstallRow>();
  for (const install of input.installs) {
    if (!install.enabled) continue;
    installByOrganizationPlugin.set(
      `${install.organization_id}:${install.plugin_key}`,
      install,
    );
  }

  // A global/free plugin still needs an enabled install. A private plugin also
  // needs an active entitlement. Active forced entitlements intentionally act
  // as enabled installs, matching the consolidated read model.
  const candidateKeys = new Set(installByOrganizationPlugin.keys());
  for (const [key, entitlement] of activeEntitlementByOrganizationPlugin) {
    if (entitlement.is_forced) candidateKeys.add(key);
  }

  const resolved: OrganizationPluginAccessRow[] = [];
  for (const candidateKey of candidateKeys) {
    const separatorIndex = candidateKey.indexOf(":");
    const organizationId = candidateKey.slice(0, separatorIndex);
    const pluginKey = candidateKey.slice(separatorIndex + 1);
    const catalogItem = catalogByKey.get(pluginKey);
    const install = installByOrganizationPlugin.get(candidateKey);
    const entitlement = activeEntitlementByOrganizationPlugin.get(candidateKey);

    if (!catalogItem?.is_active) continue;
    if (!install && !entitlement?.is_forced) continue;
    if (catalogItem.visibility === "private" && !entitlement) continue;

    const row: OrganizationPluginAccessRow = {
      organization_id: organizationId,
      plugin_key: pluginKey,
      enabled: Boolean(install?.enabled || entitlement?.is_forced),
      configuration: install?.configuration ?? null,
      installed_at: install?.installed_at ?? null,
      installed_version: install?.installed_version ?? null,
      visibility: catalogItem.visibility,
      is_active: catalogItem.is_active,
      latest_version: catalogItem.latest_version,
      force_update_version: catalogItem.force_update_version,
      is_accessible: true,
    };

    if (!isBlockedByForcedUpdate(row)) resolved.push(row);
  }

  return resolved.sort((left, right) => {
    const organizationOrder = left.organization_id.localeCompare(
      right.organization_id,
    );
    return organizationOrder || left.plugin_key.localeCompare(right.plugin_key);
  });
}

/**
 * Load the canonical catalog + install + entitlement access decision.
 *
 * The consolidated view is preferred. Older deployments without that view are
 * resolved from all three control-plane tables. Any other read uncertainty,
 * including a partial legacy query, fails closed instead of trusting install
 * rows alone.
 */
export async function loadAccessibleOrganizationPluginAccess(input: {
  supabase: PluginAccessQueryClient;
  organizationIds: string[];
  now?: Date;
  failureMode?: PluginAccessFailureMode;
}): Promise<OrganizationPluginAccessRow[]> {
  const organizationIds = Array.from(
    new Set(input.organizationIds.filter(Boolean)),
  );
  if (organizationIds.length === 0) return [];
  const failureMode = input.failureMode ?? "empty";

  try {
    const accessResult = await withRetryableSupabaseQuery(
      () =>
        input.supabase
          .from("organization_plugin_access")
          .select(
            "organization_id, plugin_key, enabled, configuration, installed_at, installed_version, visibility, is_active, latest_version, force_update_version, is_accessible",
          )
          .in("organization_id", organizationIds)
          .eq("enabled", true),
      { maxAttempts: 2, initialDelayMs: 75, maxDelayMs: 75 },
    );

    if (!accessResult.error) {
      return filterConsolidatedPluginAccessRows(
        (accessResult.data ?? []) as OrganizationPluginAccessRow[],
      );
    }

    if (!isMissingPluginAccessReadModelError(accessResult.error)) {
      return handlePluginAccessReadFailure(failureMode, accessResult.error);
    }

    const [catalogResult, entitlementResult, installResult] = await Promise.all(
      [
        withRetryableSupabaseQuery(
          () =>
            input.supabase
              .from("plugins")
              .select(
                "key, visibility, is_active, latest_version, force_update_version",
              )
              .eq("is_active", true),
          { maxAttempts: 2, initialDelayMs: 75, maxDelayMs: 75 },
        ),
        withRetryableSupabaseQuery(
          () =>
            input.supabase
              .from("organization_plugin_entitlements")
              .select(
                "organization_id, plugin_key, status, starts_at, ends_at, is_forced",
              )
              .in("organization_id", organizationIds),
          { maxAttempts: 2, initialDelayMs: 75, maxDelayMs: 75 },
        ),
        withRetryableSupabaseQuery(
          () =>
            input.supabase
              .from("organization_plugin_installs")
              .select(
                "organization_id, plugin_key, enabled, configuration, installed_at, installed_version",
              )
              .in("organization_id", organizationIds)
              .eq("enabled", true),
          { maxAttempts: 2, initialDelayMs: 75, maxDelayMs: 75 },
        ),
      ],
    );

    if (catalogResult.error || entitlementResult.error || installResult.error) {
      return handlePluginAccessReadFailure(
        failureMode,
        catalogResult.error ?? entitlementResult.error ?? installResult.error,
      );
    }

    return resolveLegacyOrganizationPluginAccess({
      catalog: (catalogResult.data ?? []) as PluginCatalogRow[],
      entitlements: (entitlementResult.data ?? []) as PluginEntitlementRow[],
      installs: (installResult.data ?? []) as PluginInstallRow[],
      now: input.now,
    });
  } catch (error) {
    if (error instanceof OrganizationPluginAccessUnavailableError) {
      throw error;
    }
    return handlePluginAccessReadFailure(failureMode, error);
  }
}
