import { redirect } from "next/navigation";
import { Metadata } from "next";
import SignupClient from "./SignupClient";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { applyStaffInviteForUser } from "@/lib/organization/staff-invite";
import { buildStaffInviteRedirectPath } from "@/lib/organization/staff-invite-outcome";
import { getAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Join Let's Assist and start making a difference by finding volunteering opportunities.",
};

interface SignupPageProps {
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

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { redirect: redirectPath, staff_token, org, email, invite_token, member_token, token } = await searchParams;

  const inviteToken = invite_token || member_token || token;

  const { user } = await getAuthUser({ allowMfaPending: true });

  if (user && inviteToken && !staff_token) {
    const inviteParams = new URLSearchParams({ token: inviteToken });
    if (org) inviteParams.set("org", org);
    redirect(`/organization/join/invite?${inviteParams.toString()}`);
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

  let finalRedirectPath = redirectPath ?? "";
  if (inviteToken && !finalRedirectPath) {
    const inviteParams = new URLSearchParams({ token: inviteToken });
    if (org) inviteParams.set("org", org);
    finalRedirectPath = `/organization/join/invite?${inviteParams.toString()}`;
  }

  let prefilledEmail = email;
  let prefilledName;
  let prefilledPhone;

  if (inviteToken) {
    const admin = getAdminClient();
    const { data: invite } = await admin
      .from("organization_invitations")
      .select("email, invited_full_name, invited_phone")
      .eq("token", inviteToken)
      .single();
    
    if (invite) {
      if (!prefilledEmail && invite.email) {
        prefilledEmail = invite.email;
      }
      prefilledName = invite.invited_full_name;
      prefilledPhone = invite.invited_phone;
    }
  }

  return (
    <SignupClient 
      redirectPath={finalRedirectPath} 
      staffToken={staff_token}
      orgUsername={org}
      inviteToken={inviteToken}
      prefilledEmail={prefilledEmail}
      prefilledName={prefilledName || undefined}
      prefilledPhone={prefilledPhone || undefined}
    />
  );
}
