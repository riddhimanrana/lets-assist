import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  hasActiveOrganizationAdminMembership,
  type OrganizationMembershipQueryClient,
} from "@/lib/organization/active-membership";
import type { OrganizationPluginAdminSetting } from "@/types";

export type PluginCatalogRow = {
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

export type PluginEntitlementRow = {
  plugin_key: string;
  status: "active" | "inactive";
  starts_at: string | null;
  ends_at: string | null;
  is_forced: boolean;
};

export type PluginInstallRow = {
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
  configuration: Record<string, unknown> | null;
};

export type PluginAccessRow = {
  plugin_key: string;
  enabled: boolean;
  installed_version: string | null;
  configuration: Record<string, unknown> | null;
  install_created_at: string | null;
  entitlement_status: "active" | "inactive" | null;
  entitlement_starts_at: string | null;
  entitlement_ends_at: string | null;
  entitlement_is_forced: boolean | null;
};

export type SupabaseLikeError = {
  code?: string;
  message?: string;
};

export type OrganizationPluginSettingsResult = {
  plugins: OrganizationPluginAdminSetting[];
  warning?: string;
  error?: string;
};

export function isMissingPluginTableError(
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

export function isPlainObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function isOrganizationAdminForSettings(
  organizationId: string,
  userId: string,
  client?: OrganizationMembershipQueryClient,
): Promise<boolean> {
  const supabase = client ?? (await createClient());
  return hasActiveOrganizationAdminMembership(supabase, organizationId, userId);
}
