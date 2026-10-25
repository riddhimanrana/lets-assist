import { differenceInHours, format, isAfter, parseISO } from "date-fns";

import type { Project } from "@/types";
import type { Signup } from "@/types/signup";

export type CreatorDashboardSignupSummary = Pick<
  Signup,
  "id" | "schedule_id" | "status" | "check_in_time"
>;

export interface UnpublishedSession {
  id: string;
  name: string;
  hoursRemaining: number;
  attendedCount: number;
}

/**
 * Sessions that ended within the last 48 hours, had attendance, and whose
 * hours are not published yet. These are the ones an organizer can still edit.
 */
export function getActiveUnpublishedSessions(
  project: Project,
  allSignups: CreatorDashboardSignupSummary[],
  now: Date,
): UnpublishedSession[] {
  // --- Helper function to get the key used in the 'published' object ---
  const getPublishStateKey = (sessionId: string): string => {
    if (project.event_type === "oneTime" && sessionId === "oneTime") {
      return "oneTime";
    } else if (project.event_type === "multiDay") {
      const parts = sessionId.split("-");
      if (parts.length === 5) {
        // New format: YYYY-MM-DD-dayIndex-slotIndex
        const dateKey = `${parts[0]}-${parts[1]}-${parts[2]}`;
        const slotIndex = parts[4];
        return `${dateKey}-${slotIndex}`;
      } else if (parts.length === 4) {
        // Legacy format: YYYY-MM-DD-slotIndex
        return sessionId;
      }

      const match = sessionId.match(/day-(\d+)-slot-(\d+)/);
      if (match && project.schedule.multiDay) {
        const dayIndex = parseInt(match[1], 10);
        const slotIndex = parseInt(match[2], 10);
        const dateKey = project.schedule.multiDay[dayIndex]?.date;
        return dateKey ? `${dateKey}-${slotIndex}` : sessionId;
      }
      return sessionId;
    } else if (project.event_type === "sameDayMultiArea") {
      // For sameDayMultiArea, the session ID passed to this function might be role-${index}
      // but the actual key in 'published' is the role name. We need the role name from the session list.
      // This helper might need adjustment depending on where it's called, or we filter based on the session object directly.
      // Let's assume the session object with the name is available where filtering happens.
      // If called with just the ID like 'role-0', we need to look up the name.
      const match = sessionId.match(/role-(\d+)/);
      if (match && project.schedule.sameDayMultiArea?.roles) {
        const roleIndex = parseInt(match[1], 10);
        const roleName =
          project.schedule.sameDayMultiArea.roles[roleIndex]?.name;
        return roleName || sessionId; // Use role name if found
      }
      // If the sessionId is already the role name (as used in HoursClient), return it directly
      if (
        project.schedule.sameDayMultiArea?.roles.some(
          (r) => r.name === sessionId,
        )
      ) {
        return sessionId;
      }
    }
    return sessionId; // Fallback
  };
  // --- End Helper ---
  const result: {
    id: string;
    name: string;
    hoursRemaining: number;
    attendedCount: number;
  }[] = [];
  const publishedKeys = project.published || {};

  // Helper to get number of people who attended a session (status 'attended')
  const getAttendedCount = (sessionIds: string[]): number => {
    // FIX: Use attended count instead of total signups count
    return allSignups.filter(
      (signup) =>
        signup.status === "attended" && sessionIds.includes(signup.schedule_id),
    ).length;
  };

  // Check one-time events
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    const date = parseISO(project.schedule.oneTime.date);
    const [hours, minutes] = project.schedule.oneTime.endTime
      .split(":")
      .map(Number);
    const sessionEndTime = new Date(new Date(date).setHours(hours, minutes));
    const hoursSinceEnd = differenceInHours(now, sessionEndTime);
    const sessionId = "oneTime";
    const publishKey = getPublishStateKey(sessionId);

    // We use multiple alternative IDs for oneTime just in case
    const sessionIds = ["oneTime", "0", "default"];
    const attendedCount = getAttendedCount(sessionIds);

    // Only count sessions where people actually attended, unless it's a special requirement
    if (
      isAfter(now, sessionEndTime) &&
      hoursSinceEnd >= 0 &&
      hoursSinceEnd < 48 &&
      !publishedKeys[publishKey] &&
      attendedCount > 0
    ) {
      result.push({
        id: sessionId,
        name: `Event on ${format(date, "MMM d")}`,
        hoursRemaining: 48 - hoursSinceEnd,
        attendedCount,
      });
    }
  }

  // Check multi-day events
  else if (project.event_type === "multiDay" && project.schedule.multiDay) {
    project.schedule.multiDay.forEach((day, dayIndex) => {
      const dayDate = parseISO(day.date);

      day.slots.forEach((slot, slotIndex) => {
        const [hours, minutes] = slot.endTime.split(":").map(Number);
        const slotEndTime = new Date(
          new Date(dayDate).setHours(hours, minutes),
        );
        const hoursSinceEnd = differenceInHours(now, slotEndTime);
        const sessionId = `${day.date}-${dayIndex}-${slotIndex}`;
        const publishKey = getPublishStateKey(sessionId);

        // IDs used in multi-day scheduling
        const simplifiedId = `${dayIndex}-${slotIndex}`;
        const dateString = format(dayDate, "yyyy-MM-dd");
        const dateBasedId = `${dateString}-${slotIndex}`;
        const uniqueId = `${dateString}-${dayIndex}-${slotIndex}`;
        const sessionIds = [sessionId, simplifiedId, dateBasedId, uniqueId];
        const attendedCount = getAttendedCount(sessionIds);

        if (
          isAfter(now, slotEndTime) &&
          hoursSinceEnd >= 0 &&
          hoursSinceEnd < 48 &&
          !publishedKeys[publishKey] &&
          attendedCount > 0
        ) {
          result.push({
            id: sessionId,
            name: `${format(dayDate, "MMM d")} (${slot.startTime} - ${slot.endTime})`,
            hoursRemaining: 48 - hoursSinceEnd,
            attendedCount,
          });
        }
      });
    });
  }

  // Check same-day multi-area events
  else if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    const date = parseISO(project.schedule.sameDayMultiArea.date);

    project.schedule.sameDayMultiArea.roles.forEach((role) => {
      const [hours, minutes] = role.endTime.split(":").map(Number);
      const roleEndTime = new Date(new Date(date).setHours(hours, minutes));
      const hoursSinceEnd = differenceInHours(now, roleEndTime);
      const sessionId = role.name;
      const publishKey = sessionId;

      // For sameDayMultiArea, the schedule_id is usually role.name
      const sessionIds = [sessionId];
      const attendedCount = getAttendedCount(sessionIds);

      if (
        isAfter(now, roleEndTime) &&
        hoursSinceEnd >= 0 &&
        hoursSinceEnd < 48 &&
        !publishedKeys[publishKey] &&
        attendedCount > 0
      ) {
        result.push({
          id: sessionId,
          name: `${role.name} (${role.startTime} - ${role.endTime})`,
          hoursRemaining: 48 - hoursSinceEnd,
          attendedCount,
        });
      }
    });
  }

  return result;
}
