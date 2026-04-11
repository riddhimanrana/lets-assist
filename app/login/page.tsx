import { redirect } from "next/navigation";
import { Metadata } from "next";
import LoginClient from "./LoginClient";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { applyStaffInviteForUser } from "@/lib/organization/staff-invite";
import { buildStaffInviteRedirectPath } from "@/lib/organization/staff-invite-outcome";
import { resolvePostAuthRedirectPath } from "@/lib/auth/mfa";

export const metadata: Metadata = {
  title: "Login",
  description:
    "Log in to your Let's Assist account and start connecting with volunteer opportunities.",
};

interface LoginPageProps {
  searchParams: Promise<{ redirect?: string; staff_token?: string; org?: string; email?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect: redirectPath, staff_token, org, email } = await searchParams;
  const defaultRedirectPath = resolvePostAuthRedirectPath(redirectPath);

  const { user } = await getAuthUser({ allowMfaPending: true });

  if (user && !(staff_token && org)) {
    redirect(defaultRedirectPath);
  }

  if (staff_token && org) {
    if (user) {
      const inviteOutcome = await applyStaffInviteForUser({
        userId: user.id,
        staffToken: staff_token,
        orgUsername: org,
      });

      redirect(buildStaffInviteRedirectPath(inviteOutcome));
    }
  }

  const resolvedRedirectPath = redirectPath ?? "";
  return (
    <LoginClient
      redirectPath={resolvedRedirectPath}
      staffToken={staff_token}
      orgUsername={org}
      prefilledEmail={email}
    />
  );
}
