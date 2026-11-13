import "server-only";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicProfileByUsername, type PublicProfileRecord } from "./public";

const FIELDS =
  "id, username, full_name, avatar_url, created_at, profile_visibility, trusted_member";

/** Private profile access uses fresh membership checks, never the public view. */
export async function getVisibleProfileByUsername(username: string) {
  const { user, error } = await getAuthUser();
  if (error) throw new Error("Profile access is temporarily unavailable.");
  if (!user) return getPublicProfileByUsername(username);
  const admin = getAdminClient();
  const result = await admin
    .from("profiles")
    .select(FIELDS)
    .eq("username", username)
    .maybeSingle<PublicProfileRecord>();
  if (result.error || !result.data) return result;
  const profile = result.data;
  if (profile.id === user.id || profile.profile_visibility === "public")
    return result;
  const { data: memberships, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", profile.id)
    .eq("status", "active");
  if (membershipError)
    throw new Error("Profile access is temporarily unavailable.");
  const ids = (memberships ?? []).map((m) => m.organization_id);
  if (!ids.length) return { data: null, error: null };
  let viewer = admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .in("organization_id", ids);
  if (profile.profile_visibility !== "organization_only")
    viewer = viewer.eq("role", "admin");
  const access = await viewer.limit(1);
  if (access.error)
    throw new Error("Profile access is temporarily unavailable.");
  return { data: access.data?.length ? profile : null, error: null };
}

/** Admins see identities only for active members of their own organization. */
export async function getOrganizationMemberProfiles(
  organizationId: string,
  ids: string[],
) {
  const { user, error } = await getAuthUser();
  if (error || !user) return { data: [], error };
  const admin = getAdminClient();
  const access = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .eq("role", "admin")
    .maybeSingle();
  const allowedIds = new Set<string>([user.id]);
  if (access.data && !access.error) {
    const members = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("user_id", ids);
    if (members.error) return { data: [], error: members.error };
    for (const member of members.data ?? []) allowedIds.add(member.user_id);
  }
  const scopedIds = ids.filter((id) => allowedIds.has(id));
  if (!scopedIds.length) return { data: [], error: null };
  return admin.from("profiles").select(FIELDS).in("id", scopedIds);
}
