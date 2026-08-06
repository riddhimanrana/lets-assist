import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";
import { type SignupStatus } from "@/types";
import { NotificationService } from "@/services/notifications";
import { removeCalendarEventForSignup } from "@/utils/calendar-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";

// Add this new function to unreject a signup
export async function unrejectSignup(signupId: string) {
  "use server";
  const supabase = await createClient();

  try {
    // Get current user using getClaims() for better performance
    const { user } = await getAuthUser();

    // Get signup details
    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("*, project:projects(creator_id, organization_id)")
      .eq("id", signupId)
      .single();

    if (signupError || !signup) {
      return { error: "Signup not found" };
    }

    // Permission check: Only project creator or org admin/staff can unreject
    let hasPermission = false;
    if (user) {
      if (signup.project?.creator_id === user.id) {
        hasPermission = true;
      } else if (signup.project?.organization_id) {
        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("role")
          .eq("organization_id", signup.project.organization_id)
          .eq("user_id", user.id)
          .single();
        if (orgMember && ["admin", "staff"].includes(orgMember.role)) {
          hasPermission = true;
        }
      }
    }

    if (!hasPermission) {
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

export async function createRejectionNotification(
  userId: string,
  projectId: string,
  signupId: string,
): Promise<NotificationResult> {
  "use server";
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

    // Create notification directly
    await NotificationService.createNotification(
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
