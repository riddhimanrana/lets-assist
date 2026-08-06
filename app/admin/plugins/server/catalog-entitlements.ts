import "server-only";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { isPluginVersionBehind } from "@/lib/plugins/versioning";
import { checkSuperAdmin } from "@/app/admin/actions";
import {
  normalizeEntitlementDateWindow,
  normalizeVersionInput,
  parseOrganizationIdentifiers,
  UUID_REGEX,
  type PluginCatalogVisibilityRow,
  type SupabaseLikeError,
} from "./shared";

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
  "use server";
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
  const { error } = await service.from("plugins").upsert(
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
    return {
      success: false,
      error: `Failed to save plugin catalog control: ${error.message}`,
    };
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
  "use server";
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
    return {
      success: false,
      error: `Failed to save entitlement: ${error.message}`,
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
  "use server";
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const pluginKey = input.pluginKey.trim().toLowerCase();
  if (!pluginKey) {
    return { success: false, error: "Plugin key is required." };
  }

  const identifiers = parseOrganizationIdentifiers(
    input.organizationIdentifiers,
  );
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
      error: "Bulk entitlement assignment is only needed for private plugins.",
    };
  }

  const idTokens = identifiers.filter((identifier) =>
    UUID_REGEX.test(identifier),
  );
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
    Array.from(resolvedOrganizationsById.values()).map(
      (organization) => organization.id,
    ),
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
