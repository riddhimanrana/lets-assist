import { randomUUID } from "node:crypto";

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
  organizationAdminUserId: string;
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

  const { data: organizationAdmin, error: organizationAdminError } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organization.id)
    .eq("role", "admin")
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .order("user_id", { ascending: true })
    .limit(1)
    .single();
  if (organizationAdminError || !organizationAdmin) {
    throw new Error(
      `Could not load the local DVHS CSF organization admin: ${organizationAdminError?.message ?? "missing fixture"}`,
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

  return {
    admin,
    organizationId: organization.id,
    organizationAdminUserId: organizationAdmin.user_id,
    cohortIdsByYear,
  };
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

export type SeededFeedActivity = {
  title: string;
  body: string;
  /** ISO timestamp for the activity itself. */
  startsAt: string;
  location?: string | null;
  pointValue?: number;
  pointType?: "non_drive" | "drive";
  cohortId?: string | null;
  /** ISO timestamp; defaults to now. Orders the activity in the stream. */
  publishedAt?: string;
};

/**
 * Published activities for the unified member Feed stream. Same discipline as
 * the posts: fictional titles under the spec's own prefix, removed by
 * `cleanFeedActivities` afterwards.
 */
export async function seedFeedActivities(
  fixture: CsfFeedFixture,
  activities: SeededFeedActivity[],
) {
  const { error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_opportunities")
    .insert(
      activities.map((activity) => ({
        organization_id: fixture.organizationId,
        title: activity.title,
        body: activity.body,
        starts_at: activity.startsAt,
        location: activity.location ?? null,
        point_value: activity.pointValue ?? 1,
        point_type: activity.pointType ?? "non_drive",
        signup_mode: "none",
        status: "published",
        cohort_id: activity.cohortId ?? null,
        published_at: activity.publishedAt ?? new Date().toISOString(),
      })),
    );
  if (error) {
    throw new Error(`Could not seed fixture feed activities: ${error.message}`);
  }
}

export async function cleanFeedActivities(
  fixture: CsfFeedFixture,
  titlePrefix: string,
) {
  const { error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_opportunities")
    .delete()
    .eq("organization_id", fixture.organizationId)
    .like("title", `${titlePrefix}%`);
  if (error) {
    throw new Error(
      `Could not clean fixture feed activities: ${error.message}`,
    );
  }
}

/**
 * Delete every announcement whose title carries the spec's prefix. Follow-up
 * rows are retired first through the same audited RPC as the product; parent
 * deletion is intentionally RESTRICTed from cascading around that boundary.
 * Safe for repeated or crashed runs; deterministic seed announcements never
 * use these prefixes.
 */
export async function cleanFeedPosts(
  fixture: CsfFeedFixture,
  titlePrefix: string,
) {
  const { data: posts, error: postsError } = await fixture.admin
    .schema("plugin_data")
    .from("csf_announcements")
    .select("id")
    .eq("organization_id", fixture.organizationId)
    .like("title", `${titlePrefix}%`);
  if (postsError) {
    throw new Error(`Could not find fixture feed posts: ${postsError.message}`);
  }

  const postIds = (posts ?? []).map((post) => post.id);
  if (postIds.length > 0) {
    const { data: replies, error: repliesError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_announcement_replies")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .in("announcement_id", postIds);
    if (repliesError) {
      throw new Error(
        `Could not find fixture feed replies: ${repliesError.message}`,
      );
    }

    for (const reply of replies ?? []) {
      const { error: replyError } = await fixture.admin
        .schema("plugin_data")
        .rpc("csf_mutate_post_reply", {
          p_organization_id: fixture.organizationId,
          p_operation: "delete",
          p_post_id: null,
          p_reply_id: reply.id,
          p_body: null,
          p_actor_user_id: fixture.organizationAdminUserId,
          p_request_id: randomUUID(),
        });
      if (replyError) {
        throw new Error(
          `Could not clean fixture feed reply: ${replyError.message}`,
        );
      }
    }
  }

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
