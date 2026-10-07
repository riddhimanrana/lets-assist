"use server";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
import { safeConsole } from "@/lib/safe-console";

import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withRetryableSupabaseQuery } from "@/lib/supabase/retry-query";
import type { Project, ProjectStatus, Organization } from "@/types";
import { readProjectOccupancy } from "@/lib/projects/occupancy-read";
import { getProjectStatus } from "@/utils/project";
import {
  projectDiscoveryQuerySchema,
  projectSearchFilter,
} from "@/lib/projects/discovery-query";

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

type ProjectDiscoveryReadModelRow = Project & {
  creator_full_name: string | null;
  creator_avatar_url: string | null;
  creator_username: string | null;
  creator_created_at: string | null;
  organization_name: string | null;
  organization_username: string | null;
  organization_logo_url: string | null;
  organization_verified: boolean | null;
  organization_type: Organization["type"] | null;
};

function projectDiscoveryRowToProject(
  row: ProjectDiscoveryReadModelRow,
): Project {
  return {
    ...row,
    profiles: {
      full_name: row.creator_full_name,
      avatar_url: row.creator_avatar_url,
      username: row.creator_username,
      created_at: row.creator_created_at ?? row.created_at,
      email: "",
    },
    organization: row.organization_id
      ? ({
          id: row.organization_id,
          name: row.organization_name ?? "",
          username: row.organization_username,
          logo_url: row.organization_logo_url,
          verified: row.organization_verified ?? false,
          type: row.organization_type ?? "nonprofit",
        } as Organization)
      : undefined,
  };
}

export async function getActiveProjects(
  limit: number = 21,
  offset: number = 0,
  status?: ProjectStatus,
  organizationId?: string,
  _userId?: string,
  options: GetActiveProjectsOptions = {},
): Promise<Project[]> {
  const input = projectDiscoveryQuerySchema.safeParse({
    limit,
    offset,
    status,
    ...options,
  });
  if (!input.success) throw new Error("Invalid project search parameters");
  const supabase = await createClient();
  const admin = getAdminClient();
  const normalizedSearchTerm = input.data.searchTerm;

  if (!organizationId) {
    let query = admin.from("project_discovery_read_model").select("*");

    if (status) {
      query = query.eq("status", status);
    }

    if (normalizedSearchTerm) {
      query = query.or(projectSearchFilter(normalizedSearchTerm));
    }

    if (input.data.eventType) {
      query = query.eq("event_type", input.data.eventType);
    }

    query = query
      .range(offset, offset + limit - 1)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    const projectsResult = await withRetryableSupabaseQuery(() => query);
    const { data: rows, error } = projectsResult as {
      data: ProjectDiscoveryReadModelRow[] | null;
      error: { message?: string } | null;
    };

    if (error || !rows) {
      safeConsole.error("Error fetching project discovery read model:", error);
      return [];
    }

    const projectIds = rows.map((project) => project.id);
    const occupancyByProject = await readProjectOccupancy(projectIds, () =>
      withRetryableSupabaseQuery(() =>
        admin.rpc("project_occupancy_for_visible_projects", {
          p_project_ids: projectIds,
          p_viewer_id: null,
          p_organization_id: null,
        }),
      ),
    );

    return rows.map((row) => {
      const occupancy = occupancyByProject[row.id];

      return {
        ...projectDiscoveryRowToProject(row),
        confirmed_signups: occupancy.slotsFilledBySchedule,
        total_confirmed: occupancy.slotsFilled,
        slots_filled: occupancy.slotsFilled,
        slots_filled_by_schedule: occupancy.slotsFilledBySchedule,
        status: getProjectStatus(row),
      } as Project;
    });
  }

  // First get all projects
  let query = supabase.from("projects").select(PROJECT_CLIENT_SELECT);

  // Apply status filter if specified
  if (status) {
    query = query.eq("status", status);
  }

  // Apply organization filter if specified
  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  if (normalizedSearchTerm) {
    query = query.or(projectSearchFilter(normalizedSearchTerm));
  }

  if (input.data.eventType) {
    query = query.eq("event_type", input.data.eventType);
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
  query = query
    .range(offset, offset + limit - 1)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  const projectsResult = await withRetryableSupabaseQuery(() => query);
  const { data: projects, error } = projectsResult as {
    data: Project[] | null;
    error: { message?: string } | null;
  };

  if (error || !projects) {
    safeConsole.error("Error fetching projects:", error);
    return [];
  }

  // Short-circuit: Skip query if no projects to avoid empty in() filter
  const projectIds = projects.map((p) => p.id);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const occupancyByProject = await readProjectOccupancy(projectIds, () =>
    withRetryableSupabaseQuery(() =>
      admin.rpc("project_occupancy_for_visible_projects", {
        p_project_ids: projectIds,
        p_viewer_id: user?.id ?? null,
        p_organization_id: organizationId,
      }),
    ),
  );

  // Process projects and add signup counts
  const processedProjects = projects.map((project) => {
    const occupancy = occupancyByProject[project.id];

    return {
      ...project,
      confirmed_signups: occupancy.slotsFilledBySchedule,
      total_confirmed: occupancy.slotsFilled,
      slots_filled: occupancy.slotsFilled,
      slots_filled_by_schedule: occupancy.slotsFilledBySchedule,
    };
  });

  // Extract unique creator IDs and organization IDs from the projects
  const creatorIds = Array.from(new Set(projects.map((p) => p.creator_id)));
  const orgIds = Array.from(
    new Set(projects.map((p) => p.organization_id).filter(Boolean)),
  );

  // Short-circuit: Skip profile query if no creator IDs
  let profiles: Profile[] | null = null;
  if (creatorIds.length > 0) {
    const profilesResult = await withRetryableSupabaseQuery(() =>
      admin
        .from("profiles")
        .select("id, avatar_url, full_name, username, created_at")
        .in("id", creatorIds),
    );

    const { data, error: profilesError } = profilesResult as {
      data: Profile[] | null;
      error: { message?: string } | null;
    };

    if (profilesError) {
      safeConsole.error("Error fetching profiles:", profilesError);
    } else {
      profiles = data;
    }
  }

  // Fetch organizations if needed
  let orgs: Organization[] = [];
  if (orgIds.length > 0) {
    const orgsResult = await withRetryableSupabaseQuery(() =>
      supabase
        .from("organizations")
        .select("id, name, username, logo_url, verified, type")
        .in("id", orgIds),
    );

    const { data: organizations, error: orgsError } = orgsResult as {
      data: Organization[] | null;
      error: { message?: string } | null;
    };

    if (orgsError) {
      safeConsole.error("Error fetching organizations:", orgsError);
    } else {
      orgs = organizations ?? [];
    }
  }

  // Create maps for profiles and organizations
  const profilesMap = (profiles || []).reduce<Record<string, Profile>>(
    (acc, profile) => {
      acc[profile.id] = profile;
      return acc;
    },
    {},
  );

  const orgsMap = orgs.reduce<Record<string, Organization>>((acc, org) => {
    acc[org.id] = org;
    return acc;
  }, {});

  // Merge profile and organization data into each project
  return processedProjects.map((project) => ({
    ...project,
    profiles: profilesMap[project.creator_id] || null,
    organization: project.organization_id
      ? orgsMap[project.organization_id] || undefined
      : undefined,
    status: getProjectStatus(project),
  }));
}

export async function getProjectsByStatus(
  organizationId: string,
  status?: ProjectStatus,
): Promise<Project[]> {
  return getActiveProjects(100, 0, status, organizationId);
}
