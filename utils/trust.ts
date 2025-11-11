// Server helper to determine if a user should be displayed as Trusted
// Logic:
// - If profiles.trusted_member is true: trusted
// - Else if the viewer is the same user, check trusted_member.status === true (owner can read own row via RLS)
// - Else: not trusted
// Note: Do not rely on trusted_member table for public viewers due to RLS.

import { createClient } from "@/utils/supabase/server";

export async function isTrustedForDisplay(userId: string): Promise<boolean> {
  const supabase = await createClient();

  // Fetch profile.trusted_member
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("trusted_member")
    .eq("id", userId)
    .single<{ trusted_member: boolean | null }>();

  if (profileRow?.trusted_member) return true;

  // Identify viewer
  const { data: authData } = await supabase.auth.getUser();
  const viewerId = authData?.user?.id;

  // If the viewer is the same user, we can check trusted_member.status as a fallback
  if (viewerId && viewerId === userId) {
    const { data: tmRow } = await supabase
      .from("trusted_member")
      .select("status")
      .eq("id", userId)
      .maybeSingle<{ status: boolean | null }>();

    if (tmRow?.status === true) return true;
  }

  return false;
}
