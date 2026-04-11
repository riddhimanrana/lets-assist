"use server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withRetryableSupabaseQuery } from "@/lib/supabase/retry-query";
import type { Project, ProjectStatus, Organization } from "@/types";
import {
  ACTIVE_PROJECT_SIGNUP_STATUSES,
  buildProjectOccupancyByProject,
} from "@/lib/projects/availability";
import { getProjectStatus } from "@/utils/project";

// Define the Profile type with an id property
export type Profile = {
  id: string;
  avatar_url: string | null;
  full_name: string | null;
  email: string;
  username: string | null;
  created_at: string;
  phone?: string | null;
};

type GetActiveProjectsOptions = {
  searchTerm?: string;
  eventType?: Project["event_type"];
};

export async function getActiveProjects(
  limit: number = 21, 
  offset: number = 0,
  status?: ProjectStatus,
  organizationId?: string,
  _userId?: string,
  options: GetActiveProjectsOptions = {},
): Promise<Project[]> {
  const supabase = await createClient();
  const admin = getAdminClient();
  const normalizedSearchTerm = options.searchTerm?.trim();

  // First get all projects
  let query = supabase
    .from("projects")
    .select(`
      *
    `);

  // Apply status filter if specified
  if (status) {
    query = query.eq("status", status);
  }

  // Apply organization filter if specified
  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  if (normalizedSearchTerm) {
    query = query.or(`title.ilike.%${normalizedSearchTerm}%,description.ilike.%${normalizedSearchTerm}%`);
  }

  if (options.eventType) {
    query = query.eq("event_type", options.eventType);
  }

  // Apply visibility filter: only show public projects in the main feed
  // If we're showing a specific organization, don't filter by visibility (RLS handles org-only access)
  if (!organizationId) {
    // For public discovery, only show public projects
    // Unlisted projects should only be accessible via direct link, not in feeds
    // Organization-only projects are only visible to organization members
    query = query.eq("visibility", "public");
  }

  // Apply pagination
  query = query.range(offset, offset + limit - 1)
    .order("created_at", { ascending: false });

  const projectsResult = await withRetryableSupabaseQuery(() => query);
  const { data: projects, error } = projectsResult as {
    data: Project[] | null;
    error: { message?: string } | null;
  };

  if (error || !projects) {
    console.error("Error fetching projects:", error);
    return [];
  }

  // Short-circuit: Skip query if no projects to avoid empty in() filter
  const projectIds = projects.map(p => p.id);
  let occupancyByProject: ReturnType<typeof buildProjectOccupancyByProject> = {};
  
  if (projectIds.length > 0) {
    // Fetch aggregate occupancy with the admin client so the public feed can
    // show accurate capacity without exposing who signed up.
    const signupsResult = await withRetryableSupabaseQuery(() => admin
      .from("project_signups")
      .select(`
        project_id,
        schedule_id,
        status
      `)
      .in("status", [...ACTIVE_PROJECT_SIGNUP_STATUSES])
      .in("project_id", projectIds));

    const { data, error: signupsError } = signupsResult as {
      data: { project_id: string; schedule_id: string | null; status: string }[] | null;
      error: { message?: string } | null;
    };

    if (signupsError) {
      console.error("Error fetching project occupancy counts:", signupsError);
    } else {
      occupancyByProject = buildProjectOccupancyByProject(data || []);
    }
  }

  // Process projects and add signup counts
  const processedProjects = projects.map(project => {
    const occupancy = occupancyByProject[project.id] || {
      slotsFilled: 0,
      slotsFilledBySchedule: {},
    };

    return {
      ...project,
      confirmed_signups: occupancy.slotsFilledBySchedule,
      total_confirmed: occupancy.slotsFilled,
      slots_filled: occupancy.slotsFilled,
      slots_filled_by_schedule: occupancy.slotsFilledBySchedule,
    };
  });

  // Extract unique creator IDs and organization IDs from the projects
  const creatorIds = Array.from(new Set(projects.map(p => p.creator_id)));
  const orgIds = Array.from(new Set(projects.map(p => p.organization_id).filter(Boolean)));

  // Short-circuit: Skip profile query if no creator IDs
  let profiles: Profile[] | null = null;
  if (creatorIds.length > 0) {
    const profilesResult = await withRetryableSupabaseQuery(() => admin
      .from("profiles")
      .select("id, avatar_url, full_name, username, created_at")
      .in("id", creatorIds));

    const { data, error: profilesError } = profilesResult as {
      data: Profile[] | null;
      error: { message?: string } | null;
    };

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
    } else {
      profiles = data;
    }
  }

  // Fetch organizations if needed
  let orgs: Organization[] = [];
  if (orgIds.length > 0) {
    const orgsResult = await withRetryableSupabaseQuery(() => supabase
      .from("organizations")
      .select("id, name, username, logo_url, verified, type")
      .in("id", orgIds));

    const { data: organizations, error: orgsError } = orgsResult as {
      data: Organization[] | null;
      error: { message?: string } | null;
    };

    if (orgsError) {
      console.error("Error fetching organizations:", orgsError);
    } else {
      orgs = organizations ?? [];
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
      organization: project.organization_id
        ? orgsMap[project.organization_id] || undefined
        : undefined,
    status: getProjectStatus(project)
  }));
}

export async function getProjectsByStatus(
  organizationId: string,
  status?: ProjectStatus
): Promise<Project[]> {
  return getActiveProjects(100, 0, status, organizationId);
}
