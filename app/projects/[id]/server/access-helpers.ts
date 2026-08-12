import "server-only";

import { canManageProjectAccess } from "@/lib/projects/management-access";
import { createClient } from "@/lib/supabase/server";

export type ManageableProjectRecord = {
  creator_id?: string | null;
  organization_id?: string | null;
  organization?: { id?: string | null } | null;
  can_be_managed_by_staff?: boolean | null;
};

const getManageableProjectOrganizationId = (
  project?: ManageableProjectRecord | null,
) => project?.organization_id ?? project?.organization?.id ?? null;

export async function canUserManageProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  project: ManageableProjectRecord | null | undefined,
  userId: string,
) {
  if (!project) return false;

  const orgId = getManageableProjectOrganizationId(project);
  if (project.creator_id === userId || !orgId) {
    return canManageProjectAccess({
      creatorId: project.creator_id ?? null,
      userId,
      canBeManagedByStaff: project.can_be_managed_by_staff,
    });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) return false;

  return canManageProjectAccess({
    creatorId: project.creator_id ?? null,
    userId,
    organizationRole:
      (membership?.status ?? "active") === "active" ? membership?.role : null,
    canBeManagedByStaff: project.can_be_managed_by_staff,
  });
}
