"use server";
import { createClient } from "@/utils/supabase/server";
import type { Project, ProjectStatus, Organization, ProjectSignup } from "@/types";
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
  limit: number = 21, 
  offset: number = 0,
  status?: ProjectStatus,
  organizationId?: string
): Promise<Project[]> {
  const supabase = await createClient();

  // First get all projects
  let query = supabase
    .from("projects")
    .select(`
      *
    `);

  // Only show public projects in the public feed
  // Unlisted projects are accessible via direct link but not listed
  query = query.eq("visibility", "public");

  // Apply status filter if specified
  if (status) {
    query = query.eq("status", status);
  }

  // Apply organization filter if specified
  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  // Apply pagination
  query = query.range(offset, offset + limit - 1)
    .order("created_at", { ascending: false });

  const { data: projects, error } = await query;

  if (error || !projects) {
    console.error("Error fetching projects:", error);
    return [];
  }

  // Short-circuit: Skip query if no projects to avoid empty in() filter
  const projectIds = projects.map(p => p.id);
  let confirmedSignups: { project_id: string; schedule_id: string }[] | null = null;
  
  if (projectIds.length > 0) {
    // Get confirmed signups for all projects in a single query
    const { data } = await supabase
      .from("project_signups")
      .select(`
        project_id,
        schedule_id
      `)
      .eq("status", "approved")
      .in("project_id", projectIds);
    confirmedSignups = data;
  }

  // Process projects and add signup counts
  const processedProjects = projects.map(project => {
    // Get confirmed signups for this project
    const projectSignups = confirmedSignups?.filter(s => s.project_id === project.id) || [];
    
    // Count signups by schedule_id
    const signupsBySchedule = projectSignups.reduce((acc: Record<string, number>, signup) => {
      const scheduleId = signup.schedule_id || 'default';
      acc[scheduleId] = (acc[scheduleId] || 0) + 1;
      return acc;
    }, {});

    return {
      ...project,
      confirmed_signups: signupsBySchedule,
      total_confirmed: projectSignups.length
    };
  });

  // Extract unique creator IDs and organization IDs from the projects
  const creatorIds = Array.from(new Set(projects.map(p => p.creator_id)));
  const orgIds = Array.from(new Set(projects.map(p => p.organization_id).filter(Boolean)));

  // Short-circuit: Skip profile query if no creator IDs
  let profiles: Profile[] | null = null;
  if (creatorIds.length > 0) {
    const { data, error: profilesError } = await supabase
      .from("profiles")
      .select("id, avatar_url, full_name, username, created_at")
      .in("id", creatorIds);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
    } else {
      profiles = data;
    }
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
  return processedProjects.map(project => ({
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
