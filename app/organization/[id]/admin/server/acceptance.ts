"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { applyImportedProfileData } from "./shared";

export async function acceptInvitation(
  token: string,
): Promise<{ success: boolean; error?: string; redirectUrl?: string }> {
  "use server";
  const supabase = await createClient();
  const invitationWriteClient = (() => {
    try {
      return getAdminClient();
    } catch {
      return supabase;
    }
  })();
  const { user } = await getAuthUser();

  if (!user) {
    return {
      success: false,
      error: "Please sign in to accept this invitation",
    };
  }

  // Get the invitation
  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select(
      `
      *,
      organization:organizations!organization_invitations_organization_id_fkey(name, username)
    `,
    )
    .eq("token", token)
    .single();

  if (!invitation) {
    return { success: false, error: "Invitation not found" };
  }

  if (invitation.status !== "pending") {
    return {
      success: false,
      error:
        invitation.status === "accepted"
          ? "This invitation has already been accepted"
          : invitation.status === "expired"
            ? "This invitation has expired"
            : "This invitation is no longer valid",
    };
  }

  // Check if expired
  if (new Date(invitation.expires_at) < new Date()) {
    // Mark as expired
    await invitationWriteClient
      .from("organization_invitations")
      .update({ status: "expired" })
      .eq("id", invitation.id);

    return { success: false, error: "This invitation has expired" };
  }

  // Enforce that only the invited email can accept this invitation.
  const invitedEmail = invitation.email.trim().toLowerCase();
  const signedInEmail = user.email?.trim().toLowerCase();

  if (!signedInEmail || signedInEmail !== invitedEmail) {
    return {
      success: false,
      error: `This invitation was sent to ${invitation.email}. Please sign in with that email to continue.`,
    };
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
    .from("organization_members")
    .select("id, role")
    .eq("organization_id", invitation.organization_id)
    .eq("user_id", user.id)
    .single();

  if (existingMember) {
    // User is already a member
    // If they're a member being invited as staff, upgrade them
    if (existingMember.role === "member" && invitation.role === "staff") {
      await invitationWriteClient
        .from("organization_members")
        .update({ role: "staff" })
        .eq("id", existingMember.id);

      // Mark invitation as accepted
      const { error: invitationUpdateError } = await invitationWriteClient
        .from("organization_invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          accepted_by: user.id,
        })
        .eq("id", invitation.id);

      if (invitationUpdateError) {
        console.error(
          "Error marking invitation accepted:",
          invitationUpdateError,
        );
        return {
          success: false,
          error: "Failed to finalize invitation acceptance",
        };
      }

      await applyImportedProfileData({
        supabase,
        userId: user.id,
        invitation,
      });

      const org = invitation.organization as { username: string };
      return {
        success: true,
        redirectUrl: `/organization/${org.username}`,
      };
    }

    return {
      success: false,
      error: "You are already a member of this organization",
    };
  }

  // Create organization member record
  const { error: memberError } = await invitationWriteClient
    .from("organization_members")
    .insert({
      organization_id: invitation.organization_id,
      user_id: user.id,
      role: invitation.role,
      status: "active",
    });

  if (memberError) {
    console.error("Error creating member:", memberError);
    return { success: false, error: "Failed to join organization" };
  }

  // Mark invitation as accepted
  const { error: invitationUpdateError } = await invitationWriteClient
    .from("organization_invitations")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: user.id,
    })
    .eq("id", invitation.id);

  if (invitationUpdateError) {
    console.error("Error marking invitation accepted:", invitationUpdateError);
    return {
      success: false,
      error: "Failed to finalize invitation acceptance",
    };
  }

  await applyImportedProfileData({
    supabase,
    userId: user.id,
    invitation,
  });

  const org = invitation.organization as { username: string };

  // Check if user was just created (within last 2 minutes)
  // If so, redirect to home/dashboard for onboarding first
  const userCreatedAt =
    typeof user.user_metadata?.created_at === "string"
      ? user.user_metadata.created_at
      : null;
  if (userCreatedAt) {
    const createdDate = new Date(userCreatedAt);
    const nowDate = new Date();
    const timeDiffMinutes =
      (nowDate.getTime() - createdDate.getTime()) / (1000 * 60);

    // If user was created less than 2 minutes ago, assume they just signed up
    if (timeDiffMinutes < 2) {
      const homeParams = new URLSearchParams();
      homeParams.set("next", `/organization/${org.username}`);
      return {
        success: true,
        redirectUrl: `/home?${homeParams.toString()}`,
      };
    }
  }

  return {
    success: true,
    redirectUrl: `/organization/${org.username}`,
  };
}
