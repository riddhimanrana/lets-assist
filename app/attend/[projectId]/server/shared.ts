import "server-only";

import { cookies } from "next/headers";
import { TZDate } from "@date-fns/tz";
import { createClient } from "@/lib/supabase/server";
import {
  getAttendancePresenceCookieName,
  verifyAttendancePresence,
} from "@/lib/attendance/challenge";
import type { Project } from "@/types";

export const CHECKOUT_CAPABILITY_GRACE_MS = 2 * 60 * 60 * 1000;
export const CHECKOUT_CAPABILITY_FALLBACK_MS = 12 * 60 * 60 * 1000;

export async function requireAttendancePresence(
  projectId: string,
  scheduleId: string,
) {
  const cookieStore = await cookies();
  const token = cookieStore.get(
    getAttendancePresenceCookieName(projectId),
  )?.value;
  return verifyAttendancePresence(token, { projectId, scheduleId });
}

type MinimalProject = Pick<
  Project,
  "event_type" | "schedule" | "project_timezone"
>;

export async function getScheduledCheckoutTime(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  scheduleId: string,
  fallbackDate: Date,
): Promise<string | null> {
  const { data: project, error } = await supabase
    .from("projects")
    .select("event_type, schedule, project_timezone")
    .eq("id", projectId)
    .single();

  if (error) {
    console.error(
      "[getScheduledCheckoutTime] Error fetching project schedule:",
      error,
    );
    return null;
  }

  if (!project) {
    console.warn(
      "[getScheduledCheckoutTime] Project not found for id:",
      projectId,
    );
    return null;
  }

  const typedProject = project as MinimalProject;
  const schedule = typedProject.schedule as Project["schedule"];
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
        // Parse date and time strings to construct TZDate numbers
        // dateStr is YYYY-MM-DD, timeStr is HH:mm
        const [year, month, day] = dateStr.split("-").map(Number);
        const [hours, minutes] = timeStr.split(":").map(Number);
        // Note: month is 0-indexed in Date constructors
        return new TZDate(year, month - 1, day, hours, minutes, 0, timezone);
      }

      const [hours, minutes] = timeStr.split(":").map(Number);
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      date.setHours(hours, minutes, 0, 0);
      return date;
    } catch (err) {
      console.error(
        "[getScheduledCheckoutTime] Failed to build datetime:",
        err,
      );
      return null;
    }
  };

  let endDate: Date | null = null;

  if (typedProject.event_type === "oneTime" && schedule.oneTime) {
    endDate = toDateTime(schedule.oneTime.date, schedule.oneTime.endTime);
  } else if (typedProject.event_type === "multiDay" && schedule.multiDay) {
    const { getMultiDaySlotByScheduleId } = await import("@/utils/project");
    const slotData = getMultiDaySlotByScheduleId(
      typedProject as unknown as Project,
      scheduleId,
    );

    if (slotData) {
      endDate = toDateTime(slotData.day.date, slotData.slot.endTime);
    }
  } else if (
    typedProject.event_type === "sameDayMultiArea" &&
    schedule.sameDayMultiArea
  ) {
    const roleByName = schedule.sameDayMultiArea.roles.find(
      (role) => role.name === scheduleId,
    );
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
