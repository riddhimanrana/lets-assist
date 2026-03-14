import { getAdminClient } from "@/lib/supabase/admin";

export type PublicProfileRecord = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string | null;
  profile_visibility: string | null;
  trusted_member: boolean | null;
};

export type ProjectCreatorProfileRecord = PublicProfileRecord & {
  email: string | null;
};

const PUBLIC_PROFILE_SELECT =
  "id, username, full_name, avatar_url, created_at, profile_visibility, trusted_member";

export async function getPublicProfileById(id: string) {
  const admin = getAdminClient();
  return admin
    .from("profiles")
    .select(PUBLIC_PROFILE_SELECT)
    .eq("id", id)
    .maybeSingle<PublicProfileRecord>();
}

export async function getProjectCreatorProfileById(id: string) {
  const admin = getAdminClient();
  return admin
    .from("profiles")
    .select(
      "id, username, full_name, avatar_url, created_at, profile_visibility, trusted_member, email",
    )
    .eq("id", id)
    .maybeSingle<ProjectCreatorProfileRecord>();
}

export async function getPublicProfileByUsername(username: string) {
  const admin = getAdminClient();
  return admin
    .from("profiles")
    .select(PUBLIC_PROFILE_SELECT)
    .eq("username", username)
    .maybeSingle<PublicProfileRecord>();
}

export async function getPublicProfilesByIds(ids: string[]) {
  if (ids.length === 0) {
    return { data: [] as PublicProfileRecord[], error: null };
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(PUBLIC_PROFILE_SELECT)
    .in("id", ids);

  return {
    data: (data as PublicProfileRecord[] | null) ?? [],
    error,
  };
}
