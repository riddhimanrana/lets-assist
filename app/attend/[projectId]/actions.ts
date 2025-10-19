"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import type { Project } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Checks in a user (registered or anonymous) by updating their signup record.
 * Sets check_in_time and status to 'attended'.
 * Idempotent: If already checked in, returns success without re-updating.
 */
export async function checkInUser(signupId: string, userId?: string) {
  console.log("Attempting to check in:", { signupId, userId });
  const supabase = await createClient();
  const now = new Date(); // Get current time once

  try {
    // 1. Fetch the signup record first
    const { data: signup, error: fetchError } = await supabase
      .from('project_signups')
  .select('id, check_in_time, check_out_time, project_id, schedule_id, user_id, anonymous_id') // Select fields needed for validation/revalidation
      .eq('id', signupId)
      .maybeSingle(); // Use maybeSingle as it might not exist

    if (fetchError) {
      console.error("Error fetching signup record:", fetchError);
      return { success: false, error: "Database error fetching signup." };
    }

    if (!signup) {
      console.warn("Signup record not found for check-in:", signupId);
      return { success: false, error: "Signup record not found." };
    }

    // 2. Check if already checked in (idempotency)
    if (signup.check_in_time) {
      console.log("User already checked in for signup:", signupId, "at", signup.check_in_time);
      // Return existing check-in time
  return { success: true, checkInTime: signup.check_in_time, checkOutTime: signup.check_out_time || null };
    }

    const scheduledCheckoutIso = await getScheduledCheckoutTime(
      supabase,
      signup.project_id,
      signup.schedule_id,
      now
    );

    const updatePayload: Record<string, string | null> = {
      check_in_time: now.toISOString(),
      status: "attended",
    };

    if (scheduledCheckoutIso) {
      updatePayload.check_out_time = scheduledCheckoutIso;
    }

    // 3. Update the check_in_time and status (and default checkout time if available)
    const { error: updateError } = await supabase
      .from('project_signups')
      .update(updatePayload)
      .eq('id', signupId);

    if (updateError) {
      console.error("Error updating check-in time and status:", updateError);
      return { success: false, error: "Database error during check-in update." };
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

    console.log("Check-in successful for signup:", signupId, "at", now.toISOString());
    return { success: true, checkInTime: now.toISOString(), checkOutTime: scheduledCheckoutIso || null };

  } catch (error) {
    console.error("Unexpected error during check-in:", error);
    return { success: false, error: "An unexpected error occurred." };
  }
}


/**
 * Looks up an email for a specific project and schedule to determine signup status.
 */
export async function lookupEmailStatus(projectId: string, scheduleId: string, email: string) {
  console.log("Looking up email status:", { projectId, scheduleId, email });
  const supabase = await createClient();
  const lowerCaseEmail = email.toLowerCase();

  try {
    // 1. Check if email exists in profiles (registered user)
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", lowerCaseEmail)
      .maybeSingle();

    if (profileError) {
      console.error("Error checking profiles:", profileError);
      return { success: false, found: false, isRegistered: false, message: "Database error during profile lookup.", error: profileError.message };
    }

    if (profileData) {
      // Found registered user - check if they have a signup for this specific project/schedule
      const { data: signupData, error: regSignupError } = await supabase
        .from("project_signups")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("schedule_id", scheduleId)
        .eq("user_id", profileData.id)
        .maybeSingle();

      if (regSignupError) {
        console.error("Error checking registered user signup:", regSignupError);
        return { success: false, found: true, isRegistered: true, message: "Database error checking signup.", error: regSignupError.message };
      }

      if (signupData) {
        // Registered user has signed up for this specific session
        console.log("Found registered signup:", signupData);
        return {
          success: true,
          found: true,
          isRegistered: true,
          signupId: signupData.id,
          message: `Account found. Signup status for this session: ${signupData.status}. Please log in to check in.`
        };
      } else {
        // Registered user exists but is NOT signed up for this specific session
        console.log("Registered user found, but no signup for this session.");
        return {
          success: true,
          found: true, // Found the user account
          isRegistered: true,
          message: "You have an account but are not signed up for this specific session. Please log in and sign up first."
        };
      }
    } else {
      // 2. Email not found in profiles - check anonymous signups for this project
      // Fetch project details to check if anonymous signups are allowed (optional but good practice)
      // const { data: projectData } = await supabase.from('projects').select('require_login').eq('id', projectId).single();
      // if (projectData?.require_login) {
      //   return { success: true, found: false, isRegistered: false, message: "No account found, and this project requires login." };
      // }

      const { data: anonData, error: anonError } = await supabase
        .from("anonymous_signups")
        .select("id, signup_id") // Select anon id and the linked signup id
        .eq("email", lowerCaseEmail)
        .eq("project_id", projectId) // Ensure it's for the correct project
        .maybeSingle();

      if (anonError) {
        console.error("Error checking anonymous signups:", anonError);
        return { success: false, found: false, isRegistered: false, message: "Database error during anonymous lookup.", error: anonError.message };
      }

      if (anonData && anonData.signup_id) {
        // Anonymous record found for this project, check the linked project_signup details
        const { data: signupData, error: anonSignupError } = await supabase
          .from("project_signups")
          .select("id, status, schedule_id") // Select status and schedule_id
          .eq("id", anonData.signup_id)
          .maybeSingle();

        if (anonSignupError) {
          console.error("Error fetching linked signup for anonymous user:", anonSignupError);
          return { success: false, found: true, isRegistered: false, message: "Database error fetching signup details.", error: anonSignupError.message };
        }

        if (signupData) {
          if (signupData.schedule_id === scheduleId) {
            // Anonymous signup found for this specific session
            console.log("Found anonymous signup for this session:", signupData);
            const isApproved = signupData.status === 'approved';
            return {
              success: true,
              found: true,
              isRegistered: false,
              signupId: signupData.id,
              anonSignupId: anonData.id, // Pass the anonymous_signups ID
              message: isApproved
                ? "Anonymous signup found and approved for this session."
                : `Anonymous signup found for this session. Status: ${signupData.status}. Approval may be required.`
            };
          } else {
            // Anonymous signup found, but for a different session in this project
            console.log("Found anonymous signup, but for different schedule:", signupData.schedule_id);
            return {
              success: true,
              found: true, // Found an anonymous signup for the project
              isRegistered: false,
              message: "You have an anonymous signup for this project, but for a different session/role."
            };
          }
        } else {
          // Data inconsistency: anonymous_signup exists but linked project_signup doesn't
          console.error("Data inconsistency: Anonymous signup found, but linked project signup missing. Anon ID:", anonData.id, "Signup ID:", anonData.signup_id);
          return {
            success: true, // Technically lookup succeeded but found an issue
            found: false, // Treat as not found for check-in purposes
            isRegistered: false,
            message: "Signup details could not be fully verified. Please contact the organizer."
          };
        }
      } else {
        // 3. No registered user and no anonymous signup found for this project/email
        console.log("No matching signup found for email:", email);
        return { success: true, found: false, isRegistered: false, message: "No signup found for this email and session." };
      }
    }
  } catch (error: any) {
    console.error("Unexpected error during email lookup:", error);
    return { success: false, found: false, isRegistered: false, message: "An unexpected error occurred.", error: error.message };
  }
}

/**
 * Checks in an anonymous user: ensures an anonymous_signups record exists,
 * creates or updates a project_signups record (anonymous_id) with check_in_time and status.
 * Returns check-in time and success status.
 */
export async function checkInAnonymous(projectId: string, scheduleId: string, email: string) {
    const supabase = await createClient();
    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const lowerEmail = email.toLowerCase();

    const scheduledCheckoutIso = await getScheduledCheckoutTime(
      supabase,
      projectId,
      scheduleId,
      nowDate
    );

    // 1. Find anonymous_signups
    let { data: anon, error: anonErr } = await supabase
        .from('anonymous_signups')
        .select('id, signup_id')
        .eq('email', lowerEmail)
        .eq('project_id', projectId)
        .maybeSingle();

    if (anonErr) {
        console.error('[checkInAnonymous] Error fetching anonymous_signups:', anonErr);
        return { success: false, error: 'Database error fetching anonymous record.' };
    }
    if (!anon) {
        console.warn('[checkInAnonymous] No anonymous_signups record found for:', lowerEmail, projectId);
        return { success: false, error: 'Anonymous signup record not found.' };
    }

    // 2. Find project_signups for this anon and schedule
  let { data: signup, error: signupErr } = await supabase
    .from('project_signups')
    .select('id, check_in_time, check_out_time, schedule_id, status')
    .eq('anonymous_id', anon.id)
    .eq('project_id', projectId)
    .eq('schedule_id', scheduleId)
    .maybeSingle();

    if (signupErr) {
        console.error('[checkInAnonymous] Error fetching project_signups:', signupErr);
        return { success: false, error: 'Database error fetching signup.' };
    }

    let checkInTime = nowIso;
    let checkOutTime = scheduledCheckoutIso || null;
    let signupId: string | undefined = signup?.id;

  if (signup) {
    // Already have a signup for this session
    if (signup.check_in_time) {
      console.log('[checkInAnonymous] Already checked in:', signup.id, signup.check_in_time);
      checkInTime = signup.check_in_time;
      checkOutTime = signup.check_out_time || scheduledCheckoutIso || null;
    } else {
      // Update check_in_time and status
      console.log('[checkInAnonymous] Attempting update for signup.id:', signup.id, 'with', { check_in_time: nowIso, status: 'attended' });
      const updatePayload: Record<string, string> = {
        check_in_time: nowIso,
        status: 'attended'
      };

      if (scheduledCheckoutIso) {
        updatePayload.check_out_time = scheduledCheckoutIso;
      }

      const { data: updateData, error: updateErr } = await supabase
        .from('project_signups')
        .update(updatePayload)
        .eq('id', signup.id)
        .select(); // Get updated row for debugging

      if (updateErr) {
        console.error('[checkInAnonymous] Error updating check-in:', updateErr);
        return { success: false, error: 'Database error updating check-in.' };
      }
      if (!updateData || updateData.length === 0) {
        console.warn('[checkInAnonymous] Update did not modify any rows. Possible reasons: row already updated, wrong id, or RLS.');
        return { success: false, error: 'No rows updated. Check permissions and signup id.' };
      }
      console.log('[checkInAnonymous] Updated check-in for signup:', signup.id, nowIso, 'Updated row:', updateData[0]);
      checkInTime = nowIso;
      checkOutTime = scheduledCheckoutIso || null;
    }
  } else {
        // No signup for this session, update existing signup if possible
        // Try to find any signup for this anon/project (not schedule-specific)
        let { data: anySignup, error: anySignupErr } = await supabase
            .from('project_signups')
            .select('id, schedule_id')
            .eq('anonymous_id', anon.id)
            .eq('project_id', projectId)
            .maybeSingle();

        if (anySignupErr) {
            console.error('[checkInAnonymous] Error fetching any project_signups:', anySignupErr);
            return { success: false, error: 'Database error fetching any signup.' };
        }

        if (anySignup) {
            // Update this signup to the new schedule and check-in
            const updatePayload: Record<string, string> = {
                schedule_id: scheduleId,
                check_in_time: nowIso,
                status: 'attended'
            };

            if (scheduledCheckoutIso) {
                updatePayload.check_out_time = scheduledCheckoutIso;
            }

            const { error: updateErr } = await supabase
                .from('project_signups')
                .update(updatePayload)
                .eq('id', anySignup.id);

            if (updateErr) {
                console.error('[checkInAnonymous] Error updating existing signup to new schedule:', updateErr);
                return { success: false, error: 'Database error updating signup for new schedule.' };
            }
            console.log('[checkInAnonymous] Updated existing signup to new schedule:', anySignup.id, scheduleId, nowIso);
            signupId = anySignup.id;
            checkInTime = nowIso;
            checkOutTime = scheduledCheckoutIso || null;
        } else {
            // No signup exists at all for this anon/project, cannot update
            console.warn('[checkInAnonymous] No project_signups found for anon:', anon.id, projectId);
            return { success: false, error: 'No signup found to update for this anonymous user.' };
        }
    }

    // Revalidate relevant paths
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/attend/${projectId}`);
    revalidatePath(`/projects/${projectId}/attendance`);
    revalidatePath(`/projects/${projectId}/hours`);

    return { 
        success: true, 
        signupId: signupId,
        checkInTime: checkInTime,
        checkOutTime: checkOutTime,
        anonSignupId: anon.id   // include anonymous_signups ID for profile link
    };
}

/**
 * Manually checks out a user by setting their check_out_time to the provided time (defaults to now).
 */
export async function checkOutUser(signupId: string, overrideTime?: string) {
  const supabase = await createClient();

  try {
    const { data: signup, error: fetchError } = await supabase
      .from('project_signups')
      .select('id, project_id, check_in_time')
      .eq('id', signupId)
      .maybeSingle();

    if (fetchError) {
      console.error('[checkOutUser] Error fetching signup record:', fetchError);
      return { success: false, error: 'Database error fetching signup.' };
    }

    if (!signup) {
      console.warn('[checkOutUser] Signup record not found for check-out:', signupId);
      return { success: false, error: 'Signup record not found.' };
    }

    if (!signup.check_in_time) {
      return { success: false, error: 'Cannot check out before check-in.' };
    }

    const checkOutDate = overrideTime ? new Date(overrideTime) : new Date();

    if (Number.isNaN(checkOutDate.getTime())) {
      return { success: false, error: 'Invalid checkout time provided.' };
    }

    const checkInDate = new Date(signup.check_in_time);
    if (checkOutDate.getTime() < checkInDate.getTime()) {
      checkOutDate.setTime(checkInDate.getTime());
    }

    const checkOutIso = checkOutDate.toISOString();

    const { error: updateError } = await supabase
      .from('project_signups')
      .update({ check_out_time: checkOutIso, status: 'attended' })
      .eq('id', signupId);

    if (updateError) {
      console.error('[checkOutUser] Error updating checkout time:', updateError);
      return { success: false, error: 'Database error during check-out update.' };
    }

    revalidatePath(`/projects/${signup.project_id}`);
    revalidatePath(`/projects/${signup.project_id}/attendance`);
    revalidatePath(`/projects/${signup.project_id}/hours`);
    revalidatePath(`/attend/${signup.project_id}`);

    return { success: true, checkOutTime: checkOutIso };
  } catch (error) {
    console.error('[checkOutUser] Unexpected error during check-out:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

type MinimalProject = Pick<Project, "event_type" | "schedule" | "project_timezone">;

async function getScheduledCheckoutTime(
  supabase: SupabaseClient,
  projectId: string,
  scheduleId: string,
  fallbackDate: Date
): Promise<string | null> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('event_type, schedule, project_timezone')
    .eq('id', projectId)
    .single();

  if (error) {
    console.error('[getScheduledCheckoutTime] Error fetching project schedule:', error);
    return null;
  }

  if (!project) {
    console.warn('[getScheduledCheckoutTime] Project not found for id:', projectId);
    return null;
  }

  const typedProject = project as MinimalProject;
  const schedule = typedProject.schedule as Project['schedule'];
  if (!schedule) {
    return null;
  }

  const timezone = typedProject.project_timezone || undefined;
  const toDateTime = (dateStr: string, timeStr: string): Date | null => {
    if (!dateStr || !timeStr) {
      return null;
    }

    try {
      if (timezone) {
        return fromZonedTime(`${dateStr}T${timeStr}:00`, timezone);
      }

      const [hours, minutes] = timeStr.split(':').map(Number);
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      date.setHours(hours, minutes, 0, 0);
      return date;
    } catch (err) {
      console.error('[getScheduledCheckoutTime] Failed to build datetime:', err);
      return null;
    }
  };

  let endDate: Date | null = null;

  if (typedProject.event_type === 'oneTime' && schedule.oneTime) {
    endDate = toDateTime(schedule.oneTime.date, schedule.oneTime.endTime);
  } else if (typedProject.event_type === 'multiDay' && schedule.multiDay) {
    const directParts = scheduleId.split('-');
    let slot: { endTime: string } | undefined;
    let dateStr: string | undefined;

    if (directParts.length >= 2) {
      const slotIndexStr = directParts.pop();
      const potentialDate = directParts.join('-');
      const day = schedule.multiDay.find(d => d.date === potentialDate);
      if (day && slotIndexStr !== undefined) {
        const idx = Number.parseInt(slotIndexStr, 10);
        slot = day.slots[idx];
        dateStr = day.date;
      }
    }

    if (!slot) {
      const altMatch = scheduleId.match(/^day-(\d+)-slot-(\d+)$/);
      if (altMatch) {
        const dayIdx = Number.parseInt(altMatch[1], 10);
        const slotIdx = Number.parseInt(altMatch[2], 10);
        const day = schedule.multiDay[dayIdx];
        if (day) {
          slot = day.slots[slotIdx];
          dateStr = day.date;
        }
      }
    }

    if (!slot) {
      // Fallback: brute force search
      schedule.multiDay.forEach(day => {
        day.slots.forEach((s, idx) => {
          const candidateIds = [
            `${day.date}-${idx}`,
            `day-${schedule.multiDay!.indexOf(day)}-slot-${idx}`,
          ];
          if (candidateIds.includes(scheduleId)) {
            slot = s;
            dateStr = day.date;
          }
        });
      });
    }

    if (slot && dateStr) {
      endDate = toDateTime(dateStr, slot.endTime);
    }
  } else if (typedProject.event_type === 'sameDayMultiArea' && schedule.sameDayMultiArea) {
    const roleByName = schedule.sameDayMultiArea.roles.find(role => role.name === scheduleId);
    let role = roleByName;

    if (!role) {
      const roleMatch = scheduleId.match(/^role-(\d+)$/);
      if (roleMatch) {
        const index = Number.parseInt(roleMatch[1], 10);
        role = schedule.sameDayMultiArea.roles[index];
      }
    }

    if (role) {
      endDate = toDateTime(schedule.sameDayMultiArea.date, role.endTime);
    }
  }

  if (!endDate) {
    return null;
  }

  if (endDate.getTime() < fallbackDate.getTime()) {
    return fallbackDate.toISOString();
  }

  return endDate.toISOString();
}

