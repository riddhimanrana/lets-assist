"use server";

import { createClient } from "@/utils/supabase/server";
import { type Profile, type Project } from "@/types";

export async function getProject(
  id: string,
): Promise<{ project: Project | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // Fetch project data
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (projectError) {
      throw projectError;
    }

    return { project: project as Project, error: null };
  } catch (error) {
    // console.error('Error fetching project:', error)
    return { project: null, error: "Failed to fetch project" };
  }
}

export async function getCreatorProfile(
  creatorId: string,
): Promise<{ profile: Profile | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // Fetch creator profile data with created_at
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, username, created_at")
      .eq("id", creatorId)
      .single();

    if (profileError) {
      throw profileError;
    }

    return { profile: profile as Profile, error: null };
  } catch (error) {
    console.error("Error fetching creator profile:", error);
    return { profile: null, error: "Failed to fetch creator profile" };
  }
}

export async function signUpForProject(
  projectId: string, 
  scheduleId: string,
  anonymousData?: { 
    name: string;
    email?: string;
    phone?: string;
  }
) {
  try {
    const supabase = await createClient();
    
    // First, check if the project requires login
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("require_login")
      .eq("id", projectId)
      .single();
    
    if (projectError) {
      throw projectError;
    }
    
    // Get current user if available
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    
    // If project requires login and user is not logged in, return an error
    if (project.require_login && (!user || userError)) {
      return { error: "This project requires an account to sign up" };
    }
    
    // For anonymous signup (no user but project allows it)
    const userId = user?.id || null;
    const isAnonymous = !userId;

    // Make sure anonymous users provided their name
    if (isAnonymous && (!anonymousData || !anonymousData.name)) {
      return { error: "Please provide your name to sign up" };
    }
    
    // Add signup to database
    const { error } = await supabase.from("project_signups").insert({
      project_id: projectId,
      user_id: userId,
      schedule_id: scheduleId,
      status: "pending",
      is_anonymous: isAnonymous,
      // Include anonymous user data if provided
      anonymous_name: isAnonymous ? anonymousData?.name : null,
      anonymous_email: isAnonymous ? anonymousData?.email : null,
      anonymous_phone: isAnonymous ? anonymousData?.phone : null,
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error signing up for project:", error);
    return { error: "Failed to sign up for project" };
  }
}

export async function deleteProject(projectId: string) {
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

    // Delete project files first
    const { data: projectData } = await supabase
      .from("projects")
      .select("cover_image_url, documents")
      .eq("id", projectId)
      .single();

    if (projectData) {
      // Delete cover image if it exists
      if (projectData.cover_image_url?.includes("supabase.co")) {
        try {
          const urlParts = new URL(projectData.cover_image_url);
          const pathParts = urlParts.pathname.split("/");
          const fileName = pathParts[pathParts.length - 1];
          if (fileName) {
            await supabase.storage.from("project-images").remove([fileName]);
          }
        } catch (error) {
          console.error("Error deleting cover image:", error);
        }
      }

      // Delete documents if they exist
      if (projectData.documents?.length > 0) {
        try {
          const fileNames = projectData.documents.map((doc: any) => {
            const urlParts = new URL(doc.url);
            const pathParts = urlParts.pathname.split("/");
            return pathParts[pathParts.length - 1];
          });
          await supabase.storage.from("project-documents").remove(fileNames);
        } catch (error) {
          console.error("Error deleting documents:", error);
        }
      }
    }

    // Delete project signups
    await supabase
      .from("project_signups")
      .delete()
      .eq("project_id", projectId);

    // Finally delete the project
    const { error: deleteError } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);

    if (deleteError) throw deleteError;

    return { success: true };
  } catch (error) {
    console.error("Error deleting project:", error);
    return { error: "Failed to delete project" };
  }
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
