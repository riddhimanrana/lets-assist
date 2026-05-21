"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { sendEmail } from "@/services/email";
import OrganizationInvitation from "@/emails/organization-invitation";
import type {
  BulkInviteResult,
  BulkInviteResponse,
  OrganizationInvitationsPage,
  OrganizationInvitationWithDetails,
} from "@/types/invitation";
import {
  getInvitationExpirationDetails,
  getInvitationBaseUrl,
  normalizeInvitationDuration,
  type InvitationDeliveryStatus,
  type InvitationDuration,
} from "@/lib/organization/invitation-utils";
import { getAdminClient } from "@/lib/supabase/admin";

// Get member directory
export async function getOrganizationMembers(organizationId: string) {
  const supabase = await createClient();

  try {
    const { data: members } = await supabase
      .from("organization_members")
      .select(
        `
        id,
        role,
        joined_at,
        status,
        last_activity_at,
        can_verify_hours,
        profiles(
          id,
          full_name,
          avatar_url,
          email
        )
      `
      )
      .eq("organization_id", organizationId)
      .eq("is_visible", true)
      .order("role", { ascending: false });


    return (((members || []) as unknown) as Array<{
      id: string;
      role: string;
      joined_at: string;
      status: string;
      last_activity_at: string | null;
      can_verify_hours: boolean;
      profiles: { id: string; full_name: string; email: string; avatar_url: string | null } | null;
    }>).map((member) => ({
      id: member.id,
      userId: member.profiles?.id,
      name: member.profiles?.full_name,
      email: member.profiles?.email,
      avatar: member.profiles?.avatar_url,
      role: member.role,
      status: member.status,
      joinedAt: member.joined_at,
      lastActivityAt: member.last_activity_at,
      canVerifyHours: member.can_verify_hours,
    }));
  } catch (error) {
    console.error("Error fetching organization members:", error);
    return [];
  }
}

// Check if user is an admin of the organization
async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .single();

  return data?.role === "admin";
}

function normalizeImportedProfileData(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((acc, [key, rawValue]) => {
    if (typeof rawValue !== "string") {
      return acc;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return acc;
    }

    acc[key] = trimmed;
    return acc;
  }, {});
}

async function applyImportedProfileData(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  invitation: {
    email: string;
    import_job_id?: string | null;
    invited_full_name?: string | null;
    invited_phone?: string | null;
    invited_profile_data?: Record<string, unknown> | null;
  };
}) {
  const { supabase, userId, invitation } = params;

  const invitedEmail = invitation.email.trim().toLowerCase();
  const importJobId = invitation.import_job_id || null;

  let importedProfileData = normalizeImportedProfileData(invitation.invited_profile_data);
  let importedFullName =
    (invitation.invited_full_name || importedProfileData.full_name || "").trim();
  let importedPhone =
    (invitation.invited_phone || importedProfileData.phone || "").trim();

  if (importJobId) {
    const { data: importRow } = await supabase
      .from("organization_contact_import_rows")
      .select("full_name, profile_data")
      .eq("job_id", importJobId)
      .eq("email", invitedEmail)
      .maybeSingle();

    const importRowProfileData = normalizeImportedProfileData(importRow?.profile_data);

    importedProfileData = {
      ...importRowProfileData,
      ...importedProfileData,
    };

    importedFullName =
      (invitation.invited_full_name ||
        importRow?.full_name ||
        importRowProfileData.full_name ||
        importedProfileData.full_name ||
        "").trim();

    importedPhone =
      (invitation.invited_phone ||
        importRowProfileData.phone ||
        importedProfileData.phone ||
        "").trim();
  }

  if (!importedFullName && !importedPhone && Object.keys(importedProfileData).length === 0) {
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, profile_metadata")
    .eq("id", userId)
    .single();

  if (!profile) {
    return;
  }

  const updates: Record<string, unknown> = {};
  const currentName = (profile.full_name || "").trim();
  const currentPhone = (profile.phone || "").trim();
  const currentMetadata =
    profile.profile_metadata && typeof profile.profile_metadata === "object" && !Array.isArray(profile.profile_metadata)
      ? (profile.profile_metadata as Record<string, unknown>)
      : {};

  if (
    importedFullName &&
    (!currentName || currentName === "Unknown User" || currentName.startsWith("user_"))
  ) {
    updates.full_name = importedFullName;
  }

  if (importedPhone && !currentPhone) {
    updates.phone = importedPhone;
  }

  updates.profile_metadata = {
    ...currentMetadata,
    ...importedProfileData,
  };

  if (Object.keys(updates).length === 0) {
    return;
  }

  await supabase.from("profiles").update(updates).eq("id", userId);
}

// Bulk invite members to an organization
export async function bulkInviteMembers({
  organizationId,
  emails,
  role,
  invitationDuration,
}: {
  organizationId: string;
  emails: string[];
  role: "staff" | "member";
  invitationDuration?: InvitationDuration;
}): Promise<BulkInviteResponse> {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    return {
      total: emails.length,
      successful: 0,
      failed: emails.length,
      results: emails.map((email) => ({
        email,
        success: false,
        error: "Not authenticated",
      })),
    };
  }

  // Check if user is admin
  const isAdmin = await isOrgAdmin(supabase, organizationId, user.id);
  if (!isAdmin) {
    return {
      total: emails.length,
      successful: 0,
      failed: emails.length,
      results: emails.map((email) => ({
        email,
        success: false,
        error: "Not authorized - admin access required",
      })),
    };
  }

  // Get organization details
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, username")
    .eq("id", organizationId)
    .single();

  if (!org) {
    return {
      total: emails.length,
      successful: 0,
      failed: emails.length,
      results: emails.map((email) => ({
        email,
        success: false,
        error: "Organization not found",
      })),
    };
  }

  // Get inviter profile
  const { data: inviterProfile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();

  const inviterName = inviterProfile?.full_name || inviterProfile?.email || "An admin";

  // Get existing members
  const { data: existingMembers } = await supabase
    .from("organization_members")
    .select("user_id, profiles(email)")
    .eq("organization_id", organizationId);

  const memberEmails = new Set(
    (existingMembers || [])
      .map((m) => {
        const profiles = m.profiles as { email: string } | { email: string }[] | null;
        if (Array.isArray(profiles)) {
          return profiles[0]?.email?.toLowerCase();
        }
        return profiles?.email?.toLowerCase();
      })
      .filter(Boolean)
  );

  // Get pending invitations
  const { data: pendingInvites } = await supabase
    .from("organization_invitations")
    .select("email")
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  const pendingEmails = new Set(
    (pendingInvites || []).map((i) => i.email.toLowerCase())
  );

  const results: BulkInviteResult[] = [];
  let successful = 0;
  let failed = 0;

  const resolvedInvitationDuration = normalizeInvitationDuration(invitationDuration);
  const { expiresAtIso, expiresAtDisplay } =
    getInvitationExpirationDetails(resolvedInvitationDuration);

  for (const email of emails) {
    const normalizedEmail = email.trim().toLowerCase();

    // Check if already a member
    if (memberEmails.has(normalizedEmail)) {
      results.push({
        email: normalizedEmail,
        success: false,
        error: "Already a member of this organization",
      });
      failed++;
      continue;
    }

    // Check if already has pending invite
    if (pendingEmails.has(normalizedEmail)) {
      results.push({
        email: normalizedEmail,
        success: false,
        error: "Already has a pending invitation",
      });
      failed++;
      continue;
    }

    // Create invitation record
    const { data: invitation, error: insertError } = await supabase
      .from("organization_invitations")
      .insert({
        organization_id: organizationId,
        email: normalizedEmail,
        role,
        invited_by: user.id,
        invitation_duration: resolvedInvitationDuration,
        expires_at: expiresAtIso,
      })
      .select("id, token")
      .single();

    if (insertError || !invitation) {
      results.push({
        email: normalizedEmail,
        success: false,
        error: insertError?.message || "Failed to create invitation",
      });
      failed++;
      continue;
    }

    // Build invitation URL
    const baseUrl = getInvitationBaseUrl();
    const inviteUrl = `${baseUrl}/organization/join/invite?token=${invitation.token}`;

    // Send invitation email
    const attemptedAtIso = new Date().toISOString();
    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: `You're invited to join ${org.name} on Let's Assist`,
      react: OrganizationInvitation({
        organizationName: org.name,
        organizationUsername: org.username,
        inviterName,
        role,
        inviteUrl,
        expiresAt: expiresAtDisplay,
      }),
      type: "transactional",
    });

    if (!emailResult.success && !emailResult.skipped) {
      await supabase
        .from("organization_invitations")
        .update({
          email_delivery_status: "failed",
          email_delivery_error: "Failed to send invitation email",
          last_email_attempt_at: attemptedAtIso,
          last_email_sent_at: null,
          email_message_id: null,
          email_transport: null,
        })
        .eq("id", invitation.id);

      results.push({
        email: normalizedEmail,
        success: false,
        error: "Failed to send invitation email",
        invitationId: invitation.id,
      });
      failed++;
      continue;
    }

    const deliveryStatus: InvitationDeliveryStatus = emailResult.skipped ? "skipped" : "sent";

    await supabase
      .from("organization_invitations")
      .update({
        email_delivery_status: deliveryStatus,
        email_delivery_error: emailResult.skipped ? emailResult.reason || null : null,
        last_email_attempt_at: attemptedAtIso,
        last_email_sent_at: emailResult.success ? attemptedAtIso : null,
        email_message_id: emailResult.data?.id || null,
        email_transport: emailResult.data?.transport || null,
      })
      .eq("id", invitation.id);

    results.push({
      email: normalizedEmail,
      success: true,
      invitationId: invitation.id,
    });
    successful++;
    pendingEmails.add(normalizedEmail); // Prevent duplicates in same batch
  }

  return {
    total: emails.length,
    successful,
    failed,
    results,
  };
}

// Get organization invitations
export async function getOrganizationInvitations(
  organizationId: string,
  status: "pending" | "accepted" | "expired" | "cancelled" | "all" = "pending",
  page = 1,
  pageSize = 10,
): Promise<OrganizationInvitationsPage> {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  const safePage = Math.max(1, page);
  const safePageSize = Math.min(Math.max(1, pageSize), 50);

  if (!user) {
    return {
      invitations: [],
      total: 0,
      page: safePage,
      pageSize: safePageSize,
      totalPages: 1,
    };
  }

  const nowIso = new Date().toISOString();
  const rangeFrom = (safePage - 1) * safePageSize;
  const rangeTo = rangeFrom + safePageSize - 1;

  let query = supabase
    .from("organization_invitations")
    .select(
      `
      *,
      inviter:profiles!organization_invitations_invited_by_fkey(full_name, email),
      organization:organizations!organization_invitations_organization_id_fkey(name, username, logo_url)
    `,
      { count: "exact" }
    )
    .eq("organization_id", organizationId);

  if (status === "pending") {
    query = query.eq("status", "pending").gte("expires_at", nowIso);
  } else if (status === "expired") {
    query = query.or(`status.eq.expired,and(status.eq.pending,expires_at.lt.${nowIso})`);
  } else if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (error) {
    console.error("Error fetching invitations:", error);
    return {
      invitations: [],
      total: 0,
      page: safePage,
      pageSize: safePageSize,
      totalPages: 1,
    };
  }

  const total = count || 0;

  return {
    invitations: (data || []) as OrganizationInvitationWithDetails[],
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

// Cancel an invitation
export async function cancelInvitation(
  invitationId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Get the invitation to verify organization membership
  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select("organization_id, status")
    .eq("id", invitationId)
    .single();

  if (!invitation) {
    return { success: false, error: "Invitation not found" };
  }

  if (invitation.status !== "pending") {
    return { success: false, error: "Can only cancel pending invitations" };
  }

  // Check if user is admin
  const isAdmin = await isOrgAdmin(supabase, invitation.organization_id, user.id);
  if (!isAdmin) {
    return { success: false, error: "Not authorized" };
  }

  const { error } = await supabase
    .from("organization_invitations")
    .update({ status: "cancelled" })
    .eq("id", invitationId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function deleteInvitations(params: {
  organizationId: string;
  invitationIds: string[];
}): Promise<{ success: boolean; deleted?: number; error?: string }> {
  const { organizationId, invitationIds } = params;
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const uniqueIds = Array.from(new Set(invitationIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { success: false, error: "No invitations selected" };
  }

  const admin = await isOrgAdmin(supabase, organizationId, user.id);
  if (!admin) {
    return { success: false, error: "Not authorized" };
  }

  const { error } = await supabase
    .from("organization_invitations")
    .delete()
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, deleted: uniqueIds.length };
}

// Resend an invitation email
export async function resendInvitation(
  invitationId: string,
  invitationDuration?: InvitationDuration,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Get the invitation
  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select(
      `
      *,
      organization:organizations!organization_invitations_organization_id_fkey(name, username)
    `
    )
    .eq("id", invitationId)
    .single();

  if (!invitation) {
    return { success: false, error: "Invitation not found" };
  }

  const status = invitation.status as "pending" | "accepted" | "expired" | "cancelled";

  if (status !== "pending" && status !== "expired") {
    return { success: false, error: "Can only resend pending or expired invitations" };
  }

  // Check if user is admin
  const isAdmin = await isOrgAdmin(supabase, invitation.organization_id, user.id);
  if (!isAdmin) {
    return { success: false, error: "Not authorized" };
  }

  // Get inviter profile
  const { data: inviterProfile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();

  const inviterName = inviterProfile?.full_name || inviterProfile?.email || "An admin";
  const org = invitation.organization as { name: string; username: string };

  const resolvedInvitationDuration = normalizeInvitationDuration(
    invitationDuration || invitation.invitation_duration,
  );

  const { expiresAtIso, expiresAtDisplay } =
    getInvitationExpirationDetails(resolvedInvitationDuration);

  const attemptedAtIso = new Date().toISOString();

  // Update the invitation with new expiration
  await supabase
    .from("organization_invitations")
    .update({
      status: "pending",
      invitation_duration: resolvedInvitationDuration,
      expires_at: expiresAtIso,
      email_delivery_status: "pending",
      email_delivery_error: null,
      last_email_attempt_at: attemptedAtIso,
    })
    .eq("id", invitationId);

  // Build invitation URL
  const baseUrl = getInvitationBaseUrl();
  const inviteUrl = `${baseUrl}/organization/join/invite?token=${invitation.token}`;

  // Send email
  const emailResult = await sendEmail({
    to: invitation.email,
    subject: `Reminder: You're invited to join ${org.name} on Let's Assist`,
    react: OrganizationInvitation({
      organizationName: org.name,
      organizationUsername: org.username,
      inviterName,
      role: invitation.role as "staff" | "member",
      inviteUrl,
      expiresAt: expiresAtDisplay,
    }),
    type: "transactional",
  });

  if (!emailResult.success && !emailResult.skipped) {
    await supabase
      .from("organization_invitations")
      .update({
        email_delivery_status: "failed",
        email_delivery_error: "Failed to resend invitation email",
        last_email_attempt_at: attemptedAtIso,
        last_email_sent_at: null,
        email_message_id: null,
        email_transport: null,
      })
      .eq("id", invitationId);

    return { success: false, error: "Failed to send email" };
  }

  const deliveryStatus: InvitationDeliveryStatus = emailResult.skipped ? "skipped" : "sent";

  await supabase
    .from("organization_invitations")
    .update({
      email_delivery_status: deliveryStatus,
      email_delivery_error: emailResult.skipped ? emailResult.reason || null : null,
      last_email_attempt_at: attemptedAtIso,
      last_email_sent_at: emailResult.success ? attemptedAtIso : null,
      email_message_id: emailResult.data?.id || null,
      email_transport: emailResult.data?.transport || null,
    })
    .eq("id", invitationId);

  return { success: true };
}

// Get invitation by token (for public access during acceptance)
export async function getInvitationByToken(
  token: string
): Promise<OrganizationInvitationWithDetails | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organization_invitations")
    .select(
      `
      *,
      inviter:profiles!organization_invitations_invited_by_fkey(full_name, email),
      organization:organizations!organization_invitations_organization_id_fkey(name, username, logo_url)
    `
    )
    .eq("token", token)
    .single();

  if (error || !data) {
    return null;
  }

  return data as OrganizationInvitationWithDetails;
}

// Accept an invitation
export async function acceptInvitation(
  token: string
): Promise<{ success: boolean; error?: string; redirectUrl?: string }> {
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
    return { success: false, error: "Please sign in to accept this invitation" };
  }

  // Get the invitation
  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select(
      `
      *,
      organization:organizations!organization_invitations_organization_id_fkey(name, username)
    `
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
      await supabase
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
        console.error("Error marking invitation accepted:", invitationUpdateError);
        return { success: false, error: "Failed to finalize invitation acceptance" };
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
  const { error: memberError } = await supabase.from("organization_members").insert({
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
    return { success: false, error: "Failed to finalize invitation acceptance" };
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
    typeof user.user_metadata?.created_at === "string" ? user.user_metadata.created_at : null;
  if (userCreatedAt) {
    const createdDate = new Date(userCreatedAt);
    const nowDate = new Date();
    const timeDiffMinutes = (nowDate.getTime() - createdDate.getTime()) / (1000 * 60);
    
    // If user was created less than 2 minutes ago, assume they just signed up
    if (timeDiffMinutes < 2) {
      const homeParams = new URLSearchParams();
      homeParams.set('next', `/organization/${org.username}`);
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
