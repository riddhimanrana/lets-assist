import type {
  PostgrestFilterBuilder,
  PostgrestResponse,
  SupabaseClient,
} from "@supabase/supabase-js";

export type DeleteUserWithCleanupOptions = {
  deleteProjects?: boolean;
  deleteOrganizations?: boolean;
  dryRun?: boolean;
};

export type DeleteUserCleanupReport = {
  userId: string;
  blockedBySoleAdminOrgs: Array<{ organization_id: string; organization_name: string | null }>;
  deletedCounts: Record<string, number>;
  skipped: string[];
  notes: string[];
};

type DeleteStep = {
  label: string;
  executor: () => Promise<PostgrestResponse<Record<string, unknown>>>;
  shouldRun?: () => boolean;
};

export async function deleteUserWithCleanup(
  supabaseAdmin: SupabaseClient,
  userId: string,
  options: DeleteUserWithCleanupOptions = {},
): Promise<DeleteUserCleanupReport> {
  const { deleteProjects = true, deleteOrganizations = false, dryRun = false } = options;
  const deletedCounts: Record<string, number> = {};
  const skipped: string[] = [];
  const notes: string[] = [];

  const blockedOrgs = await findSoleAdminOrgs(supabaseAdmin, userId);
  if (blockedOrgs.length > 0) {
    notes.push("User is the only admin in one or more organizations.");
    return {
      userId,
      blockedBySoleAdminOrgs: blockedOrgs,
      deletedCounts,
      skipped,
      notes,
    };
  }

  const sessionIds = await fetchIds(supabaseAdmin, "auth.sessions", "id", (query) =>
    query.eq("user_id", userId),
  );
  const factorIds = await fetchIds(supabaseAdmin, "auth.mfa_factors", "id", (query) =>
    query.eq("user_id", userId),
  );

  const steps: DeleteStep[] = [
    {
      label: "auth.oauth_authorizations",
      executor: () =>
        supabaseAdmin
          .from("auth.oauth_authorizations")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.oauth_consents",
      executor: () =>
        supabaseAdmin
          .from("auth.oauth_consents")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.mfa_amr_claims",
      shouldRun: () => sessionIds.length > 0,
      executor: () =>
        supabaseAdmin
          .from("auth.mfa_amr_claims")
          .delete()
          .in("session_id", sessionIds)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.refresh_tokens",
      shouldRun: () => sessionIds.length > 0,
      executor: () =>
        supabaseAdmin
          .from("auth.refresh_tokens")
          .delete()
          .in("session_id", sessionIds)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.sessions",
      executor: () =>
        supabaseAdmin
          .from("auth.sessions")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.mfa_challenges",
      shouldRun: () => factorIds.length > 0,
      executor: () =>
        supabaseAdmin
          .from("auth.mfa_challenges")
          .delete()
          .in("factor_id", factorIds)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.mfa_factors",
      executor: () =>
        supabaseAdmin
          .from("auth.mfa_factors")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.one_time_tokens",
      executor: () =>
        supabaseAdmin
          .from("auth.one_time_tokens")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "auth.identities",
      executor: () =>
        supabaseAdmin
          .from("auth.identities")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.notifications",
      executor: () =>
        supabaseAdmin
          .from("notifications")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.notification_settings",
      executor: () =>
        supabaseAdmin
          .from("notification_settings")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.user_calendar_connections",
      executor: () =>
        supabaseAdmin
          .from("user_calendar_connections")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.trusted_member",
      executor: () =>
        supabaseAdmin
          .from("trusted_member")
          .delete()
          .or(`id.eq.${userId},user_id.eq.${userId}`)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.content_reports",
      executor: () =>
        supabaseAdmin
          .from("content_reports")
          .delete()
          .or(`reporter_id.eq.${userId},target_user_id.eq.${userId}`)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.feedback",
      executor: () =>
        supabaseAdmin
          .from("feedback")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.project_signups",
      executor: () =>
        supabaseAdmin
          .from("project_signups")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.certificates",
      executor: () =>
        supabaseAdmin
          .from("certificates")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.user_emails",
      executor: () =>
        supabaseAdmin
          .from("user_emails")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
    {
      label: "public.parental_consents",
      executor: () =>
        supabaseAdmin
          .from("parental_consents")
          .delete()
          .eq("user_id", userId)
          .select("*", { count: "exact" }),
    },
  ];

  if (deleteProjects) {
    steps.push({
      label: "public.projects",
      executor: () =>
        supabaseAdmin
          .from("projects")
          .delete()
          .eq("creator_id", userId)
          .select("*", { count: "exact" }),
    });
  }

  if (deleteOrganizations) {
    steps.push({
      label: "public.organizations",
      executor: () =>
        supabaseAdmin
          .from("organizations")
          .delete()
          .eq("created_by", userId)
          .select("*", { count: "exact" }),
    });
  }

  steps.push({
    label: "public.organization_members",
    executor: () =>
      supabaseAdmin
        .from("organization_members")
        .delete()
        .eq("user_id", userId)
        .select("*", { count: "exact" }),
  });

  steps.push({
    label: "public.profiles",
    executor: () =>
      supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", userId)
        .select("*", { count: "exact" }),
  });

  for (const step of steps) {
    const shouldRun = step.shouldRun?.() ?? true;
    if (!shouldRun) {
      skipped.push(step.label);
      deletedCounts[step.label] = 0;
      continue;
    }

    if (dryRun) {
      skipped.push(step.label);
      deletedCounts[step.label] = 0;
      continue;
    }

    const response = await step.executor();
    if (response.error) {
      throw new Error(`Cleanup failed at ${step.label}: ${response.error.message}`);
    }

    const count = typeof response.count === "number" ? response.count : Array.isArray(response.data) ? response.data.length : 0;
    deletedCounts[step.label] = count;
  }

  if (!dryRun) {
    const adminDelete = supabaseAdmin.auth?.admin?.deleteUser;
    if (!adminDelete) {
      throw new Error("Supabase admin client is missing auth.admin.deleteUser");
    }

    const { error } = await adminDelete(userId);
    if (error) {
      throw new Error(`admin.deleteUser failed: ${error.message}`);
    }
  } else {
    skipped.push("admin.deleteUser");
  }

  return {
    userId,
    blockedBySoleAdminOrgs: [],
    deletedCounts,
    skipped,
    notes,
  };
}

async function fetchIds(
  supabaseAdmin: SupabaseClient,
  table: string,
  column: string,
  filter?: (query: PostgrestFilterBuilder<Record<string, unknown>>) => PostgrestFilterBuilder<Record<string, unknown>>,
): Promise<string[]> {
  let query = supabaseAdmin.from(table).select(column);
  if (filter) {
    query = filter(query);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load IDs from ${table}: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => {
      const value = (row as Record<string, unknown>)[column];
      return typeof value === "string" && value ? value : null;
    })
    .filter((value): value is string => value !== null);
}

async function findSoleAdminOrgs(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<Array<{ organization_id: string; organization_name: string | null }>> {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "admin");

  if (membershipError) {
    throw new Error(`Failed to fetch organization memberships: ${membershipError.message}`);
  }

  const orgIds = (memberships ?? [])
    .map((row) => row.organization_id)
    .filter((id): id is string => Boolean(id));

  if (orgIds.length === 0) {
    return [];
  }

  const { data: organizations, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id,name")
    .in("id", orgIds);

  if (orgError) {
    throw new Error(`Failed to fetch organizations: ${orgError.message}`);
  }

  const results: Array<{ organization_id: string; organization_name: string | null }> = [];

  for (const org of organizations ?? []) {
    const { count, error: countError } = await supabaseAdmin
      .from("organization_members")
      .select("role", { count: "exact", head: true })
      .eq("organization_id", org.id)
      .eq("role", "admin");

    if (countError) {
      throw new Error(`Failed to count admins for org ${org.id}: ${countError.message}`);
    }

    if ((count ?? 0) <= 1) {
      results.push({ organization_id: org.id, organization_name: org.name ?? null });
    }
  }

  return results;
}
