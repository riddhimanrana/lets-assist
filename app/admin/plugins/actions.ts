"use server";

import { revalidatePath } from "next/cache";

import { getAdminClient } from "@/lib/supabase/admin";
import { transitionOrganizationPluginInstall } from "@/lib/plugins/control-plane-transition";
import {
  applyConfigDefaults,
  validatePluginConfig,
  type PluginConfigSchema,
} from "@/lib/plugins/config-schema";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { coalescePluginVersion, isPluginVersionBehind } from "@/lib/plugins/versioning";
import { syncRegisteredPluginRuntimeContracts } from "@/lib/plugins/runtime-contracts";
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
  is_forced: boolean;
  updated_at: string;
};

type PluginDataBoundaryRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string | null;
  plugin_key: string;
  boundary_status: "active" | "disabled" | "migration_pending" | "archived";
  data_schema: string;
  data_prefix: string | null;
  isolation_mode: "shared" | "dedicated_schema" | "dedicated_project" | "external";
  direct_client_access: "blocked" | "server_preferred" | "rls_allowed";
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

type PluginAccessControlRow = {
  organization_id: string;
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
  install_created_at: string | null;
  entitlement_id: string | null;
  entitlement_status: "active" | "inactive" | null;
  entitlement_starts_at: string | null;
  entitlement_ends_at: string | null;
  entitlement_is_forced: boolean | null;
  entitlement_updated_at: string | null;
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

type PluginCatalogVisibilityRow = {
  key: string;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
};

type EntitlementBaseRow = {
  id: string;
  organization_id: string;
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  is_forced: boolean;
  updated_at: string;
};

type ForceInstallEntitlementSnapshot = {
  id: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

type ForceInstallEntitlementCompensation =
  | {
      kind: "delete_created";
      id: string;
      activationUpdatedAt: string;
    }
  | {
      kind: "restore_reactivated";
      id: string;
      activationUpdatedAt: string;
      previous: ForceInstallEntitlementSnapshot;
    };

export type PluginControlPlaneData = {
  plugins: PluginCatalogControlRow[];
  entitlements: PluginEntitlementRow[];
  dataBoundaries: PluginDataBoundaryRow[];
  organizations: PluginOrganizationOption[];
  error?: string;
  warning?: string;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingPluginSchemaError(error: SupabaseLikeError | null): boolean {
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

function isEntitlementCurrentlyActive(
  entitlement: ForceInstallEntitlementSnapshot,
  now: Date,
) {
  if (entitlement.status !== "active") return false;
  if (entitlement.starts_at && new Date(entitlement.starts_at) > now) return false;
  if (entitlement.ends_at && new Date(entitlement.ends_at) < now) return false;
  return true;
}

function normalizeVersionInput(value: string): string {
  const normalized = value.trim().replace(/^v/i, "");
  return normalized || "1.0.0";
}

function parseOrganizationIdentifiers(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,;\s]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function normalizeOptionalIsoDate(
  value: string | null | undefined,
  fieldLabel: string,
): { value: string | null; error?: string } {
  if (!value) {
    return { value: null };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, error: `${fieldLabel} is invalid.` };
  }

  return { value: parsed.toISOString() };
}

function normalizeEntitlementDateWindow(input: {
  startsAt?: string | null;
  endsAt?: string | null;
}): { startsAt: string | null; endsAt: string | null; error?: string } {
  const startsAtResult = normalizeOptionalIsoDate(input.startsAt, "Start date");
  if (startsAtResult.error) {
    return { startsAt: null, endsAt: null, error: startsAtResult.error };
  }

  const endsAtResult = normalizeOptionalIsoDate(input.endsAt, "End date");
  if (endsAtResult.error) {
    return { startsAt: null, endsAt: null, error: endsAtResult.error };
  }

  if (
    startsAtResult.value &&
    endsAtResult.value &&
    new Date(startsAtResult.value) > new Date(endsAtResult.value)
  ) {
    return {
      startsAt: startsAtResult.value,
      endsAt: endsAtResult.value,
      error: "Start date must be before end date.",
    };
  }

  return {
    startsAt: startsAtResult.value,
    endsAt: endsAtResult.value,
  };
}

export async function getPluginControlPlaneData(): Promise<PluginControlPlaneData> {
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

  const [pluginsResult, organizationsResult, accessResult, boundariesResult] = await Promise.all([
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
      .select("id, organization_id, plugin_key, boundary_status, data_schema, data_prefix, isolation_mode, direct_client_access, updated_at")
      .order("updated_at", { ascending: false }),
  ]);

  const isAccessViewMissing = isMissingPluginSchemaError(accessResult.error);
  const isBoundariesTableMissing = isMissingPluginSchemaError(boundariesResult.error);

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

  const organizations = (organizationsResult.data ?? []) as PluginOrganizationOption[];
  const organizationNameById = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );

  const installsByPlugin = new Map<string, PluginInstallRow[]>();
  let entitlements: PluginEntitlementRow[] = [];

  if (isAccessViewMissing) {
    const [entitlementsResult, installsResult] = await Promise.all([
      service
        .from("organization_plugin_entitlements")
        .select("id, organization_id, plugin_key, status, starts_at, ends_at, is_forced, updated_at")
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

    entitlements = ((entitlementsResult.data ?? []) as EntitlementBaseRow[]).map(
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
          is_forced: entitlement.is_forced,
          updated_at: entitlement.updated_at,
        } satisfies PluginEntitlementRow;
      },
    );
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

      if (access.entitlement_id && !entitlementById.has(access.entitlement_id)) {
        const organization = organizationNameById.get(access.organization_id);

        entitlementById.set(access.entitlement_id, {
          id: access.entitlement_id,
          organization_id: access.organization_id,
          organization_name: organization?.name ?? "Unknown organization",
          organization_slug: organization?.username ?? null,
          plugin_key: access.plugin_key,
          status: (access.entitlement_status ?? "inactive") as "active" | "inactive",
          starts_at: access.entitlement_starts_at,
          ends_at: access.entitlement_ends_at,
          is_forced: access.entitlement_is_forced ?? false,
          updated_at: access.entitlement_updated_at ?? new Date(0).toISOString(),
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
    dataBoundaries = ((boundariesResult.data ?? []) as Omit<
      PluginDataBoundaryRow,
      "organization_name" | "organization_slug"
    >[]).map((boundary) => {
      const organization = organizationNameById.get(boundary.organization_id);

      return {
        ...boundary,
        organization_name: organization?.name ?? "Unknown organization",
        organization_slug: organization?.username ?? null,
      } satisfies PluginDataBoundaryRow;
    });
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

  return {
    plugins,
    entitlements,
    dataBoundaries,
    organizations,
    warning: runtimeContractWarning,
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
  isForced?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  if (!input.organizationId || !input.pluginKey) {
    return { success: false, error: "Organization and plugin are required." };
  }

  const dateWindow = normalizeEntitlementDateWindow({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });

  if (dateWindow.error) {
    return { success: false, error: dateWindow.error };
  }

  const service = getAdminClient();
  const { error } = await service
    .from("organization_plugin_entitlements")
    .upsert(
      {
        organization_id: input.organizationId,
        plugin_key: input.pluginKey,
        status: input.status,
        starts_at: dateWindow.startsAt,
        ends_at: dateWindow.endsAt,
        is_forced: input.isForced ?? false,
        updated_at: new Date().toISOString(),
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

export async function bulkUpsertOrganizationPluginEntitlements(input: {
  pluginKey: string;
  organizationIdentifiers: string;
  status: "active" | "inactive";
  startsAt?: string | null;
  endsAt?: string | null;
  isForced?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  updatedCount?: number;
  unmatchedIdentifiers?: string[];
}> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const pluginKey = input.pluginKey.trim().toLowerCase();
  if (!pluginKey) {
    return { success: false, error: "Plugin key is required." };
  }

  const identifiers = parseOrganizationIdentifiers(input.organizationIdentifiers);
  if (identifiers.length === 0) {
    return {
      success: false,
      error:
        "Add at least one organization identifier (organization ID or username).",
    };
  }

  const dateWindow = normalizeEntitlementDateWindow({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });

  if (dateWindow.error) {
    return { success: false, error: dateWindow.error };
  }

  const service = getAdminClient();

  const { data: pluginCatalog, error: pluginCatalogError } = (await service
    .from("plugins")
    .select("key, visibility, is_active, latest_version")
    .eq("key", pluginKey)
    .maybeSingle()) as {
    data: PluginCatalogVisibilityRow | null;
    error: SupabaseLikeError | null;
  };

  if (pluginCatalogError) {
    return {
      success: false,
      error: `Failed to validate plugin catalog entry: ${pluginCatalogError.message}`,
    };
  }

  if (!pluginCatalog || !pluginCatalog.is_active) {
    return {
      success: false,
      error: "Plugin key is missing or inactive in the catalog.",
    };
  }

  if (pluginCatalog.visibility !== "private") {
    return {
      success: false,
      error:
        "Bulk entitlement assignment is only needed for private plugins.",
    };
  }

  const idTokens = identifiers.filter((identifier) => UUID_REGEX.test(identifier));
  const usernameTokens = identifiers
    .filter((identifier) => !UUID_REGEX.test(identifier))
    .map((identifier) => identifier.toLowerCase());

  const resolvedOrganizationsById = new Map<
    string,
    { id: string; username: string | null }
  >();

  if (idTokens.length > 0) {
    const { data: byIdRows, error: byIdError } = await service
      .from("organizations")
      .select("id, username")
      .in("id", idTokens);

    if (byIdError) {
      return {
        success: false,
        error: `Failed to resolve organization IDs: ${byIdError.message}`,
      };
    }

    for (const row of byIdRows ?? []) {
      resolvedOrganizationsById.set(row.id, {
        id: row.id,
        username: row.username,
      });
    }
  }

  if (usernameTokens.length > 0) {
    const { data: byUsernameRows, error: byUsernameError } = await service
      .from("organizations")
      .select("id, username")
      .in("username", usernameTokens);

    if (byUsernameError) {
      return {
        success: false,
        error: `Failed to resolve organization usernames: ${byUsernameError.message}`,
      };
    }

    for (const row of byUsernameRows ?? []) {
      resolvedOrganizationsById.set(row.id, {
        id: row.id,
        username: row.username,
      });
    }
  }

  const resolvedIdSet = new Set(
    Array.from(resolvedOrganizationsById.values()).map((organization) => organization.id),
  );
  const resolvedUsernameSet = new Set(
    Array.from(resolvedOrganizationsById.values())
      .map((organization) => organization.username?.toLowerCase())
      .filter((username): username is string => Boolean(username)),
  );

  const unmatchedIdentifiers = identifiers.filter((identifier) => {
    if (UUID_REGEX.test(identifier)) {
      return !resolvedIdSet.has(identifier);
    }

    return !resolvedUsernameSet.has(identifier.toLowerCase());
  });

  if (resolvedOrganizationsById.size === 0) {
    return {
      success: false,
      error:
        "None of the provided organization identifiers matched existing organizations.",
      unmatchedIdentifiers,
    };
  }

  const now = new Date().toISOString();
  const entitlementRows = Array.from(resolvedOrganizationsById.values()).map(
    (organization) => ({
      organization_id: organization.id,
      plugin_key: pluginKey,
      status: input.status,
      starts_at: dateWindow.startsAt,
      ends_at: dateWindow.endsAt,
      is_forced: input.isForced ?? false,
      updated_at: now,
    }),
  );

  const { error: upsertError } = await service
    .from("organization_plugin_entitlements")
    .upsert(entitlementRows, { onConflict: "organization_id,plugin_key" });

  if (upsertError) {
    return {
      success: false,
      error: `Failed to upsert entitlements: ${upsertError.message}`,
    };
  }

  for (const organization of resolvedOrganizationsById.values()) {
    const slug = organization.username || organization.id;
    revalidatePath(`/organization/${slug}`);
    revalidatePath(`/organization/${slug}/settings`);
  }

  revalidatePath("/admin/plugins");

  const message =
    unmatchedIdentifiers.length > 0
      ? `Updated ${resolvedOrganizationsById.size} entitlement(s). ${unmatchedIdentifiers.length} identifier(s) were not found.`
      : `Updated ${resolvedOrganizationsById.size} entitlement(s).`;

  return {
    success: true,
    message,
    updatedCount: resolvedOrganizationsById.size,
    unmatchedIdentifiers,
  };
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
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const service = getAdminClient();
  const shouldActivateEntitlement = input.activateEntitlementForPrivate !== false;
  let entitlementCompensation: ForceInstallEntitlementCompensation | null = null;

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
      const { data: existingEntitlement, error: entitlementLookupError } = await service
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

      const previous = existingEntitlement as ForceInstallEntitlementSnapshot | null;
      if (!previous) {
        const activationUpdatedAt = new Date().toISOString();
        const { data: createdEntitlement, error: entitlementError } = await service
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
        const { data: reactivatedEntitlement, error: entitlementError } = await service
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
        compensationError = error?.message ?? "created entitlement changed concurrently";
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
        compensationError = error?.message ?? "reactivated entitlement changed concurrently";
      }
    }

    return {
      success: false,
      error: [
        transitionResult.error ?? "Failed to force install plugin.",
        compensationError
          ? `Private entitlement rollback also failed: ${compensationError}.`
          : null,
      ].filter(Boolean).join(" "),
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
      error: transitionResult.error ?? "Failed to disable organization install.",
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
      const fieldPath = firstError?.path && firstError.path !== "/"
        ? firstError.path
        : "root";
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
      error: transitionResult.error ?? "Failed to update install configuration.",
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
