"use server";

import { createClient } from "@/utils/supabase/server";
import { canCancelProject, getProjectStatus, isProjectVisible } from "@/utils/project";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/types";
import { type Profile, type Project } from "@/types";
import { cookies } from "next/headers";

import { type AnonymousSignupData, type ProjectSignup, type SignupStatus } from "@/types";
import { NotificationService } from "@/services/notifications";

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

async function getSlotDetails(project: Project, scheduleId: string) {
  if (project.event_type === "oneTime") {
    return project.schedule.oneTime;
  } else if (project.event_type === "multiDay") {
    const [date, slotIndex] = scheduleId.split("-");
    const day = project.schedule.multiDay?.find(d => d.date === date);
    if (day && slotIndex !== undefined) {
      const slotIdx = parseInt(slotIndex, 10);
      if (!isNaN(slotIdx) && day.slots.length > slotIdx) {
        return day.slots[slotIdx];
      }
    }
  } else if (project.event_type === "sameDayMultiArea") {
    const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === scheduleId);
    return role;
  }
  return null;
}

async function getCurrentSignups(projectId: string, scheduleId: string): Promise<number> {
  const supabase = await createClient();
  
  const { count } = await supabase
    .from("project_signups")
    .select("*", { count: 'exact', head: true })
    .eq("project_id", projectId)
    .eq("schedule_id", scheduleId)
    .eq("status", "confirmed");
    
  return count || 0;
}

export async function signUpForProject(
  projectId: string,
  scheduleId: string,
  anonymousData?: AnonymousSignupData
) {
  const supabase = await createClient();

  try {
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

    // Get slot details and validate capacity
    const slotDetails = await getSlotDetails(project, scheduleId);
    if (!slotDetails) {
      return { error: "Invalid schedule slot" };
    }

    // Check if slot is full
    const currentSignups = await getCurrentSignups(projectId, scheduleId);
    if (currentSignups >= slotDetails.volunteers) {
      return { error: "This slot is full" };
    }

    // Handle user authentication
    const { data: { user } } = await supabase.auth.getUser();

    // If project requires login but user isn't logged in
    if (project.require_login && !user) {
      return { error: "You must be logged in to sign up for this project" };
    }

    // Check for existing signup
    if (user) {
      const { data: existingSignup } = await supabase
        .from("project_signups")
        .select("id")
        .eq("project_id", projectId)
        .eq("schedule_id", scheduleId)
        .eq("user_id", user.id)
        .eq("status", "confirmed")
        .maybeSingle();

      if (existingSignup) {
        return { error: "You have already signed up for this slot" };
      }
    }

    // Create signup record
    const signupData: Omit<ProjectSignup, "id" | "created_at"> = {
      project_id: projectId,
      schedule_id: scheduleId,
      user_id: user?.id,
      status: "confirmed",
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

    // // Send notification to project creator
    // const signerName = user 
    //   ? (await getCreatorProfile(user.id))?.profile?.full_name || "A user"
    //   : anonymousData?.name || "An anonymous user";

    // let scheduleDetails = "";
    // if (project.event_type === "oneTime" && project.schedule.oneTime) {
    //   const date = new Date(project.schedule.oneTime.date);
    //   const formattedDate = date.toLocaleDateString('en-US', { 
    //     month: 'long', 
    //     day: 'numeric',
    //     year: 'numeric'
    //   });
    //   const formattedTime = `${project.schedule.oneTime.startTime} - ${project.schedule.oneTime.endTime}`;
    //   scheduleDetails = ` for ${formattedDate} at ${formattedTime}`;
    // }

    // await NotificationService.createNotification({
    //   title: "New Volunteer Signup",
    //   body: `${signerName} has signed up for your project "${project.title}"${scheduleDetails}`,
    //   type: "project_updates",
    //   severity: "success",
    //   actionUrl: `/projects/${projectId}/signups`,
    //   data: { projectId }
    // }, project.creator_id);

    return { success: true };
  } catch (error) {
    console.error("Error in signUpForProject:", error);
    return { error: "An unexpected error occurred" };
  }
}

interface NotificationResult {
  success?: boolean;
  error?: string;
}

export async function createRejectionNotification(
  userId: string,
  projectId: string,
  signupId: string
): Promise<NotificationResult> {
  "use server";
  const supabase = await createClient();
  
  try {
    // Fetch the project title before creating the notification
    const { data: projectData, error: projectFetchError } = await supabase
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .single();

    if (projectFetchError || !projectData) {
      throw new Error("Failed to fetch project title");
    }

    const projectTitle = projectData.title;

    // Create notification directly
    await NotificationService.createNotification({
      title: "Project Status Update",
      body: `Your signup to volunteer for "${projectTitle}" has been rejected`,
      type: "project_updates",
      severity: "warning",
      actionUrl: `/projects/${projectId}`,
      data: { projectId, signupId }
    }, userId);

    return { success: true };
  } catch (error) {
    console.error("Server notification error:", error);
    return { error: "Failed to send notification" };
  }
}

export async function cancelSignup(signupId: string) {
  const supabase = await createClient();
  
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    // Get signup details
    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("*")
      .eq("id", signupId)
      .single();
      
    if (signupError || !signup) {
      return { error: "Signup not found" };
    }
    
    // Verify user has permission (is the user who signed up or project creator)
    if (user?.id !== signup.user_id) {
      const { data: project } = await supabase
        .from("projects")
        .select("creator_id, organization_id")
        .eq("id", signup.project_id)
        .single();
        
      const isCreator = project?.creator_id === user?.id;
      
      if (!isCreator && project?.organization_id) {
        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", project.organization_id)
          .eq("user_id", user?.id)
          .single();
          
        if (!orgMember || !["admin", "staff"].includes(orgMember.role)) {
          return { error: "You don't have permission to cancel this signup" };
        }
      } else if (!isCreator) {
        return { error: "You don't have permission to cancel this signup" };
      }
    }
    
    // Update signup status
    const { error: updateError } = await supabase
      .from("project_signups")
      .update({ status: "cancelled" as SignupStatus })
      .eq("id", signupId);
      
    if (updateError) {
      throw updateError;
    }
    
    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    
    return { success: true };
  } catch (error) {
    console.error("Error cancelling signup:", error);
    return { error: "Failed to cancel signup" };
  }
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

