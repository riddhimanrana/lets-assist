"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  deactivateGoogleConnection,
  hasGoogleSheetsScopes,
  organizationSheetsGoogleBinding,
} from "@/services/calendar";
import { assertOrgAccess, getOrganizationSheetsConnection } from "./shared";

export async function unlinkSheetSync(
  organizationId: string,
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { data: existingSync, error: existingSyncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select("organization_id, created_by")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (existingSyncError) {
    console.error(
      "Failed to load sheet sync before unlink:",
      existingSyncError,
    );
    return { success: false, error: "Failed to verify sheet owner" };
  }

  if (!existingSync) {
    return { success: false, error: "Sheet sync not configured" };
  }

  if (existingSync.created_by && existingSync.created_by !== access.userId) {
    const { data: ownerProfile } = await serviceSupabase
      .from("profiles")
      .select("full_name, username, email")
      .eq("id", existingSync.created_by)
      .maybeSingle();

    const ownerLabel =
      ownerProfile?.full_name ||
      ownerProfile?.username ||
      ownerProfile?.email ||
      "the connected admin";

    return {
      success: false,
      error: `Sheets sync is currently managed by ${ownerLabel}. Ask them to disconnect it, or connect your Google account with Sheets access and take over first.`,
    };
  }

  const { error } = await serviceSupabase
    .from("organization_sheet_syncs")
    .delete()
    .eq("organization_id", organizationId);

  if (error) {
    console.error("Failed to unlink sheet sync:", error);
    return { success: false, error: "Failed to unlink sheet" };
  }

  return { success: true };
}

export async function disconnectOrganizationSheetConnection(
  organizationId: string,
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { data: existingSync, error: existingSyncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select("organization_id, created_by")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (existingSyncError) {
    console.error(
      "Failed to load sheet sync before disconnect:",
      existingSyncError,
    );
    return { success: false, error: "Failed to verify sheet owner" };
  }

  if (existingSync?.created_by && existingSync.created_by !== access.userId) {
    const { data: ownerProfile } = await serviceSupabase
      .from("profiles")
      .select("full_name, username, email")
      .eq("id", existingSync.created_by)
      .maybeSingle();

    const ownerLabel =
      ownerProfile?.full_name ||
      ownerProfile?.username ||
      ownerProfile?.email ||
      "the connected admin";

    return {
      success: false,
      error: `Sheets sync is currently managed by ${ownerLabel}. Only that Google account can be removed from the organization connection.`,
    };
  }

  const deactivateResult = await deactivateGoogleConnection(access.userId, {
    expectedBinding: organizationSheetsGoogleBinding(organizationId),
    useServiceRole: true,
    revokeAccess: false,
  });
  if (
    !deactivateResult.success &&
    deactivateResult.error !== "No active Google connection found"
  ) {
    return {
      success: false,
      error: deactivateResult.error || "Failed to disconnect Google account",
    };
  }

  if (existingSync) {
    const { error } = await serviceSupabase
      .from("organization_sheet_syncs")
      .delete()
      .eq("organization_id", organizationId);

    if (error) {
      console.error("Failed to remove organization sheet connection:", error);
      return { success: false, error: "Failed to disconnect Google account" };
    }
  }

  revalidatePath(`/organization/${organizationId}/settings`);
  return { success: true };
}

export async function getAvailableSheetOwners(organizationId: string): Promise<
  | { success: false; error: string }
  | {
      success: true;
      owners: Array<{
        id: string;
        name: string | null;
        email: string | null;
        role: string | null;
        connectedEmail: string | null;
        hasSheetsAccess: boolean;
      }>;
    }
> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error || "Authentication required" };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { data: members, error } = await serviceSupabase
    .from("organization_members")
    .select("user_id, role, profiles(id, full_name, username, email)")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (error || !members) {
    console.error("Failed to load organization members:", error);
    return { success: false, error: "Failed to load organization members" };
  }

  const eligibleMembers = members.filter(
    (member) => member.role === "admin" || member.role === "staff",
  ) as unknown as Array<{
    user_id: string;
    role: string;
    profiles: {
      id: string;
      full_name: string | null;
      username: string | null;
      email: string | null;
    } | null;
  }>;
  if (eligibleMembers.length === 0) {
    return { success: true, owners: [] };
  }

  const connectionEntries = await Promise.all(
    eligibleMembers.map(
      async (member) =>
        [
          member.user_id,
          await getOrganizationSheetsConnection(
            member.user_id,
            organizationId,
            true,
          ),
        ] as const,
    ),
  );
  const connectionMap = new Map(connectionEntries);

  const owners = eligibleMembers
    .map((member) => {
      const profile = member.profiles;
      const connection = connectionMap.get(member.user_id);
      const hasSheetsAccess = hasGoogleSheetsScopes(
        connection?.granted_scopes || null,
      );
      return {
        id: member.user_id,
        name: profile?.full_name || profile?.username || null,
        email: profile?.email || null,
        role: member.role,
        connectedEmail: connection?.calendar_email || null,
        hasSheetsAccess,
      };
    })
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "admin" ? -1 : 1));

  return { success: true, owners };
}

export async function updateSheetOwner(
  organizationId: string,
  ownerId: string,
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { data: syncConfig } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!syncConfig) {
    return { success: false, error: "Sheets sync is not configured" };
  }

  const ownerConnection = await getOrganizationSheetsConnection(
    ownerId,
    organizationId,
    true,
  );

  if (!hasGoogleSheetsScopes(ownerConnection?.granted_scopes || null)) {
    return {
      success: false,
      error: "Selected owner must reconnect with Sheets permissions",
    };
  }

  const { error } = await serviceSupabase
    .from("organization_sheet_syncs")
    .update({ created_by: ownerId, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId);

  if (error) {
    console.error("Failed to update sheet owner:", error);
    return { success: false, error: "Failed to update sheet owner" };
  }

  return { success: true };
}
