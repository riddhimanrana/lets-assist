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
