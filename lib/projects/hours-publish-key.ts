import type { Project } from "@/types";

type ScheduleShape = {
  multiDay?: Array<{ date?: string; slots?: unknown[] }>;
  sameDayMultiArea?: { roles?: Array<{ name?: string }> };
};

/** Mirrors private.project_hours_publish_key for every supported stored alias. */
export function getPublishStateKey(
  project: Pick<Project, "event_type" | "schedule">,
  scheduleId: string,
): string {
  const schedule = (project.schedule ?? {}) as ScheduleShape;

  if (
    project.event_type === "oneTime" &&
    ["oneTime", "0", "default"].includes(scheduleId)
  ) {
    return "oneTime";
  }

  if (project.event_type === "multiDay" && Array.isArray(schedule.multiDay)) {
    for (const [dayIndex, day] of schedule.multiDay.entries()) {
      if (!day.date || !Array.isArray(day.slots)) continue;
      for (const slotIndex of day.slots.keys()) {
        const canonicalKey = `${day.date}-${slotIndex}`;
        if (
          [
            `${day.date}-${dayIndex}-${slotIndex}`,
            `${dayIndex}-${slotIndex}`,
            canonicalKey,
            `day-${dayIndex}-slot-${slotIndex}`,
          ].includes(scheduleId)
        ) {
          return canonicalKey;
        }
      }
    }
  }

  if (
    project.event_type === "sameDayMultiArea" &&
    Array.isArray(schedule.sameDayMultiArea?.roles)
  ) {
    for (const [roleIndex, role] of schedule.sameDayMultiArea.roles.entries()) {
      if (
        role.name &&
        (scheduleId === role.name || scheduleId === `role-${roleIndex}`)
      ) {
        return role.name;
      }
    }
  }

  return scheduleId;
}
