"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";
import { createNotificationForUser } from "@/services/notifications-server";
import { removeCalendarEventForSignup } from "@/utils/calendar-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import { canUserManageProject } from "./access";

const UNREJECT_OUTCOMES = [
  "approved",
  "slot_full",
  "invalid_state",
  "project_closed",
  "invalid_slot",
  "refused",
] as const;

type UnrejectTransition = {
  outcome: (typeof UNREJECT_OUTCOMES)[number];
  project_id: string | null;
};

function getExactUnrejectTransition(value: unknown): UnrejectTransition | null {
  if (!Array.isArray(value) || value.length !== 1) return null;

  const row = value[0];
  if (!row || typeof row !== "object") return null;

  const outcome = Reflect.get(row, "outcome");
  const projectId = Reflect.get(row, "project_id");
  if (
    typeof outcome !== "string" ||
    !UNREJECT_OUTCOMES.includes(
      outcome as (typeof UNREJECT_OUTCOMES)[number],
    ) ||
    (projectId !== null && typeof projectId !== "string")
  ) {
    return null;
  }

  return {
    outcome: outcome as UnrejectTransition["outcome"],
    project_id: projectId,
  };
}

function revalidateSignupPaths(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/signups`);
}

export async function unrejectSignup(signupId: string) {
  "use server";
  const supabase = await createClient();

  try {
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return { error: "You don't have permission to unreject this signup" };
    }

    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("id, project_id, status")
      .eq("id", signupId)
      .maybeSingle();

    if (signupError || !signup || signup.id !== signupId) {
      return { error: "Signup not found" };
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, creator_id, organization_id, can_be_managed_by_staff")
      .eq("id", signup.project_id)
      .maybeSingle();

    if (
      projectError ||
      !project ||
      project.id !== signup.project_id ||
      !(await canUserManageProject(supabase, project, user.id))
    ) {
      return { error: "You don't have permission to unreject this signup" };
    }

    if (signup.status !== "rejected") {
      return { error: "Failed to unreject signup" };
    }

    // The RPC re-authorizes this user, locks the slot on the same advisory key
    // as signup insertion/confirmation, checks capacity, and changes only a
    // still-rejected row. A page-time count followed by UPDATE would overbook.
    const { data: transitionRows, error: updateError } = await supabase.rpc(
      "unreject_project_signup_with_capacity",
      { p_signup_id: signupId },
    );
    const transition = getExactUnrejectTransition(transitionRows);

    if (
      updateError ||
      !transition ||
      transition.project_id !== signup.project_id
    ) {
      throw updateError ?? new Error("Missing signup transition result");
    }

    if (transition.outcome === "slot_full") {
      return {
        error: "This signup cannot be approved because the slot is full",
      };
    }

    if (transition.outcome !== "approved") {
      return { error: "Failed to unreject signup" };
    }

    revalidateSignupPaths(signup.project_id);

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

export async function createRejectionNotification(
  userId: string,
  projectId: string,
  signupId: string,
): Promise<NotificationResult> {
  "use server";
  const supabase = await createClient();

  try {
    // Fetch the project title before creating the notification
    const { data: projectData, error: projectFetchError } = await supabase
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .single();

    if (projectFetchError || !projectData) {
      throw new Error("Failed to fetch project title");
    }

    const projectTitle = projectData.title;

    // Delivered with the service-role client: this runs on the server, where
    // the browser client has no session.
    await createNotificationForUser(
      {
        title: "Project Status Update",
        body: `Your signup to volunteer for "${projectTitle}" has been rejected`,
        type: "project_updates",
        severity: "warning",
        actionUrl: `/projects/${projectId}`,
        data: { projectId, signupId },
      },
      userId,
    );

    return { success: true };
  } catch (error) {
    console.error("Server notification error:", error);
    return { error: "Failed to send notification" };
  }
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
    const { user, error: userError } = await getAuthUser();
    if (userError) {
      return { error: "Failed to cancel signup" };
    }

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

    if (signupError || !signup || signup.id !== signupId) {
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
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .select("id, creator_id, organization_id, can_be_managed_by_staff")
          .eq("id", signup.project_id)
          .maybeSingle();

        if (
          !projectError &&
          project &&
          project.id === signup.project_id &&
          (await canUserManageProject(supabase, project, user.id))
        ) {
          hasPermission = true;
        }
      }
    }

    if (!hasPermission && !user && !anonymousSignupId) {
      return { error: "Authentication required to cancel signup." };
    }

    if (!hasPermission) {
      return { error: "You don't have permission to cancel this signup" };
    }

    const deleteClient = isAnonymousCancellation ? adminSupabase : supabase;

    const { data: cancelledSignup, error: cancelError } = await deleteClient
      .from("project_signups")
      .update({ status: "cancelled" })
      .eq("id", signupId)
      .in("status", ["pending", "approved"])
      .select("id")
      .maybeSingle();

    if (cancelError) {
      console.error("Failed to cancel signup:", cancelError);
      return { error: "Failed to cancel signup" };
    }

    if (cancelledSignup && cancelledSignup.id !== signupId) {
      return { error: "Failed to cancel signup" };
    }

    if (!cancelledSignup) {
      // A concurrent or repeated cancellation is idempotent only when this
      // same RLS-scoped client can prove the row is now cancelled. A silent
      // zero-row UPDATE alone must never be reported as success.
      const { data: currentSignup, error: currentSignupError } =
        await deleteClient
          .from("project_signups")
          .select("id, status")
          .eq("id", signupId)
          .maybeSingle();

      if (currentSignupError) {
        console.error(
          "Failed to verify idempotent signup cancellation:",
          currentSignupError,
        );
        return { error: "Failed to cancel signup" };
      }

      if (
        currentSignup?.id === signupId &&
        currentSignup.status === "cancelled"
      ) {
        revalidateSignupPaths(signup.project_id);
        return { success: true, removedAnonymousProfile: false };
      }

      return { error: "Failed to cancel signup" };
    }

    // Remove calendar event only after the DB write is proven
    try {
      await removeCalendarEventForSignup(signupId);
    } catch (calendarError) {
      console.error("Error removing calendar event:", calendarError);
      // Don't fail the cancellation if calendar removal fails
    }

    console.log("Signup record cancelled successfully.");

    revalidateSignupPaths(signup.project_id);

    // Soft-cancelled signups and any signed waiver evidence remain linked until
    // the retention-aware anonymous cleanup transaction archives them.
    return { success: true, removedAnonymousProfile: false };
  } catch (error) {
    console.error("Error cancelling signup:", error);
    return { error: "Failed to cancel signup" };
  }
}
