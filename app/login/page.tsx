import { redirect } from "next/navigation";
import { Metadata } from "next";
import { cookies } from "next/headers";
import LoginClient from "./LoginClient";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { applyStaffInviteForUser } from "@/lib/organization/staff-invite";
import { buildStaffInviteRedirectPath } from "@/lib/organization/staff-invite-outcome";
import { resolvePostAuthRedirectPath } from "@/lib/auth/mfa";
import { DEV_PREVIEW_SOURCE_COOKIE } from "@/lib/supabase/preview-source";

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

  // In development: always reset preview mode to "local" on the login page
  // so the cookie can never get stuck on "remote" while logged out.
  if (process.env.NODE_ENV === "development") {
    try {
      (await cookies()).set(DEV_PREVIEW_SOURCE_COOKIE, "local", {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "lax",
      });
    } catch {
      // Ignore if cookies aren't writable (static render context)
    }
  }

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
      localFixtureMode={process.env.CSF_LOCAL_FIXTURE_MODE === "1"}
    />
  );
}
