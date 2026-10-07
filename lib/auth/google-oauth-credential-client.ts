import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Trusted workers opt in explicitly. Requests must prove their own subject. */
export async function getGoogleOAuthCredentialClient(
  userId: string,
  useServiceRole = false,
) {
  if (!userId) return null;
  if (!useServiceRole) {
    const session = await createClient();
    const { data, error } = await session.auth.getUser();
    if (error || !data.user || data.user.id !== userId) return null;
  }
  return getAdminClient();
}
