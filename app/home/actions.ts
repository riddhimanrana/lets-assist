"use server";
import { createClient } from "@/utils/supabase/server";
import type { Project, ProjectStatus, Organization } from "@/types";
import { getProjectStatus } from "@/utils/project";

// Define the Profile type with an id property
export type Profile = {
  id: string;
  avatar_url: string | null;
  full_name: string | null;
  username: string | null;
  created_at: string;
};

export async function getActiveProjects(
  limit: number = 20, 
  offset: number = 0,
  status?: ProjectStatus,
  organizationId?: string
): Promise<Project[]> {
  const supabase = await createClient();

  // Get current user for visibility checks
  const { data: { user } } = await supabase.auth.getUser();

  // Build initial query
  let query = supabase
    .from("projects")
    .select("*");

  // Apply status filter if specified
  if (status) {
    query = query.eq("status", status);
  }

  // Apply organization filter if specified
  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  // Handle visibility
  if (!user) {
    // Non-logged in users can only see public projects
    query = query.eq("visibility", "public");
  } else {
    // Get user's organizations
    const { data: userOrgs } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id);

    const orgIds = userOrgs?.map(org => org.organization_id) || [];

    if (orgIds.length > 0) {
      // User can see public projects AND organization projects for orgs they belong to
      query = query.or(`visibility.eq.public,and(visibility.eq.organization,organization_id.in.(${orgIds.join(',')}))`);
    } else {
      // User can only see public projects if they don't belong to any organizations
      query = query.eq("visibility", "public");
    }
  }

  // Apply pagination
  query = query.range(offset, offset + limit - 1)
    .order("created_at", { ascending: false });

  const { data: projects, error } = await query;

  if (error || !projects) {
    console.error("Error fetching projects:", error);
    return [];
  }

  // Extract unique creator IDs and organization IDs from the projects
  const creatorIds = Array.from(new Set(projects.map(p => p.creator_id)));
  const orgIds = Array.from(new Set(projects.map(p => p.organization_id).filter(Boolean)));

  // Fetch corresponding profiles
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, avatar_url, full_name, username, created_at")
    .in("id", creatorIds);

  if (profilesError) {
    console.error("Error fetching profiles:", profilesError);
  }

  // Fetch organizations if needed
  let orgs: Organization[] = [];
  if (orgIds.length > 0) {
    const { data: organizations, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name, username, logo_url, verified, type")
      .in("id", orgIds);

    if (orgsError) {
      console.error("Error fetching organizations:", orgsError);
    } else {
      orgs = organizations;
    }
  }

  // Create maps for profiles and organizations
  const profilesMap = (profiles || []).reduce<Record<string, Profile>>((acc, profile) => {
    acc[profile.id] = profile;
    return acc;
  }, {});

  const orgsMap = orgs.reduce<Record<string, Organization>>((acc, org) => {
    acc[org.id] = org;
    return acc;
  }, {});

  // Merge profile and organization data into each project
  return projects.map(project => ({
    ...project,
    profiles: profilesMap[project.creator_id] || null,
    organization: project.organization_id ? orgsMap[project.organization_id] || null : null,
    status: getProjectStatus(project)
  }));
}

export async function getProjectsByStatus(
  organizationId: string,
  status?: ProjectStatus
): Promise<Project[]> {
  return getActiveProjects(100, 0, status, organizationId);
}
