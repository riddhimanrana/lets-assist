import { redirect } from "next/navigation";
import { Metadata } from "next";
import SignupClient from "./SignupClient";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { applyStaffInviteForUser } from "@/lib/organization/staff-invite";
import { buildStaffInviteRedirectPath } from "@/lib/organization/staff-invite-outcome";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Join Let's Assist and start making a difference by finding volunteering opportunities.",
};

interface SignupPageProps {
  searchParams: Promise<{ redirect?: string; staff_token?: string; org?: string; email?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { redirect: redirectPath, staff_token, org, email } = await searchParams;

  if (staff_token && org) {
    const { user } = await getAuthUser({ allowMfaPending: true });

    if (user) {
      const inviteOutcome = await applyStaffInviteForUser({
        userId: user.id,
        staffToken: staff_token,
        orgUsername: org,
      });

      redirect(buildStaffInviteRedirectPath(inviteOutcome));
    }
  }
  
  return (
    <SignupClient 
      redirectPath={redirectPath ?? ""} 
      staffToken={staff_token}
      orgUsername={org}
      prefilledEmail={email}
    />
  );
}
