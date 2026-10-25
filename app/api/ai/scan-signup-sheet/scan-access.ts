import { getAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";

export class ScanAccessError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? "Authentication required" : "Not authorized");
  }
}

export async function revalidateScanAccess(
  admin: ReturnType<typeof getAdminClient>,
  projectId: string,
  expectedUserId: string,
) {
  const { user, error } = await getAuthUser({ sensitive: true });
  if (error || !user) throw new ScanAccessError(401);
  if (user.id !== expectedUserId) throw new ScanAccessError(403);

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("creator_id, organization_id, can_be_managed_by_staff")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new Error("Could not revalidate scan access");
  if (!project) throw new ScanAccessError(403);

  let organizationRole: string | null = null;
  if (project.organization_id && project.creator_id !== user.id) {
    const { data: membership, error: membershipError } = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) throw new Error("Could not revalidate scan access");
    organizationRole = activeOrganizationRole(membership);
  }
  if (
    !canManageProjectAccess({
      creatorId: project.creator_id,
      userId: user.id,
      organizationRole,
      canBeManagedByStaff: project.can_be_managed_by_staff,
    })
  ) {
    throw new ScanAccessError(403);
  }
}
