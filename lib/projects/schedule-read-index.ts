import type { Project } from "@/types";
import { getScheduleIdAliases } from "./hours-publish-key";

/** Read compatibility only: never rewrites saved signup or attendance identity. */
export function buildScheduleReadIndex(
  project: Pick<Project, "event_type" | "schedule">,
): Map<string, string | null> {
  const canonical: string[] = [];
  if (project.event_type === "oneTime" && project.schedule?.oneTime) {
    canonical.push("oneTime");
  } else if (project.event_type === "multiDay") {
    project.schedule?.multiDay?.forEach((day, dayIndex) => {
      day.slots.forEach((_, slotIndex) => {
        canonical.push(`${day.date}-${dayIndex}-${slotIndex}`);
      });
    });
  } else if (project.event_type === "sameDayMultiArea") {
    project.schedule?.sameDayMultiArea?.roles.forEach((role) => {
      canonical.push(role.name);
    });
  }

  const index = new Map<string, string | null>();
  for (const slot of canonical) {
    for (const alias of getScheduleIdAliases(project, slot)) {
      // A date-only alias can be ambiguous when a project repeats the date.
      // Keep it unmatched rather than putting a volunteer in the wrong slot.
      if (index.has(alias) && index.get(alias) !== slot) index.set(alias, null);
      else index.set(alias, slot);
    }
  }
  return index;
}
