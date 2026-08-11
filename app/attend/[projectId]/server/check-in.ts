"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  createAttendanceCheckoutCapability,
  getAttendanceCheckoutCookieName,
  getAttendanceCheckoutCookieOptions,
} from "@/lib/attendance/challenge";
import {
  CHECKOUT_CAPABILITY_FALLBACK_MS,
  CHECKOUT_CAPABILITY_GRACE_MS,
  getScheduledCheckoutTime,
  requireAttendancePresence,
} from "./shared";

export async function checkInUser(signupId: string) {
  "use server";
  const supabase = await createClient();
  const now = new Date(); // Get current time once

  try {
    const { user } = await getAuthUser({ sensitive: true });
    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    // 1. Fetch the signup record first
    const { data: signup, error: fetchError } = await supabase
      .from("project_signups")
      .select(
        "id, check_in_time, check_out_time, project_id, schedule_id, user_id, anonymous_id, status",
      ) // Select fields needed for validation/revalidation
      .eq("id", signupId)
      .eq("user_id", user.id)
      .maybeSingle(); // Use maybeSingle as it might not exist

    if (fetchError) {
      console.error("Error fetching signup record:", fetchError);
      return { success: false, error: "Database error fetching signup." };
    }

    if (!signup) {
      console.warn("Signup record not found for check-in:", signupId);
      return { success: false, error: "Signup record not found." };
    }

    if (signup.status !== "approved" && signup.status !== "attended") {
      return {
        success: false,
        error: "Your signup must be approved before you can check in.",
      };
    }

    const presence = await requireAttendancePresence(
      signup.project_id,
      signup.schedule_id,
    );
    if (!presence.ok) {
      return {
        success: false,
        error: "Please scan the attendance QR code again.",
      };
    }

    // 2. Check if already checked in (idempotency)
    if (signup.check_in_time) {
      console.log(
        "User already checked in for signup:",
        signupId,
        "at",
        signup.check_in_time,
      );
      // Return existing check-in time
      return {
        success: true,
        checkInTime: signup.check_in_time,
        checkOutTime: signup.check_out_time || null,
      };
    }

    const updatePayload: Record<string, string | null> = {
      check_in_time: now.toISOString(),
      status: "attended",
    };

    // 3. Leave checkout empty. The participant can complete it exactly once;
    // the automatic checkout job remains the fallback at the scheduled end.
    const serviceSupabase = getAdminClient();
    const { data: updatedRows, error: updateError } = await serviceSupabase
      .from("project_signups")
      .update(updatePayload)
      .eq("id", signupId)
      .eq("project_id", signup.project_id)
      .eq("schedule_id", signup.schedule_id)
      .eq("user_id", user.id)
      .is("check_in_time", null)
      .in("status", ["approved", "attended"])
      .select("id");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      console.error("Error updating check-in time and status:", updateError);
      return {
        success: false,
        error: "Database error during check-in update.",
      };
    }

    // 4. Revalidate relevant paths
    // Revalidate the specific project page
    revalidatePath(`/projects/${signup.project_id}`);
    // Revalidate the attendance page itself (might not be strictly necessary but good practice)
    revalidatePath(`/attend/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/attendance`);
    revalidatePath(`/projects/${signup.project_id}/hours`);
    // If you have user-specific dashboards/profiles, revalidate them too
    if (signup.user_id) {
      revalidatePath(`/profile`); // Example user profile path
      // revalidatePath(`/dashboard`); // Example dashboard path
    }
    // Consider revalidating organizer views if applicable

    console.log(
      "Check-in successful for signup:",
      signupId,
      "at",
      now.toISOString(),
    );
    return {
      success: true,
      checkInTime: now.toISOString(),
      checkOutTime: null,
    };
  } catch (error) {
    console.error("Unexpected error during check-in:", error);
    return { success: false, error: "An unexpected error occurred." };
  }
}

/**
 * Looks up an email for a specific project and schedule to determine signup status.
 */
export async function lookupEmailStatus(
  projectId: string,
  incomingScheduleId: string,
  email: string,
) {
  "use server";
  const presence = await requireAttendancePresence(
    projectId,
    incomingScheduleId,
  );
  if (!presence.ok) {
    return {
      success: false,
      found: false,
      isRegistered: false,
      message: "Please scan the attendance QR code again.",
      error: "Attendance presence could not be verified.",
    };
  }

  const supabase = await createClient();
  const serviceSupabase = getAdminClient();
  const scheduleId = presence.payload.scheduleId;
  const lowerCaseEmail = email.trim().toLowerCase();

  try {
    // 0. Fetch project details for domain restrictions
    type ProjectDomainRow = {
      restrict_to_org_domains: boolean | null;
      organization_id: string | null;
      organizations?:
        | { allowed_email_domains?: string[] | null }
        | { allowed_email_domains?: string[] | null }[]
        | null;
    };

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(
        `
        restrict_to_org_domains,
        organization_id,
        organizations (
          allowed_email_domains
        )
      `,
      )
      .eq("id", projectId)
      .single();

    let allowedDomains: string[] | null = null;
    if (
      !projectError &&
      projectData?.restrict_to_org_domains &&
      projectData.organization_id
    ) {
      const org = (projectData as ProjectDomainRow).organizations;
      const allowed = Array.isArray(org)
        ? org[0]?.allowed_email_domains
        : org?.allowed_email_domains;
      allowedDomains = allowed ?? null;
    }

    // Helper to check domain
    const isDomainAllowed = (emailToCheck: string) => {
      if (!allowedDomains || allowedDomains.length === 0) return true;
      const domain = emailToCheck.split("@")[1];
      return allowedDomains.includes(domain);
    };

    // 1. Try to find a registered user (check primary AND secondary emails)
    let userId: string | null = null;

    // Check primary email
    const { data: profileData, error: profileError } = await serviceSupabase
      .from("profiles")
      .select("id")
      .eq("email", lowerCaseEmail)
      .maybeSingle();

    if (profileError) {
      console.error("Error checking profiles:", profileError);
      return {
        success: false,
        found: false,
        isRegistered: false,
        message: "Database error during profile lookup.",
        error: profileError.message,
      };
    }

    if (profileData) {
      userId = profileData.id;
    } else {
      // Check secondary emails
      const { data: userEmailData, error: userEmailError } =
        await serviceSupabase
          .from("user_emails")
          .select("user_id")
          .eq("email", lowerCaseEmail)
          .not("verified_at", "is", null)
          .maybeSingle();

      if (userEmailError) {
        console.error("Error checking user_emails:", userEmailError);
      } else if (userEmailData) {
        userId = userEmailData.user_id;
      }
    }

    if (userId) {
      // Found registered user - check if they have a signup for this specific project/schedule
      const { data: signupData, error: regSignupError } = await serviceSupabase
        .from("project_signups")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("schedule_id", scheduleId)
        .eq("user_id", userId)
        .maybeSingle();

      if (regSignupError) {
        console.error("Error checking registered user signup:", regSignupError);
        return {
          success: false,
          found: true,
          isRegistered: true,
          message: "Database error checking signup.",
          error: regSignupError.message,
        };
      }

      if (signupData) {
        // Registered user has signed up for this specific session
        console.log("Found registered signup:", signupData);
        return {
          success: true,
          found: true,
          isRegistered: true,
          message: `Account found. Signup status for this session: ${signupData.status}. Please log in to check in.`,
        };
      } else {
        // Registered user exists but is NOT signed up for this specific session
        // Note: We do NOT block on domain here, because the user might have ANOTHER email linked that IS allowed.
        // We let signUpForProject handle the strict check.
        console.log("Registered user found, but no signup for this session.");
        return {
          success: true,
          found: true, // Found the user account
          isRegistered: true,
          message:
            "You have an account but are not signed up for this specific session. Please log in and sign up first.",
        };
      }
    } else {
      // 2. User not found - Check anonymous signups

      // Check domain restrictions for anonymous users (since they have no other linked emails)
      if (!isDomainAllowed(lowerCaseEmail)) {
        return {
          success: false,
          found: false,
          isRegistered: false,
          message: `This project is restricted to users with the following email domains: ${allowedDomains?.join(", ")}. Please use a valid organization email.`,
        };
      }

      const { data: anonData, error: anonError } = await serviceSupabase
        .from("anonymous_signups")
        .select("id, signup_id")
        .eq("email", lowerCaseEmail)
        .eq("project_id", projectId) // Ensure it's for the correct project
        .maybeSingle();

      if (anonError) {
        console.error("Error checking anonymous signups:", anonError);
        return {
          success: false,
          found: false,
          isRegistered: false,
          message: "Database error during anonymous lookup.",
          error: anonError.message,
        };
      }

      if (anonData && anonData.signup_id) {
        // Anonymous record found for this project, check the linked project_signup details
        const { data: signupData, error: anonSignupError } =
          await serviceSupabase
            .from("project_signups")
            .select("id, status, schedule_id") // Select status and schedule_id
            .eq("id", anonData.signup_id)
            .maybeSingle();

        if (anonSignupError) {
          console.error(
            "Error fetching linked signup for anonymous user:",
            anonSignupError,
          );
          return {
            success: false,
            found: true,
            isRegistered: false,
            message: "Database error fetching signup details.",
            error: anonSignupError.message,
          };
        }

        if (signupData) {
          if (signupData.schedule_id === scheduleId) {
            // Anonymous signup found for this specific session
            console.log("Found anonymous signup for this session:", signupData);
            const isApproved = signupData.status === "approved";
            return {
              success: true,
              found: true,
              isRegistered: false,
              message: isApproved
                ? "Anonymous signup found and approved. Use your private anonymous profile link to check in."
                : `Anonymous signup found for this session. Status: ${signupData.status}. Approval may be required.`,
            };
          } else {
            // Anonymous signup found, but for a different session in this project
            console.log(
              "Found anonymous signup, but for different schedule:",
              signupData.schedule_id,
            );
            return {
              success: true,
              found: true, // Found an anonymous signup for the project
              isRegistered: false,
              message:
                "You have an anonymous signup for this project, but for a different session/role.",
            };
          }
        } else {
          // Data inconsistency: anonymous_signup exists but linked project_signup doesn't
          console.error(
            "Data inconsistency: Anonymous signup found, but linked project signup missing. Anon ID:",
            anonData.id,
            "Signup ID:",
            anonData.signup_id,
          );
          return {
            success: true, // Technically lookup succeeded but found an issue
            found: false, // Treat as not found for check-in purposes
            isRegistered: false,
            message:
              "Signup details could not be fully verified. Please contact the organizer.",
          };
        }
      } else {
        // 3. No registered user and no anonymous signup found for this project/email
        console.log("No matching signup found for email:", email);
        return {
          success: true,
          found: false,
          isRegistered: false,
          message: "No signup found for this email and session.",
        };
      }
    }
  } catch (error) {
    console.error("Unexpected error during email lookup:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return {
      success: false,
      found: false,
      isRegistered: false,
      message: "An unexpected error occurred.",
      error: message,
    };
  }
}

/**
 * Checks in an anonymous user: ensures an anonymous_signups record exists,
 * creates or updates a project_signups record (anonymous_id) with check_in_time and status.
 * Returns check-in time and success status.
 */
export async function checkInAnonymous(
  projectId: string,
  incomingScheduleId: string,
  access: {
    anonymousSignupId: string;
    token: string;
    email: string;
  },
) {
  "use server";
  const presence = await requireAttendancePresence(
    projectId,
    incomingScheduleId,
  );
  if (!presence.ok) {
    return {
      success: false,
      error: "Please scan the attendance QR code again.",
    };
  }

  const scheduleId = presence.payload.scheduleId;
  const normalizedEmail = access.email.trim().toLowerCase();
  const { data: anon, error: accessError } =
    await getAnonymousSignupAccessRecord<{
      id: string;
      project_id: string | null;
      signup_id: string | null;
      email: string;
      confirmed_at: string | null;
    }>({
      anonymousSignupId: access.anonymousSignupId,
      token: access.token,
      columns: "id, project_id, signup_id, email, confirmed_at",
    });

  if (
    accessError ||
    !anon ||
    anon.project_id !== projectId ||
    anon.email.trim().toLowerCase() !== normalizedEmail ||
    !anon.confirmed_at ||
    !anon.signup_id
  ) {
    return {
      success: false,
      error: "Anonymous signup access could not be verified.",
    };
  }

  const supabase = await createClient();
  const serviceSupabase = getAdminClient();
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const scheduledCheckoutIso = await getScheduledCheckoutTime(
    supabase,
    projectId,
    scheduleId,
    nowDate,
  );

  const { data: signup, error: signupError } = await serviceSupabase
    .from("project_signups")
    .select("id, check_in_time, check_out_time, schedule_id, status")
    .eq("id", anon.signup_id)
    .eq("anonymous_id", anon.id)
    .eq("project_id", projectId)
    .eq("schedule_id", scheduleId)
    .maybeSingle();

  if (signupError || !signup) {
    return {
      success: false,
      error: "No anonymous signup exists for this attendance session.",
    };
  }

  if (signup.status !== "approved" && signup.status !== "attended") {
    return {
      success: false,
      error: "Your signup must be approved before you can check in.",
    };
  }

  let checkInTime = signup.check_in_time || nowIso;
  let checkOutTime = signup.check_out_time || null;

  if (!signup.check_in_time) {
    const updatePayload: Record<string, string> = {
      check_in_time: nowIso,
      status: "attended",
    };
    const { data: updatedRows, error: updateError } = await serviceSupabase
      .from("project_signups")
      .update(updatePayload)
      .eq("id", signup.id)
      .eq("anonymous_id", anon.id)
      .eq("project_id", projectId)
      .eq("schedule_id", scheduleId)
      .is("check_in_time", null)
      .in("status", ["approved", "attended"])
      .select("id");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      return {
        success: false,
        error: "Failed to record anonymous attendance.",
      };
    }

    checkInTime = nowIso;
    checkOutTime = null;
  }

  const scheduledCheckoutMs = scheduledCheckoutIso
    ? Date.parse(scheduledCheckoutIso)
    : Number.NaN;
  const checkoutCapabilityExpiresAt = Number.isFinite(scheduledCheckoutMs)
    ? Math.max(
        nowDate.getTime() + 5 * 60 * 1000,
        scheduledCheckoutMs + CHECKOUT_CAPABILITY_GRACE_MS,
      )
    : nowDate.getTime() + CHECKOUT_CAPABILITY_FALLBACK_MS;
  const checkoutCapability = createAttendanceCheckoutCapability({
    projectId,
    sessionId: presence.payload.sessionId,
    scheduleId,
    signupId: signup.id,
    anonymousSignupId: anon.id,
    expiresAt: checkoutCapabilityExpiresAt,
  });
  const cookieStore = await cookies();
  cookieStore.set(
    getAttendanceCheckoutCookieName(projectId),
    checkoutCapability.token,
    getAttendanceCheckoutCookieOptions(projectId),
  );

  // Revalidate relevant paths
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/attend/${projectId}`);
  revalidatePath(`/projects/${projectId}/attendance`);
  revalidatePath(`/projects/${projectId}/hours`);

  return {
    success: true,
    signupId: signup.id,
    checkInTime,
    checkOutTime,
    anonSignupId: anon.id,
  };
}
