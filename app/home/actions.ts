"use server";
import { createClient } from "@/utils/supabase/server";
import type { Project } from "@/types";

// Define the Profile type with an id property
export type Profile = {
  id: string;
  avatar_url: string | null;
  full_name: string | null;
  username: string | null;
};

export async function getActiveProjects(limit: number = 20, offset: number = 0): Promise<Project[]> {
  const supabase = await createClient();

  // Limit and offset are applied so we don't fetch all projects at once.
  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .eq("status", "active")
    .range(offset, offset + limit - 1);

  if (error || !projects) {
    console.error("Error fetching projects:", error);
    return [];
  }

  // Extract unique creator IDs from the projects
  const creatorIds = Array.from(new Set(projects.map((p: any) => p.creator_id)));

  // Fetch corresponding profiles
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, avatar_url, full_name, username")
    .in("id", creatorIds);

  if (profilesError) {
    console.error("Error fetching profiles:", profilesError);
    // Return projects even if profile fetch fails
    return projects;
  }

  // Create a map of profiles keyed by id
  const profilesMap = (profiles as Profile[]).reduce<Record<string, Profile>>((acc, profile) => {
    acc[profile.id] = profile;
    return acc;
  }, {});

  // Merge profile data into each project using creator_id
  return projects.map((project: any) => ({
    ...project,
    profiles: profilesMap[project.creator_id] || null,
  })) as Project[];
}
