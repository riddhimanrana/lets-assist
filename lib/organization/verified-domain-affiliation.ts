import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";

export async function applyVerifiedDomainAffiliation(userId: string) {
  const admin = getAdminClient();
  const { data: userResult, error: userError } =
    await admin.auth.admin.getUserById(userId);
  const user = userResult?.user;

  if (userError || !user?.email || !user.email_confirmed_at) {
    return { status: "unverified" as const };
  }

  const domain = user.email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return { status: "no_domain" as const };

  const { data: affiliationRows, error: affiliationError } = await admin.rpc(
    "apply_verified_domain_affiliation",
    { p_user_id: userId, p_domain: domain },
  );
  const affiliation = Array.isArray(affiliationRows)
    ? affiliationRows[0]
    : affiliationRows;

  if (affiliationError || !affiliation) {
    console.error(
      "Failed to resolve verified domain affiliation:",
      affiliationError,
    );
    return { status: "error" as const };
  }

  if (affiliation.status === "no_match") return { status: "no_match" as const };
  if (affiliation.status === "suppressed") {
    return {
      status: "suppressed" as const,
      organizationId: affiliation.organization_id,
    };
  }
  if (
    affiliation.status !== "joined" &&
    affiliation.status !== "already_member"
  ) {
    return { status: "error" as const };
  }

  await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(user.user_metadata ?? {}),
      auto_joined_org_id: affiliation.organization_id,
      auto_joined_org_name: affiliation.organization_name,
    },
  });

  return {
    status: affiliation.status,
    organizationId: affiliation.organization_id,
  };
}
