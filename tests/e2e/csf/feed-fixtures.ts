import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";

/**
 * Shared post-feed fixture plumbing for the member Home, cohort Stream, and
 * platform-surface specs. Everything is scoped to the local DVHS CSF fixture
 * organization, every seeded row is fictional, and each spec removes exactly
 * the rows it created (matched by its own unique title prefix) so the
 * deterministic seed corpus is never mutated.
 */

export type CsfFeedFixture = {
  admin: SupabaseClient;
  organizationId: string;
  /** graduation year -> cohort id for the three seeded classes. */
  cohortIdsByYear: Record<number, string>;
};

export async function loadCsfFeedFixture(): Promise<CsfFeedFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  if (organizationError || !organization) {
    throw new Error(
      `Could not load the local DVHS CSF organization: ${organizationError?.message ?? "missing fixture"}`,
    );
  }

  const { data: cohorts, error: cohortsError } = await admin
    .schema("plugin_data")
    .from("csf_cohorts")
    .select("id, graduation_year")
    .eq("organization_id", organization.id);
  if (cohortsError || !cohorts?.length) {
    throw new Error(
      `Could not load the fixture cohorts: ${cohortsError?.message ?? "missing fixture"}`,
    );
  }

  const cohortIdsByYear: Record<number, string> = {};
  for (const cohort of cohorts) {
    cohortIdsByYear[Number(cohort.graduation_year)] = String(cohort.id);
  }

  return { admin, organizationId: organization.id, cohortIdsByYear };
}

export type SeededFeedPost = {
  title: string;
  body: string;
  audience: "members" | "officers" | "class" | "public";
  audienceCohortId?: string | null;
  pinned?: boolean;
  /** ISO timestamp; defaults to now. */
  publishedAt?: string;
};

export async function seedFeedPosts(
  fixture: CsfFeedFixture,
  posts: SeededFeedPost[],
) {
  const { error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_announcements")
    .insert(
      posts.map((post) => ({
        organization_id: fixture.organizationId,
        title: post.title,
        body: post.body,
        audience: post.audience,
        audience_cohort_id: post.audienceCohortId ?? null,
        pinned: post.pinned ?? false,
        status: "published",
        published_at: post.publishedAt ?? new Date().toISOString(),
      })),
    );
  if (error) {
    throw new Error(`Could not seed fixture feed posts: ${error.message}`);
  }
}

/**
 * Delete every announcement whose title carries the spec's prefix. Safe for
 * repeated runs and crashed prior runs; the deterministic seed announcements
 * never use these prefixes.
 */
export async function cleanFeedPosts(
  fixture: CsfFeedFixture,
  titlePrefix: string,
) {
  const { error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_announcements")
    .delete()
    .eq("organization_id", fixture.organizationId)
    .like("title", `${titlePrefix}%`);
  if (error) {
    throw new Error(`Could not clean fixture feed posts: ${error.message}`);
  }
}
