import type { Project } from "@/types";
import {
  getAttendanceScheduleWindow,
  listAttendanceScheduleIds,
} from "@/lib/attendance/challenge";

/** Uses the same project-timezone instants as attendance challenges. */
export function getProjectAttendanceAvailability(
  project: Project,
  now: Date = new Date(),
): { isActive: boolean; earliestTime?: string } {
  let earliestStart: number | undefined;
  for (const scheduleId of listAttendanceScheduleIds(project)) {
    const window = getAttendanceScheduleWindow(project, scheduleId);
    if (!window) continue;
    earliestStart =
      earliestStart === undefined
        ? window.startsAt
        : Math.min(earliestStart, window.startsAt);
  }

  if (earliestStart === undefined) return { isActive: false };
  return {
    isActive: now.getTime() >= earliestStart - 2 * 60 * 60 * 1000,
    earliestTime: new Date(earliestStart).toISOString(),
  };
}
