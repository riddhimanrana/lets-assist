import type { Project } from "@/types";
import {
  getAttendanceScheduleWindow,
  listAttendanceScheduleIds,
} from "@/lib/attendance/challenge";

export type RetentionProject = Pick<
  Project,
  "event_type" | "schedule" | "project_timezone" | "status"
> & {
  cancelled_at?: string | null;
};

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns the canonical project finish instant used by retention jobs.
 * Schedule dates/times are interpreted in project_timezone and overnight
 * sessions roll into the following day through the attendance window helper.
 */
export function getProjectRetentionFinishedAt(
  project: RetentionProject,
): Date | null {
  if (project.status === "cancelled") {
    return parseInstant(project.cancelled_at);
  }

  if (project.status !== "completed") {
    return null;
  }

  let latestEnd: number | null = null;
  for (const scheduleId of listAttendanceScheduleIds(project as Project)) {
    const window = getAttendanceScheduleWindow(project as Project, scheduleId);
    if (!window) continue;
    latestEnd =
      latestEnd === null ? window.endsAt : Math.max(latestEnd, window.endsAt);
  }

  return latestEnd === null ? null : new Date(latestEnd);
}
