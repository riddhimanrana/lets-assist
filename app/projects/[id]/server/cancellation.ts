"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";
import { type SignupStatus } from "@/types";
import { removeCalendarEventForSignup } from "@/utils/calendar-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import { canManageProjectAccess } from "@/lib/projects/management-access";

// Add this new function to unreject a signup
export async function unrejectSignup(signupId: string) {
  "use server";
  const supabase = await createClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    if (!user) {
      return { error: "Authentication required to unreject this signup" };
    }

    // Get signup details
    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select(
        "*, project:projects(creator_id, organization_id, can_be_managed_by_staff)",
      )
      .eq("id", signupId)
      .single();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    // Organization staff manage a project only while its creator allows it, so
    // the flag is part of the permission decision rather than the role alone.
    let organizationRole: string | null = null;
    if (
      signup.project?.organization_id &&
      signup.project.creator_id !== user.id
    ) {
      const { data: orgMember } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", signup.project.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      organizationRole = orgMember?.role ?? null;
    }

    if (
      !canManageProjectAccess({
        creatorId: signup.project?.creator_id ?? null,
        userId: user.id,
        organizationRole,
        canBeManagedByStaff: signup.project?.can_be_managed_by_staff,
      })
    ) {
      return { error: "You don't have permission to unreject this signup" };
    }

    // Update signup status to 'approved'
    const { error: updateError } = await supabase
      .from("project_signups")
      .update({ status: "approved" as SignupStatus })
      .eq("id", signupId);

    if (updateError) {
      throw updateError;
    }

    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/signups`);

    return { success: true };
  } catch (error) {
    console.error("Error unrejecting signup:", error);
    return { error: "Failed to unreject signup" };
  }
}

export interface NotificationResult {
  success?: boolean;
  error?: string;
}

export type SignupRejectionOutcome = "accepted" | "replayed" | "rejected";
export type SignupRejectionNotification = "delivered" | "skipped";
export type SignupRejectionNotificationReason =
  "anonymous_signup" | "notification_preference_disabled" | "already_rejected";

export interface RejectSignupResult {
  outcome: SignupRejectionOutcome;
  success?: boolean;
  error?: string;
  notification?: SignupRejectionNotification;
  notificationReason?: SignupRejectionNotificationReason | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type SignupRejectionEnvelope = {
  outcome: "accepted" | "replayed";
  signupId: string;
  projectId: string;
  notification: SignupRejectionNotification;
  notificationReason: SignupRejectionNotificationReason | null;
};

function isSignupRejectionEnvelope(
  value: unknown,
): value is SignupRejectionEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.outcome === "accepted" || candidate.outcome === "replayed") &&
    typeof candidate.projectId === "string" &&
    typeof candidate.signupId === "string" &&
    (candidate.notification === "delivered" ||
      candidate.notification === "skipped")
  );
}

/**
 * Map a database rejection into a message that says what happened without
 * leaking a raw database error, a schema detail, or the existence of a resource
 * the caller is not authorized to see.
 */
function rejectionErrorMessage(code?: string): string {
  switch (code) {
    case "42501":
      return "You don't have permission to reject this signup";
    case "P0002":
      return "Signup not found";
    case "22023":
      return "This signup can no longer be rejected. Refresh the signups list and try again.";
    case "40001":
      return "The signup changed while it was being rejected. Refresh the signups list and try again.";
    default:
      return "Failed to reject signup";
  }
}

/**
 * The single rejection primitive.
 *
 * The status transition and the volunteer's notification commit together inside
 * `public.reject_project_signup`, which re-derives the actor from the session
 * and re-authorizes them against the signup's own project. `expected` carries
 * assertions only: the database still derives every value it writes, so a
 * mismatch aborts before any side effect.
 */
async function rejectSignupTransactionally(
  signupId: string,
  expected?: { userId?: string; projectId?: string },
): Promise<RejectSignupResult> {
  const { user } = await getAuthUser();

  if (!user) {
    return {
      outcome: "rejected",
      error: "Authentication required to reject this signup",
    };
  }

  const identifiers = [signupId, expected?.userId, expected?.projectId].filter(
    (value): value is string => value !== undefined,
  );

  if (identifiers.some((value) => !UUID_PATTERN.test(value))) {
    return { outcome: "rejected", error: "Signup not found" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reject_project_signup", {
    p_signup_id: signupId,
    p_expected_user_id: expected?.userId ?? null,
    p_expected_project_id: expected?.projectId ?? null,
  });

  if (error) {
    console.error("Signup rejection refused at the database boundary:", {
      code: error.code,
    });
    return { outcome: "rejected", error: rejectionErrorMessage(error.code) };
  }

  if (!isSignupRejectionEnvelope(data)) {
    console.error("Signup rejection returned an unrecognized outcome envelope");
    return { outcome: "rejected", error: "Failed to reject signup" };
  }

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath(`/projects/${data.projectId}/signups`);

  return {
    outcome: data.outcome,
    success: true,
    notification: data.notification,
    notificationReason: data.notificationReason ?? null,
  };
}

export async function rejectSignup(
  signupId: string,
): Promise<RejectSignupResult> {
  "use server";
  return rejectSignupTransactionally(signupId);
}

/**
 * Preserved compatibility signature.
 *
 * This action once delivered a service-role notification built from these three
 * caller-supplied identifiers, with no proof they described the same signup or
 * that the caller managed it. It now verifies the supplied user and project
 * against the exact signup inside the same atomic rejection, so a mismatch has
 * no side effect and a replay creates no second notification.
 */
export async function createRejectionNotification(
  userId: string,
  projectId: string,
  signupId: string,
): Promise<NotificationResult> {
  "use server";
  const result = await rejectSignupTransactionally(signupId, {
    userId,
    projectId,
  });

  if (result.error) {
    return { error: result.error };
  }

  return { success: true };
}

export async function cancelSignup(
  signupId: string,
  anonymousSignupId?: string,
  anonymousSignupToken?: string,
) {
  "use server";
  const supabase = await createClient();
  const adminSupabase = getAdminClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    const isAnonymousCancellation = !user && !!anonymousSignupId;
    const signupLookupClient = isAnonymousCancellation
      ? adminSupabase
      : supabase;

    // Get signup details, including anonymous_id
    const { data: signup, error: signupError } = await signupLookupClient
      .from("project_signups")
      .select("*") // Fetch all signup details without join alias
      .eq("id", signupId)
      .maybeSingle();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    // Permission check: User who signed up OR project creator/org admin/staff OR valid anonymous signup owner
    let hasPermission = false;

    // Check if this is an anonymous cancellation with valid anonymousSignupId
    if (anonymousSignupId && signup.anonymous_id === anonymousSignupId) {
      const { data: anonSignup, error: anonAccessError } =
        await getAnonymousSignupAccessRecord({
          anonymousSignupId,
          token: anonymousSignupToken,
          columns: "id",
        });

      if (!anonAccessError && anonSignup) {
        hasPermission = true;
      }
    }

    if (!hasPermission && user) {
      if (signup.user_id === user.id) {
        hasPermission = true;
      } else {
        // Check if user is creator or org admin/staff
        const { data: project } = await supabase
          .from("projects")
          .select("creator_id, organization_id, can_be_managed_by_staff")
          .eq("id", signup.project_id)
          .single();

        if (project?.creator_id === user.id) {
          hasPermission = true;
        } else if (project?.organization_id) {
          const { data: orgMember } = await supabase
            .from("organization_members")
            .select("role")
            .eq("organization_id", project.organization_id)
            .eq("user_id", user.id)
            .single();
          if (
            orgMember?.role === "admin" ||
            (orgMember?.role === "staff" &&
              project.can_be_managed_by_staff === true)
          ) {
            hasPermission = true;
          }
        }
      }
    }

    if (!hasPermission && !user && !anonymousSignupId) {
      return { error: "Authentication required to cancel signup." };
    }

    if (!hasPermission) {
      return { error: "You don't have permission to cancel this signup" };
    }

    // Remove calendar event if it exists (non-blocking)
    try {
      await removeCalendarEventForSignup(signupId);
    } catch (calendarError) {
      console.error("Error removing calendar event:", calendarError);
      // Don't fail the cancellation if calendar removal fails
    }

    const deleteClient = isAnonymousCancellation ? adminSupabase : supabase;

    const { data: cancelledSignup, error: cancelError } = await deleteClient
      .from("project_signups")
      .update({ status: "cancelled" })
      .eq("id", signupId)
      .select("id")
      .maybeSingle();

    if (cancelError || !cancelledSignup) {
      console.error("Failed to cancel signup:", cancelError);
      return { error: "Failed to cancel signup" };
    }

    console.log("Signup record cancelled successfully.");

    let removedAnonymousProfile = false;

    if (anonymousSignupId && signup.anonymous_id === anonymousSignupId) {
      const { count, error: remainingError } = await adminSupabase
        .from("project_signups")
        .select("id", { count: "exact", head: true })
        .eq("anonymous_id", anonymousSignupId);

      if (remainingError) {
        console.error(
          "Error checking remaining anonymous signups:",
          remainingError,
        );
      } else if ((count ?? 0) === 0) {
        const { error: removeAnonymousError } = await adminSupabase
          .from("anonymous_signups")
          .delete()
          .eq("id", anonymousSignupId);

        if (removeAnonymousError) {
          console.error(
            "Error deleting empty anonymous signup profile:",
            removeAnonymousError,
          );
        } else {
          removedAnonymousProfile = true;
        }
      }
    }

    // Revalidate paths
    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/signups`);

    return { success: true, removedAnonymousProfile };
  } catch (error) {
    console.error("Error cancelling signup:", error);
    return { error: "Failed to cancel signup" };
  }
}
