import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveServerCheckoutTime } from "@/lib/attendance/checkout";
import { canUserManageProject } from "./access";

/**
 * Manually check in a participant by the project creator
 */
export async function checkInParticipant(
  signupId: string,
): Promise<{ success: boolean; error?: string }> {
  "use server";
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser({ sensitive: true });
    if (!user) {
      return { success: false, error: "Authentication required" };
    }

    // Get the signup to verify it exists
    const { data: signup, error: fetchError } = await supabase
      .from("project_signups")
      .select("id, project_id, check_in_time")
      .eq("id", signupId)
      .single();

    if (fetchError || !signup) {
      return {
        success: false,
        error: "Signup record not found",
      };
    }

    const { data: project } = await supabase
      .from("projects")
      .select("creator_id, organization_id, can_be_managed_by_staff")
      .eq("id", signup.project_id)
      .maybeSingle();

    if (!project || !(await canUserManageProject(supabase, project, user.id))) {
      return { success: false, error: "Unauthorized" };
    }

    if (signup.check_in_time) {
      return { success: true };
    }

    // Update the check-in time
    const now = new Date().toISOString();
    const admin = getAdminClient();
    const { data: updatedRows, error: updateError } = await admin
      .from("project_signups")
      .update({ check_in_time: now, status: "attended" })
      .eq("id", signupId)
      .eq("project_id", signup.project_id)
      .is("check_in_time", null)
      .in("status", ["approved", "attended"])
      .select("id");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      return {
        success: false,
        error: "Failed to update check-in time",
      };
    }

    // Revalidate the project page to reflect the changes
    revalidatePath(`/projects/${signup.project_id}`);

    return { success: true };
  } catch (error) {
    console.error("Error checking in participant:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Manually checks out a participant using the server clock. This organizer
 * path is intentionally separate from participant self-checkout so every
 * update is protected by the shared project-management authorization rules.
 */
export async function checkOutParticipant(
  signupId: string,
): Promise<{ success: boolean; checkOutTime?: string; error?: string }> {
  "use server";
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthUser({
      sensitive: true,
      checkMfa: true,
    });
    if (authError || !user) {
      return { success: false, error: "Authentication required" };
    }

    const admin = getAdminClient();
    const { data: signup, error: signupError } = await admin
      .from("project_signups")
      .select("id, project_id, check_in_time")
      .eq("id", signupId)
      .maybeSingle();

    if (signupError || !signup) {
      return {
        success: false,
        error: "Signup record not found or access denied",
      };
    }

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("creator_id, organization_id, can_be_managed_by_staff")
      .eq("id", signup.project_id)
      .maybeSingle();

    if (
      projectError ||
      !project ||
      !(await canUserManageProject(supabase, project, user.id))
    ) {
      return {
        success: false,
        error: "Signup record not found or access denied",
      };
    }

    const checkout = resolveServerCheckoutTime(signup.check_in_time);
    if (!checkout.ok) {
      return {
        success: false,
        error:
          checkout.reason === "missing_check_in"
            ? "Cannot check out before check-in"
            : "The recorded check-in time is invalid",
      };
    }

    const { data: updatedRows, error: updateError } = await admin
      .from("project_signups")
      .update({
        check_out_time: checkout.checkOutTime,
        status: "attended",
      })
      .eq("id", signup.id)
      .eq("project_id", signup.project_id)
      .select("id");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      return { success: false, error: "Failed to update checkout time" };
    }

    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/attendance`);
    revalidatePath(`/projects/${signup.project_id}/hours`);
    revalidatePath(`/attend/${signup.project_id}`);

    return { success: true, checkOutTime: checkout.checkOutTime };
  } catch (error) {
    console.error("Error checking out participant:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}
