"use server";

import { createClient } from "@/utils/supabase/server";
import { canCancelProject, getProjectStatus, isProjectVisible } from "@/utils/project";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/types";
import { type Profile, type Project } from "@/types";

interface AnonymousSignup {
  name: string;
  email?: string;
  phone?: string;
}

export async function getProject(projectId: string) {
  const supabase = await createClient();
  
  // Get the current user if logged in
  const { data: { user } } = await supabase.auth.getUser();
  
  // Fetch the project
  const { data: project, error } = await supabase
    .from("projects")
    .select(`
      *,
      organization:organizations (
        id,
        name,
        username,
        logo_url,
        verified,
        type
      )
    `)
    .eq("id", projectId)
    .single();
  
  if (error) {
    console.error("Error fetching project:", error);
    return { error: "Failed to fetch project" };
  }
  
  // Calculate and update the project status
  if (project) {
    project.status = getProjectStatus(project);

    // Check if the project is private and the user has permission to view it
    if (project.is_private) {
      // If it's a private project, check user's organization memberships
      if (!user) {
        return { error: "unauthorized", project: null };
      }
      
      // Get user's organization memberships
      const { data: userOrgs } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id);
      
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
  const supabase = await createClient();
  
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Error fetching creator profile:", error);
    return { error: "Failed to fetch creator profile" };
  }

  return { profile };
}

export async function signUpForProject(
  projectId: string,
  scheduleId: string,
  anonymousData?: AnonymousSignup
) {
  const supabase = await createClient();

  // Get project details
  const { project, error: projectError } = await getProject(projectId);

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  // Check if project is available for signup
  if (project.status === "cancelled") {
    return { error: "This project has been cancelled" };
  }

  if (project.status === "completed") {
    return { error: "This project has been completed" };
  }

  // Handle user authentication
  const { data: { user } } = await supabase.auth.getUser();

  // If project requires login but user isn't logged in
  if (project.require_login && !user) {
    return { error: "You must be logged in to sign up for this project" };
  }

  // Create signup record
  const signupData = {
    project_id: projectId,
    schedule_id: scheduleId,
    user_id: user?.id,
    status: "confirmed" as const,
    ...(anonymousData && {
      anonymous_name: anonymousData.name,
      anonymous_email: anonymousData.email,
      anonymous_phone: anonymousData.phone,
    }),
  };

  const { error: signupError } = await supabase
    .from("project_signups")
    .insert(signupData);

  if (signupError) {
    console.error("Error creating signup:", signupError);
    if (signupError.code === "23505") { // Unique constraint violation
      return { error: "You have already signed up for this slot" };
    }
    return { error: "Failed to sign up. Please try again." };
  }

  // Revalidate paths
  revalidatePath(`/projects/${projectId}`);
  if (project.organization_id) {
    revalidatePath(`/organization/${project.organization_id}`);
  }
  if (user) {
    revalidatePath(`/profile/${user.id}`);
  }

  return { success: true };
}

export async function updateProjectStatus(
  projectId: string, 
  newStatus: ProjectStatus,
  cancellationReason?: string
) {
  const supabase = await createClient();
  
  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) {
    return { error: "You must be logged in to update project status" };
  }

  // Verify user has permission to update the project
  const { project, error: projectError } = await getProject(projectId);

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  // Check if user has permission
  let hasPermission = project.creator_id === user.id;
  if (project.organization && !hasPermission) {
    const { data: orgMember } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization.id)
      .eq("user_id", user.id)
      .single();

    if (orgMember?.role) {
      hasPermission = ["admin", "staff"].includes(orgMember.role);
    }
  }

  if (!hasPermission) {
    return { error: "You don't have permission to update this project" };
  }

  // If cancelling, validate cancellation is allowed
  if (newStatus === "cancelled") {
    if (!canCancelProject(project)) {
      return { error: "Project can only be cancelled within 24 hours of start time" };
    }
    if (!cancellationReason) {
      return { error: "Cancellation reason is required" };
    }
  }

  // Update project status
  const updateData: any = { status: newStatus };
  if (newStatus === "cancelled") {
    updateData.cancelled_at = new Date().toISOString();
    updateData.cancellation_reason = cancellationReason;
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update(updateData)
    .eq("id", projectId);

  if (updateError) {
    console.error("Error updating project status:", updateError);
    return { error: "Failed to update project status" };
  }

  // Revalidate project pages
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/organization/${project.organization?.id}`);
  revalidatePath('/home');

  return { success: true };
}

export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  
  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) {
    return { error: "You must be logged in to delete a project" };
  }

  // Verify user has permission to delete the project
  const { project, error: projectError } = await getProject(projectId);

  if (!project || projectError) {
    return { error: "Project not found" };
  }

  // Check if user has permission
  let hasPermission = project.creator_id === user.id;
  if (project.organization && !hasPermission) {
    const { data: orgMember } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", project.organization.id)
      .eq("user_id", user.id)
      .single();

    if (orgMember?.role) {
      hasPermission = orgMember.role === "admin"; // Only admins can delete projects
    }
  }

  if (!hasPermission) {
    return { error: "You don't have permission to delete this project" };
  }

  // Delete project documents from storage if they exist
  if (project.documents?.length > 0) {
    const { data: storageData, error: storageError } = await supabase.storage
      .from('project-documents')
      .list();

    if (storageData) {
      const projectFiles = storageData.filter(file => 
        file.name.startsWith(`project_${projectId}`)
      );

      if (projectFiles.length > 0) {
        await supabase.storage
          .from('project-documents')
          .remove(projectFiles.map(file => file.name));
      }
    }
  }

  // Delete cover image if it exists
  if (project.cover_image_url) {
    const fileName = project.cover_image_url.split('/').pop();
    if (fileName) {
      await supabase.storage
        .from('project-images')
        .remove([fileName]);
    }
  }

  // Delete project from database
  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (deleteError) {
    console.error("Error deleting project:", deleteError);
    return { error: "Failed to delete project" };
  }

  // Revalidate paths
  revalidatePath('/home');
  if (project.organization) {
    revalidatePath(`/organization/${project.organization.id}`);
  }

  return { success: true };
}

export async function updateProject(projectId: string, updates: Partial<Project>) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { error: "Unauthorized" };
    }

    // Verify project ownership
    const { data: project } = await supabase
      .from("projects")
      .select("creator_id")
      .eq("id", projectId)
      .single();

    if (!project || project.creator_id !== user.id) {
      return { error: "Unauthorized" };
    }

    // Update the project
    const { error: updateError } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", projectId);

    if (updateError) throw updateError;

    return { success: true };
  } catch (error) {
    console.error("Error updating project:", error);
    return { error: "Failed to update project" };
  }
}

export async function isProjectCreator(projectId: string) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
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
  } catch (error) {
    return false;
  }
}