"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { isProjectVisible } from "@/utils/project";
import { type Project } from "@/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { getProjectCreatorProfileById } from "@/lib/profile/public";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";
import { isMissingWaiverDisableEsignatureColumnError } from "./shared";

export async function isProjectCreator(projectId: string) {
  "use server";
  try {
    const supabase = await createClient();

    // Get current user using getClaims() for better performance
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return false;
    }

    // Check project ownership
    const { data: project } = await supabase
      .from("projects")
      .select("creator_id")
      .eq("id", projectId)
      .single();

    return project?.creator_id === user.id;
  } catch {
    return false;
  }
}

export type ManageableProjectRecord = {
  creator_id?: string | null;
  organization_id?: string | null;
  organization?: { id?: string | null } | null;
  can_be_managed_by_staff?: boolean | null;
};

export type CurrentUserProjectPermissions = {
  userId: string | null;
  isCreator: boolean;
  isOrgAdmin: boolean;
  canManageProject: boolean;
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
    organizationRole: activeOrganizationRole(membership),
    canBeManagedByStaff: project.can_be_managed_by_staff,
  });
}

export async function getCurrentUserProjectPermissions(
  projectId: string,
): Promise<CurrentUserProjectPermissions> {
  "use server";
  try {
    const supabase = await createClient();
    const { user, error: userError } = await getAuthUser();

    if (userError || !user) {
      return {
        userId: null,
        isCreator: false,
        isOrgAdmin: false,
        canManageProject: false,
      };
    }

    const { data: project } = await supabase
      .from("projects")
      .select("creator_id, organization_id, can_be_managed_by_staff")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) {
      return {
        userId: user.id,
        isCreator: false,
        isOrgAdmin: false,
        canManageProject: false,
      };
    }

    const isCreator = project.creator_id === user.id;
    const canManageProject = await canUserManageProject(
      supabase,
      project,
      user.id,
    );

    // Check if they are an admin specifically (for other UI purposes)
    const orgId = project.organization_id;
    let isOrgAdmin = false;
    if (orgId && !isCreator) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("role, status")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .single();
      isOrgAdmin = activeOrganizationRole(membership) === "admin";
    }

    return {
      userId: user.id,
      isCreator,
      isOrgAdmin,
      canManageProject,
    };
  } catch {
    return {
      userId: null,
      isCreator: false,
      isOrgAdmin: false,
      canManageProject: false,
    };
  }
}

export async function canCurrentUserManageProject(projectId: string) {
  "use server";
  const permissions = await getCurrentUserProjectPermissions(projectId);
  return permissions.canManageProject;
}

export async function getProject(projectId: string) {
  "use server";
  const supabase = await createClient();

  // Get the current user if logged in using getClaims() for better performance
  const { user } = await getAuthUser();

  // Fetch the project
  const { data: project, error } = (await supabase
    .from("projects")
    .select(
      `
      *,
      organization:organizations (
        id,
        name,
        username,
        logo_url,
        verified,
        type,
        allowed_email_domains
      )
    `,
    )
    .eq("id", projectId)
    .single()) as {
    data: Project | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error("Error fetching project:", JSON.stringify(error, null, 2));
    return { error: "Failed to fetch project" };
  }

  // Calculate and update the project status
  if (project) {
    if (project.workflow_status === "draft") {
      if (!user) {
        return { error: "unauthorized", project: null };
      }

      const canManageDraft = await canUserManageProject(
        supabase,
        project,
        user.id,
      );
      if (!canManageDraft) {
        return { error: "unauthorized", project: null };
      }
    }

    // Check if the project is organization-only and the user has permission to view it
    if (project.visibility === "organization_only") {
      // If it's an organization-only project, check user's organization memberships
      if (!user) {
        return { error: "unauthorized", project: null };
      }

      // Get user's organization memberships
      const { data: userOrgs } = (await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id)) as {
        data: { organization_id: string; role: string }[] | null;
        error: { message: string } | null;
      };

      // Check if user is a member of the project's organization
      const hasAccess = isProjectVisible(project, user.id, userOrgs || []);

      if (!hasAccess) {
        return { error: "unauthorized", project: null };
      }
    }
  }

  return { project };
}

export async function getCreatorProfile(userId: string) {
  "use server";
  const { data: profile, error } = await getProjectCreatorProfileById(userId);

  if (error) {
    console.error("Error fetching creator profile:", error);
    return { error: "Failed to fetch creator profile" };
  }

  return { profile };
}

// Get project-specific waiver or fall back to global waiver definition
export async function getProjectWaiver(projectId: string) {
  "use server";
  try {
    const supabase = await createClient();
    const serviceSupabase = getAdminClient();

    // Resolve the project through the request-scoped client first so public
    // callers cannot use the service role to inspect a project they cannot see.
    let { data: project, error: projectError } = await supabase
      .from("projects")
      .select(
        "waiver_required, waiver_allow_upload, waiver_disable_esignature, waiver_pdf_url, waiver_pdf_storage_path, waiver_definition_id",
      )
      .eq("id", projectId)
      .maybeSingle();

    if (
      projectError &&
      isMissingWaiverDisableEsignatureColumnError(projectError)
    ) {
      const fallbackResult = await supabase
        .from("projects")
        .select(
          "waiver_required, waiver_allow_upload, waiver_pdf_url, waiver_pdf_storage_path, waiver_definition_id",
        )
        .eq("id", projectId)
        .maybeSingle();

      projectError = fallbackResult.error;
      project = fallbackResult.data
        ? {
            ...fallbackResult.data,
            waiver_disable_esignature: false,
          }
        : null;
    }

    if (projectError) {
      console.error("Error fetching project waiver config:", projectError);
      return { error: "Failed to load project waiver configuration" };
    }

    if (!project) {
      return { error: "Project not found" };
    }

    // Phase 4: Check for Waiver Definition (New System)
    if (project.waiver_definition_id) {
      const { data: definition, error: defError } = await serviceSupabase
        .from("waiver_definitions")
        .select("*")
        .eq("id", project.waiver_definition_id)
        .eq("project_id", projectId)
        .single();

      if (!defError && definition) {
        return {
          waiverConfig: {
            waiverRequired: project.waiver_required ?? true,
            waiverAllowUpload: project.waiver_disable_esignature
              ? true
              : (project.waiver_allow_upload ?? true),
            waiverPdfUrl: definition.pdf_public_url || project.waiver_pdf_url, // Prefer definition PDF
            waiverPdfStoragePath: definition.pdf_storage_path,
            isProjectSpecific: true,
            isWaiverDefinition: true,
          },
          definition,
        };
      }
    }

    // If project has a custom waiver PDF, use that
    if (project.waiver_pdf_url) {
      return {
        waiverConfig: {
          waiverRequired: project.waiver_required ?? false,
          waiverAllowUpload: project.waiver_disable_esignature
            ? true
            : (project.waiver_allow_upload ?? true),
          waiverPdfUrl: project.waiver_pdf_url,
          waiverPdfStoragePath: project.waiver_pdf_storage_path,
          isProjectSpecific: true,
        },
        definition: null,
      };
    }

    // No global waiver fallback - projects must have custom waivers
    return {
      waiverConfig: {
        waiverRequired: project.waiver_required ?? true,
        waiverAllowUpload: project.waiver_disable_esignature
          ? true
          : (project.waiver_allow_upload ?? true),
        waiverPdfUrl: null,
        waiverPdfStoragePath: null,
        isProjectSpecific: false,
      },
      definition: null,
    };
  } catch (error) {
    console.error("Error fetching project waiver:", error);
    return { error: "Failed to load project waiver" };
  }
}
