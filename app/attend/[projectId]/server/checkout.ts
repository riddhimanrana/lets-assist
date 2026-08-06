import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  getAttendanceCheckoutCookieName,
  getAttendanceCheckoutCookieOptions,
  verifyAttendanceCheckoutCapability,
} from "@/lib/attendance/challenge";

export async function checkOutUser(
  signupId: string,
  anonymousProjectId?: string,
) {
  "use server";
  const supabase = await createClient();

  try {
    type ParticipantSignup = {
      id: string;
      project_id: string;
      schedule_id: string;
      check_in_time: string | null;
      user_id: string | null;
      anonymous_id: string | null;
    };

    let signup: ParticipantSignup | null = null;
    let anonymousSignupId: string | null = null;
    let authenticatedUserId: string | null = null;

    if (anonymousProjectId) {
      const cookieStore = await cookies();
      const cookieName = getAttendanceCheckoutCookieName(anonymousProjectId);
      const capability = verifyAttendanceCheckoutCapability(
        cookieStore.get(cookieName)?.value,
        { projectId: anonymousProjectId, signupId },
      );

      if (!capability.ok) {
        return {
          success: false,
          error: "Anonymous checkout access could not be verified.",
        };
      }

      const serviceSupabase = getAdminClient();
      const { data, error: fetchError } = await serviceSupabase
        .from("project_signups")
        .select(
          "id, project_id, schedule_id, check_in_time, user_id, anonymous_id",
        )
        .eq("id", signupId)
        .eq("project_id", capability.payload.projectId)
        .eq("schedule_id", capability.payload.scheduleId)
        .eq("anonymous_id", capability.payload.anonymousSignupId)
        .maybeSingle();

      if (fetchError) {
        console.error(
          "[checkOutUser] Error fetching anonymous signup:",
          fetchError,
        );
        return { success: false, error: "Database error fetching signup." };
      }

      signup = data as ParticipantSignup | null;
      anonymousSignupId = capability.payload.anonymousSignupId;
    } else {
      const { user, error: authError } = await getAuthUser({ sensitive: true });
      if (authError || !user) {
        return { success: false, error: "Authentication required." };
      }

      authenticatedUserId = user.id;
      const { data, error: fetchError } = await supabase
        .from("project_signups")
        .select(
          "id, project_id, schedule_id, check_in_time, user_id, anonymous_id",
        )
        .eq("id", signupId)
        .eq("user_id", authenticatedUserId)
        .maybeSingle();

      if (fetchError) {
        console.error(
          "[checkOutUser] Error fetching owned signup:",
          fetchError,
        );
        return { success: false, error: "Database error fetching signup." };
      }

      signup = data as ParticipantSignup | null;
    }

    if (!signup) {
      return {
        success: false,
        error: "Signup record not found or access denied.",
      };
    }

    type CheckoutRpcRow = {
      check_out_time: string | null;
      outcome: string;
    };
    const serviceSupabase = getAdminClient();
    const { data: checkoutRows, error: checkoutError } =
      await serviceSupabase.rpc("complete_participant_checkout", {
        p_signup_id: signup.id,
        p_user_id: anonymousSignupId ? null : authenticatedUserId,
        p_anonymous_id: anonymousSignupId,
      });
    const checkout = (checkoutRows as CheckoutRpcRow[] | null)?.[0] ?? null;

    if (checkoutError || !checkout) {
      console.error("[checkOutUser] Atomic checkout failed:", checkoutError);
      return {
        success: false,
        error: "Database error during check-out update.",
      };
    }

    if (
      checkout.outcome !== "completed" &&
      checkout.outcome !== "already_checked_out"
    ) {
      const errorByOutcome: Record<string, string> = {
        not_found: "Signup record not found or access denied.",
        not_checked_in: "Cannot check out before check-in.",
        before_event_window:
          "Checkout is not available before the event starts.",
        invalid_schedule: "This attendance session has an invalid schedule.",
        invalid_check_in: "The recorded check-in time is invalid.",
      };
      return {
        success: false,
        error:
          errorByOutcome[checkout.outcome] ??
          "This attendance record cannot be checked out.",
      };
    }

    if (!checkout.check_out_time) {
      return {
        success: false,
        error: "Database error during check-out update.",
      };
    }

    if (anonymousSignupId && anonymousProjectId) {
      const cookieStore = await cookies();
      cookieStore.set(getAttendanceCheckoutCookieName(anonymousProjectId), "", {
        ...getAttendanceCheckoutCookieOptions(anonymousProjectId),
        maxAge: 0,
      });
    }

    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/attendance`);
    revalidatePath(`/projects/${signup.project_id}/hours`);
    revalidatePath(`/attend/${signup.project_id}`);

    return {
      success: true,
      checkOutTime: checkout.check_out_time,
      alreadyCheckedOut: checkout.outcome === "already_checked_out",
    };
  } catch (error) {
    console.error("[checkOutUser] Unexpected error during check-out:", error);
    return { success: false, error: "An unexpected error occurred." };
  }
}
