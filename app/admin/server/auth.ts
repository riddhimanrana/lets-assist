import "server-only";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { hasSuperAdminMetadata } from "@/lib/auth/super-admin";

export async function checkSuperAdmin() {
  "use server";
  // Admin Server Actions must not trust a cached JWT after a demotion or
  // revocation. Fetch the current auth record and enforce any enrolled MFA
  // factor independently of proxy/page navigation.
  const { user } = await getAuthUser({ sensitive: true, checkMfa: true });

  if (!user) {
    return { isAdmin: false };
  }

  try {
    return { isAdmin: hasSuperAdminMetadata(user), userId: user.id };
  } catch (err) {
    console.error("Exception checking super admin status:", err);
    return { isAdmin: false };
  }
}
