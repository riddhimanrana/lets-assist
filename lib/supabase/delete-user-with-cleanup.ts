import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteUserWithCleanupOptions = {
  deleteProjects?: boolean;
  deleteOrganizations?: boolean;
  dryRun?: boolean;
};

export type DeleteUserCleanupReport = {
  userId: string;
  blockedBySoleAdminOrgs: Array<{ organization_id: string; organization_name: string | null }>;
  deletedCounts: Record<string, number>;
  skipped: string[];
  notes: string[];
};

/**
 * Delete a user and their associated data from Supabase.
 *
 * This function follows Supabase's recommended approach:
 * 1. Delete user data from public tables
 * 2. Call auth.admin.deleteUser() which automatically cleans up auth schema tables
 *
 * Reference: https://supabase.com/docs/guides/auth/managing-user-data#self-deletion
 */
export async function deleteUserWithCleanup(
  supabaseAdmin: SupabaseClient,
  userId: string,
  options: DeleteUserWithCleanupOptions = {},
): Promise<DeleteUserCleanupReport> {
  const { deleteProjects = true, deleteOrganizations = false, dryRun = false } = options;
  const deletedCounts: Record<string, number> = {};
  const skipped: string[] = [];
  const notes: string[] = [];

  // Check if user is sole admin of any organizations
  const blockedOrgs = await findSoleAdminOrgs(supabaseAdmin, userId);
  if (blockedOrgs.length > 0) {
    notes.push("User is the only admin in one or more organizations.");
    return {
      userId,
      blockedBySoleAdminOrgs: blockedOrgs,
      deletedCounts,
      skipped,
      notes,
    };
  }

  if (!dryRun) {
    // Delete user data from public tables (respecting foreign key constraints)
    const deletionSteps = [
      { table: "content_reports", where: { reporter_id: userId } },
      { table: "feedback", where: { user_id: userId } },
      { table: "notifications", where: { user_id: userId } },
      { table: "notification_settings", where: { user_id: userId } },
      { table: "user_calendar_connections", where: { user_id: userId } },
      { table: "user_emails", where: { user_id: userId } },
      { table: "trusted_member", where: { user_id: userId } },
      { table: "certificates", where: { user_id: userId } },
      { table: "project_signups", where: { user_id: userId } },
    ];

    if (deleteProjects) {
      // Projects - delete those created by the user
      const { error: projectError } = await supabaseAdmin
        .from("projects")
        .delete()
        .eq("creator_id", userId);

      if (projectError) {
        throw new Error(`Failed to delete projects: ${projectError.message}`);
      }
      deletedCounts["projects"] = 0; // Count not available via this method
    }

    if (deleteOrganizations) {
      // Organizations - delete those created by the user
      const { error: orgError } = await supabaseAdmin
        .from("organizations")
        .delete()
        .eq("created_by", userId);

      if (orgError) {
        throw new Error(`Failed to delete organizations: ${orgError.message}`);
      }
      deletedCounts["organizations"] = 0; // Count not available via this method
    }

    // Delete from other tables
    for (const step of deletionSteps) {
      let query = supabaseAdmin.from(step.table).delete();

      // Apply the where conditions
      for (const [key, value] of Object.entries(step.where)) {
        query = query.eq(key, value);
      }

      const { error } = await query;

      if (error) {
        throw new Error(`Failed to delete from ${step.table}: ${error.message}`);
      } else {
        deletedCounts[step.table] = 0; // Count not available via this method
      }
    }

    // Delete organization memberships
    const { error: membershipError } = await supabaseAdmin
      .from("organization_members")
      .delete()
      .eq("user_id", userId);

    if (membershipError) {
      throw new Error(`Failed to delete organization memberships: ${membershipError.message}`);
    }
    deletedCounts["organization_members"] = 0; // Count not available via this method

    // Delete the user profile (cascade delete will handle related data)
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      throw new Error(`Failed to delete profile: ${profileError.message}`);
    }
    deletedCounts["profiles"] = 0; // Count not available via this method

    // Finally, delete the user account from auth
    // This automatically cleans up all auth schema tables (sessions, mfa_factors, identities, etc.)
    if (!supabaseAdmin.auth?.admin?.deleteUser) {
      throw new Error("Supabase admin client is missing auth.admin.deleteUser");
    }

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      throw new Error(`Failed to delete auth user: ${authError.message}`);
    }
    notes.push("User deleted from auth system (all sessions and auth data automatically cleaned up)");
  } else {
    skipped.push("(dry run - no deletions performed)");
  }

  return {
    userId,
    blockedBySoleAdminOrgs: [],
    deletedCounts,
    skipped,
    notes,
  };
}

/**
 * Find organizations where the user is the sole admin.
 * Users cannot be deleted if they're the only admin in any organization.
 */
async function findSoleAdminOrgs(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<Array<{ organization_id: string; organization_name: string | null }>> {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "admin");

  if (membershipError) {
    throw new Error(`Failed to fetch organization memberships: ${membershipError.message}`);
  }

  const orgIds = (memberships ?? [])
    .map((row) => row.organization_id)
    .filter((id): id is string => Boolean(id));

  if (orgIds.length === 0) {
    return [];
  }

  const { data: organizations, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id,name")
    .in("id", orgIds);

  if (orgError) {
    throw new Error(`Failed to fetch organizations: ${orgError.message}`);
  }

  const results: Array<{ organization_id: string; organization_name: string | null }> = [];

  for (const org of organizations ?? []) {
    const { count, error: countError } = await supabaseAdmin
      .from("organization_members")
      .select("role", { count: "exact", head: true })
      .eq("organization_id", org.id)
      .eq("role", "admin");

    if (countError) {
      throw new Error(`Failed to count admins for org ${org.id}: ${countError.message}`);
    }

    if ((count ?? 0) <= 1) {
      results.push({ organization_id: org.id, organization_name: org.name ?? null });
    }
  }

  return results;
}
