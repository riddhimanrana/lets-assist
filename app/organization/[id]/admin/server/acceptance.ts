"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { applyImportedProfileData } from "./shared";
import { isInvitationToken } from "@/lib/organization/invitation-utils";

type AcceptInvitationResult = {
  success: boolean;
  error?: string;
  redirectUrl?: string;
};

const MEMBERSHIP_CHECK_FAILED: AcceptInvitationResult = {
  success: false,
  error: "Could not check membership. Please try again.",
};
const MEMBERSHIP_NOT_ACTIVE: AcceptInvitationResult = {
  success: false,
  error:
    "Ask an organization administrator to restore your membership before accepting this invitation.",
};
const PROMOTION_FAILED: AcceptInvitationResult = {
  success: false,
  error:
    "Failed to update your membership. The invitation is still pending; please try again.",
};

/** Whether a membership already holds the invited role or a higher one. */
function roleCoversInvitation(memberRole: string, invitedRole: string) {
  return (
    memberRole === invitedRole ||
    memberRole === "admin" ||
    (memberRole === "staff" && invitedRole === "member")
  );
}

export async function acceptInvitation(
  token: string,
): Promise<AcceptInvitationResult> {
  "use server";
  if (!isInvitationToken(token)) {
    return { success: false, error: "Invitation not found" };
  }
  const supabase = await createClient({ invitationToken: token });
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
  const { data: invitation, error: invitationReadError } = await supabase
    .from("organization_invitations")
    .select(
      `
      *,
      organization:organizations!organization_invitations_organization_id_fkey(name, username)
    `,
    )
    .eq("token", token)
    .single();

  // A missing row is PGRST116. Any other failure says nothing about whether
  // the invitation exists.
  if (invitationReadError && invitationReadError.code !== "PGRST116") {
    safeConsole.error("Error loading invitation:", invitationReadError);
    return {
      success: false,
      error: "Could not load this invitation. Please try again.",
    };
  }

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
      .eq("id", invitation.id)
      .eq("status", "pending");

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

  // The actor's own row, read with the same client that writes it so a row
  // their session cannot see is never mistaken for no membership.
  const readMembership = () =>
    invitationWriteClient
      .from("organization_members")
      .select("id, role, status")
      .eq("organization_id", invitation.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

  const { data: existingMember, error: membershipReadError } =
    await readMembership();

  if (membershipReadError) {
    safeConsole.error("Error reading invited membership:", membershipReadError);
    return MEMBERSHIP_CHECK_FAILED;
  }

  let joinedNow = false;

  if (existingMember) {
    // An invitation never reactivates a membership an administrator ended.
    if (existingMember.status !== "active") {
      return MEMBERSHIP_NOT_ACTIVE;
    }

    if (!roleCoversInvitation(existingMember.role, invitation.role)) {
      if (existingMember.role !== "member" || invitation.role !== "staff") {
        return {
          success: false,
          error: "You are already a member of this organization",
        };
      }

      // Promote only the row that was read: still active and still a member.
      // The invitation is consumed only after this write is confirmed.
      const { data: promotedMember, error: promotionError } =
        await invitationWriteClient
          .from("organization_members")
          .update({ role: "staff" })
          .eq("id", existingMember.id)
          .eq("status", "active")
          .eq("role", "member")
          .select("id")
          .maybeSingle();

      if (promotionError || !promotedMember) {
        safeConsole.error("Error promoting invited member:", promotionError);
        return PROMOTION_FAILED;
      }
    }
    // Otherwise the membership already holds the invited role, for example
    // when an earlier attempt joined but could not record the acceptance.
  } else {
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
      // A concurrent accept of the same invitation may have created the row
      // first. It is accepted only if it is active and holds the invited role.
      const { data: racedMember, error: racedReadError } =
        memberError.code === "23505"
          ? await readMembership()
          : { data: null, error: null };

      if (
        racedReadError ||
        !racedMember ||
        racedMember.status !== "active" ||
        !roleCoversInvitation(racedMember.role, invitation.role)
      ) {
        safeConsole.error("Error creating member:", memberError);
        return { success: false, error: "Failed to join organization" };
      }
    } else {
      joinedNow = true;
    }
  }

  // Mark invitation as accepted, only while it is still pending.
  const { data: acceptedInvitation, error: invitationUpdateError } =
    await invitationWriteClient
      .from("organization_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: user.id,
      })
      .eq("id", invitation.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

  if (invitationUpdateError) {
    safeConsole.error(
      "Error marking invitation accepted:",
      invitationUpdateError,
    );
    return {
      success: false,
      error: "Failed to finalize invitation acceptance",
    };
  }

  if (!acceptedInvitation) {
    // Nothing was pending any more. Only this account's own concurrent accept
    // counts as success; a cancelled or expired invitation does not.
    const { data: currentInvitation } = await invitationWriteClient
      .from("organization_invitations")
      .select("status, accepted_by")
      .eq("id", invitation.id)
      .maybeSingle();

    if (
      currentInvitation?.status !== "accepted" ||
      currentInvitation.accepted_by !== user.id
    ) {
      return {
        success: false,
        error: "This invitation is no longer valid",
      };
    }
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
  if (joinedNow && userCreatedAt) {
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
