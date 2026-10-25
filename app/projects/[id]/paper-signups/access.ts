import "server-only";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";
import type { Project } from "@/types";

type PaperScanProject = Project & {
  organization_id: string | null;
  can_be_managed_by_staff: boolean | null;
  published: Record<string, boolean> | null;
};

type AccessResult =
  | {
      ok: true;
      userId: string;
      project: PaperScanProject;
      admin: ReturnType<typeof getAdminClient>;
    }
  | { ok: false; error: string };

/** Every action re-derives authorization; none trusts a client-supplied id. */
export async function requirePaperScanAccess(
  projectId: string,
): Promise<AccessResult> {
  const { user, error: authError } = await getAuthUser();
  if (authError || !user) {
    return { ok: false, error: "Authentication required." };
  }

  const admin = getAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select(
      "id, creator_id, organization_id, can_be_managed_by_staff, status, event_type, schedule, project_timezone, title, location, published, verification_method",
    )
    .eq("id", projectId)
    .single();
  if (projectError || !project) {
    return { ok: false, error: "Project not found." };
  }

  let organizationRole: string | null = null;
  if (project.organization_id && project.creator_id !== user.id) {
    const { data: membership } = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    organizationRole = activeOrganizationRole(membership);
  }

  if (
    !canManageProjectAccess({
      creatorId: project.creator_id,
      userId: user.id,
      organizationRole,
      canBeManagedByStaff: project.can_be_managed_by_staff ?? false,
    })
  ) {
    return { ok: false, error: "Not authorized to manage this project." };
  }

  return {
    ok: true,
    userId: user.id,
    project: project as unknown as PaperScanProject,
    admin,
  };
}
