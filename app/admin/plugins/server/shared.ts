import "server-only";

export type PluginCatalogControlRow = {
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

export type PluginEntitlementRow = {
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

export type PluginDataBoundaryRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string | null;
  plugin_key: string;
  boundary_status: "active" | "disabled" | "migration_pending" | "archived";
  data_schema: string;
  data_prefix: string | null;
  isolation_mode:
    "shared" | "dedicated_schema" | "dedicated_project" | "external";
  direct_client_access: "blocked" | "server_preferred" | "rls_allowed";
  updated_at: string;
};

export type PluginOrganizationOption = {
  id: string;
  name: string;
  username: string | null;
};

export type SupabaseLikeError = {
  code?: string;
  message?: string;
};

export type PluginInstallRow = {
  organization_id: string;
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
};

export type PluginAccessControlRow = {
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

export type PluginCatalogBaseRow = {
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

export type PluginCatalogVisibilityRow = {
  key: string;
  visibility: "global" | "private";
  is_active: boolean;
  latest_version: string;
};

export type EntitlementBaseRow = {
  id: string;
  organization_id: string;
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  is_forced: boolean;
  updated_at: string;
};

export type ForceInstallEntitlementSnapshot = {
  id: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

export type ForceInstallEntitlementCompensation =
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

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isMissingPluginSchemaError(
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

export function isEntitlementCurrentlyActive(
  entitlement: ForceInstallEntitlementSnapshot,
  now: Date,
) {
  if (entitlement.status !== "active") return false;
  if (entitlement.starts_at && new Date(entitlement.starts_at) > now)
    return false;
  if (entitlement.ends_at && new Date(entitlement.ends_at) < now) return false;
  return true;
}

export function normalizeVersionInput(value: string): string {
  const normalized = value.trim().replace(/^v/i, "");
  return normalized || "1.0.0";
}

export function parseOrganizationIdentifiers(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,;\s]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function normalizeOptionalIsoDate(
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

export function normalizeEntitlementDateWindow(input: {
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
