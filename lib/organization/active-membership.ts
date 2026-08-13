import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrganizationPluginAccessRole } from "@/types";

export type OrganizationMembershipQueryClient = Pick<SupabaseClient, "from">;

export async function getActiveOrganizationMembershipRole(
  client: OrganizationMembershipQueryClient,
  organizationId: string,
  userId: string,
): Promise<OrganizationPluginAccessRole | null> {
  const { data, error } = await client
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) return null;
  if (
    data?.role === "admin" ||
    data?.role === "staff" ||
    data?.role === "member"
  ) {
    return data.role;
  }
  return null;
}

export async function hasActiveOrganizationAdminMembership(
  client: OrganizationMembershipQueryClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  return (
    (await getActiveOrganizationMembershipRole(
      client,
      organizationId,
      userId,
    )) === "admin"
  );
}
