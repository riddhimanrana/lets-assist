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

export async function signUpForProject(projectId: string, scheduleId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "You must be logged in to sign up for a project" };
    }

    // Add your signup logic here
    // This is just a placeholder, implement according to your needs
    const { error } = await supabase.from("project_signups").insert({
      project_id: projectId,
      user_id: user.id,
      schedule_id: scheduleId,
      status: "pending",
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error signing up for project:", error);
    return { error: "Failed to sign up for project" };
  }
}
