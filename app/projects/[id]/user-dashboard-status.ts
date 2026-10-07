import { safeConsole } from "@/lib/safe-console";

import {
  differenceInHours,
  differenceInMinutes,
  format,
  formatDistanceToNowStrict,
  isAfter,
  isBefore,
  parseISO,
} from "date-fns";
import type { Project, Signup } from "@/types";
import { formatTimeTo12Hour } from "@/lib/utils";
import { getSlotDetails } from "@/utils/project";

// Helper function to format remaining time (copied from AttendanceClient)
function formatRemainingTime(minutes: number): string {
  if (minutes <= 0) return "Session ended";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60) + 1;
  let result = "";
  if (hours > 0) {
    result += `${hours}h `;
  }
  if (remainingMinutes > 0 || hours === 0) {
    result += `${remainingMinutes}m`;
  }
  return result.trim() || "0m"; // Ensure "0m" if exactly 0
}

// Helper function to get combined DateTime from date and time strings
function getCombinedDateTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  try {
    // Use date-fns parse which is more robust
    const dateTime = parseISO(`${dateStr}T${timeStr}`);
    return isNaN(dateTime.getTime()) ? null : dateTime;
  } catch (e) {
    safeConsole.error("Error parsing date/time:", e);
    return null;
  }
}

// Helper function to calculate and format duration between check-in and check-out
export function calculateVolunteerDuration(
  checkIn: string | null,
  checkOut: string | null,
): {
  text: string;
  isValid: boolean;
  totalMinutes: number;
} {
  if (!checkIn || !checkOut) {
    return { text: "Incomplete", isValid: false, totalMinutes: 0 };
  }

  try {
    const checkInDate = parseISO(checkIn);
    const checkOutDate = parseISO(checkOut);

    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      return { text: "Invalid times", isValid: false, totalMinutes: 0 };
    }

    const diffMinutes = differenceInMinutes(checkOutDate, checkInDate);

    if (diffMinutes < 0) {
      return { text: "Invalid duration", isValid: false, totalMinutes: 0 };
    }

    if (diffMinutes > 24 * 60) {
      return { text: "Over 24h", isValid: false, totalMinutes: diffMinutes };
    }

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return {
        text: `${hours}h ${minutes}m`,
        isValid: true,
        totalMinutes: diffMinutes,
      };
    } else if (hours > 0) {
      return { text: `${hours}h`, isValid: true, totalMinutes: diffMinutes };
    } else {
      return { text: `${minutes}m`, isValid: true, totalMinutes: diffMinutes };
    }
  } catch {
    return { text: "Error calculating", isValid: false, totalMinutes: 0 };
  }
}

type SlotDetails =
  | NonNullable<Project["schedule"]["oneTime"]>
  | NonNullable<Project["schedule"]["multiDay"]>[number]["slots"][number]
  | NonNullable<Project["schedule"]["sameDayMultiArea"]>["roles"][number];

// Helper function to get a consistent session display name
function getSessionDisplayName(
  project: Project,
  startTime: Date | null,
  details: SlotDetails,
): string {
  // If multiRole event with named roles, keep using the role name
  if ("name" in details && details.name) {
    return details.name;
  }
  // For oneTime events, show "Main Event"
  else if (project.schedule?.oneTime) {
    return "Main event";
  }
  // For multiDay events, format the date nicely with time
  else if (project.schedule?.multiDay && startTime) {
    // Format the date from the session start time and include time info
    const formattedDate = format(startTime, "MMMM d, yyyy");
    const formattedStartTime = formatTimeTo12Hour(details.startTime);
    const formattedEndTime = formatTimeTo12Hour(details.endTime);
    return `${formattedDate} (${formattedStartTime} - ${formattedEndTime})`;
  }
  // Default fallback
  return "Session";
}

/**
 * Works out, for each of the volunteer's signups, which state card to show:
 * a reminder, open check-in, attendance, processing hours, published hours,
 * a missed event, or a signup still waiting on the coordinator.
 */
export function getSignupStatuses(
  signups: Signup[],
  project: Project,
  now: Date,
  certMap: Record<string, string>,
) {
  return signups
    .map((signup) => {
      // First check if signup status is valid for processing
      // Using type-safe approach with Array.includes
      const validStatuses: Signup["status"][] = [
        "approved",
        "attended",
        "pending",
      ];
      if (!validStatuses.includes(signup.status)) {
        return null; // Skip signups that are not approved, attended, or pending
      }

      // Handle pending signups (e.g., from linked anonymous profiles)
      if (signup.status === "pending") {
        const details = getSlotDetails(project, signup.schedule_id);
        if (!details) return null; // Skip if slot details not found

        // Find the date for the slot
        let slotDate: string | undefined;
        if (project.schedule?.multiDay) {
          for (const day of project.schedule.multiDay) {
            if (day.slots.some((slot) => slot === details)) {
              slotDate = day.date;
              break;
            }
          }
        } else if (project.schedule?.oneTime) {
          slotDate = project.schedule.oneTime.date;
        } else if (project.schedule?.sameDayMultiArea) {
          slotDate = project.schedule.sameDayMultiArea.date;
        }

        if (!slotDate || !details.startTime || !details.endTime) {
          return null; // Skip if essential time info is missing
        }

        const startTime = getCombinedDateTime(slotDate, details.startTime);
        const endTime = getCombinedDateTime(slotDate, details.endTime);

        if (!startTime || !endTime) {
          return null; // Skip if dates are invalid
        }

        return {
          signup,
          slotDetails: details,
          sessionStartTime: startTime,
          sessionEndTime: endTime,
          renderState: "pendingLinked" as const,
          sessionDisplayName: getSessionDisplayName(
            project,
            startTime,
            details,
          ),
        };
      }

      const details = getSlotDetails(project, signup.schedule_id);
      if (!details) return null; // Skip if slot details not found

      // Find the date for the slot
      let slotDate: string | undefined;
      if (project.schedule?.multiDay) {
        for (const day of project.schedule.multiDay) {
          if (day.slots.some((slot) => slot === details)) {
            slotDate = day.date;
            break;
          }
        }
      } else if (project.schedule?.oneTime) {
        slotDate = project.schedule.oneTime.date;
      } else if (project.schedule?.sameDayMultiArea) {
        slotDate = project.schedule.sameDayMultiArea.date;
      }

      if (!slotDate || !details.startTime || !details.endTime) {
        return null; // Skip if essential time info is missing
      }

      const startTime = getCombinedDateTime(slotDate, details.startTime);
      const endTime = getCombinedDateTime(slotDate, details.endTime);

      // Use type-safe comparison for status
      const isAttended = signup.status === "attended";
      const isApproved = signup.status === "approved";
      const checkIn = signup.check_in_time
        ? new Date(signup.check_in_time)
        : null;
      const checkOut = signup.check_out_time
        ? new Date(signup.check_out_time)
        : null;

      if (!startTime || !endTime) {
        return null; // Skip if dates are invalid
      }

      const diffHours = differenceInHours(startTime, now);
      const diffMinutes = differenceInMinutes(startTime, now);
      const sessionOver = isAfter(now, endTime);
      const sessionInProgress =
        isAfter(now, startTime) && isBefore(now, endTime);

      // Check if we're in the post-event window (first 48 hours after event)
      const hoursSinceEnd = differenceInHours(now, endTime);
      const isInPostEventWindow =
        sessionOver && hoursSinceEnd >= 0 && hoursSinceEnd < 48;

      // Check if we're past the post-event window
      const isPastPostEventWindow = sessionOver && hoursSinceEnd >= 48;

      // --- ADDED: Check if hours are published for this specific schedule_id ---
      const areHoursPublished =
        project.published && project.published[signup.schedule_id] === true;

      // --- Check for corresponding certificate based on signup_id ---
      const certificateId = certMap[signup.id] ?? null;
      // --- END ADDED ---

      // --- For approved users who didn't attend, show no-show message after event ---
      // --- MODIFIED: Only show missedEvent if hours are NOT published ---
      if (isApproved && !isAttended && sessionOver && !areHoursPublished) {
        return {
          signup,
          slotDetails: details,
          sessionStartTime: startTime,
          sessionEndTime: endTime,
          isSessionOver: sessionOver,
          renderState: "missedEvent",
          sessionDisplayName: getSessionDisplayName(
            project,
            startTime,
            details,
          ),
          certificateId,
        };
      }

      // --- For attended users, show hours editing message during editing window ---
      // --- MODIFIED: Only show postEventHours if hours are NOT published ---
      if (isAttended && isInPostEventWindow && !areHoursPublished) {
        return {
          signup,
          slotDetails: details,
          sessionStartTime: startTime,
          sessionEndTime: endTime,
          hoursSinceEnd,
          checkInTime: checkIn,
          renderState: "postEventHours",
          sessionDisplayName: getSessionDisplayName(
            project,
            startTime,
            details,
          ),
        };
      }

      // Skip rendering if the session is over and the user never attended (and hours aren't published)
      if (sessionOver && !isAttended && !areHoursPublished) {
        return null;
      }

      // Skip rendering if the session is more than 24 hours away (unless already attended or hours published)
      if (diffHours > 24 && !isAttended && !areHoursPublished) {
        return null;
      }

      let progress = 0;
      let remainingFormatted = "";
      // Calculate progress based on check-in time if available, even if attended
      if (checkIn) {
        const checkInTimeForCalc = isAttended && !checkIn ? startTime : checkIn; // Use start time if attended but no check-in logged (fallback)
        const totalDurationMinutes = differenceInMinutes(
          endTime,
          checkInTimeForCalc,
        );
        const elapsedSinceCheckInMinutes = differenceInMinutes(
          now,
          checkInTimeForCalc,
        );
        if (totalDurationMinutes > 0) {
          progress = Math.max(
            0,
            Math.min(
              100,
              (elapsedSinceCheckInMinutes / totalDurationMinutes) * 100,
            ),
          );
        } else {
          progress = now >= endTime ? 100 : 0;
        }
        const remainingMinutes = differenceInMinutes(endTime, now);
        remainingFormatted = formatRemainingTime(remainingMinutes);
      } else if (isAttended && now >= endTime) {
        // If attended but no check-in time, show 100% progress after session ends
        progress = 100;
        remainingFormatted = "Session ended";
      }

      let untilStartFormatted = "";
      if (diffMinutes > 0) {
        untilStartFormatted = formatDistanceToNowStrict(startTime, {
          unit: diffHours >= 1 ? "hour" : "minute",
        });
      }

      // --- MODIFIED: Determine state for rendering with type-safe comparisons and published hours check ---
      let renderState:
        | "checkedIn"
        | "checkInOpen"
        | "reminder"
        | "none"
        | "postEventHours"
        | "missedEvent"
        | "hoursPublished"
        | "pendingLinked" = "none";

      if (areHoursPublished) {
        renderState = "hoursPublished"; // Highest priority if hours are published
      } else if (isAttended && isInPostEventWindow) {
        renderState = "postEventHours"; // Show processing message during the 48hr window
      } else if (isAttended) {
        renderState = "checkedIn"; // Show checked-in status (during event or after 48hrs if not published)
      } else if (isApproved) {
        // Only apply time logic if status is 'approved' and hours not published
        if (sessionOver) {
          renderState = "missedEvent"; // Show missed event if approved, session over, not attended, not published
        } else {
          const totalDurationMinutes = differenceInMinutes(endTime, startTime);
          // Check-in available: <= 2 hours before start AND before the session ends
          if (diffMinutes <= 120 && diffMinutes > -totalDurationMinutes) {
            renderState = "checkInOpen";
          }
          // Reminder state: > 2 hours before start AND <= 24 hours before start
          else if (diffMinutes > 120 && diffHours <= 24) {
            renderState = "reminder";
          }
        }
      }

      // Return all necessary data for rendering this specific signup
      return {
        signup,
        slotDetails: details,
        sessionStartTime: startTime,
        sessionEndTime: endTime,
        hoursUntilStart: diffHours,
        minutesUntilStart: diffMinutes,
        isCheckedIn: isAttended,
        checkInTime: checkIn,
        checkOutTime: checkOut,
        isSessionOver: sessionOver,
        isSessionInProgress: sessionInProgress,
        progressPercentage: progress,
        remainingTimeFormatted: remainingFormatted,
        timeUntilStartFormatted: untilStartFormatted,
        hoursSinceEnd,
        isInPostEventWindow,
        isPastPostEventWindow,
        sessionDisplayName: getSessionDisplayName(project, startTime, details),
        renderState,
        certificateId, // 🆕 include here
        areHoursPublished,
      };
    })
    .filter((status) => status !== null && status.renderState !== "none"); // Filter out nulls and 'none' state
}

export type SignupStatus = NonNullable<
  ReturnType<typeof getSignupStatuses>[number]
>;
