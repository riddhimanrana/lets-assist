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
  searchParams: Promise<{
    redirect?: string;
    staff_token?: string;
    org?: string;
    email?: string;
    invite_token?: string;
    member_token?: string;
    token?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect: redirectPath, staff_token, org, email, invite_token, member_token, token } = await searchParams;
  
  // Resolve invite token: prefer invite_token, fallback to member_token, then token
  const inviteToken = invite_token || member_token || token;

  const defaultRedirectPath = resolvePostAuthRedirectPath(redirectPath);

  const { user } = await getAuthUser({ allowMfaPending: true });

  // If user is already logged in with an invite token, redirect to the invite acceptance page
  if (user && inviteToken && !staff_token) {
    const inviteParams = new URLSearchParams({ token: inviteToken });
    if (org) inviteParams.set("org", org);
    redirect(`/organization/join/invite?${inviteParams.toString()}`);
  }

  // Existing staff invite handling
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
      inviteToken={inviteToken}
      prefilledEmail={email}
    />
  );
}
