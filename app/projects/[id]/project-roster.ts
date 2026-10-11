import type { Project } from "@/types";
import type { SlotAttendee } from "@/components/projects/SlotAttendeesDropdown";
import { buildScheduleReadIndex } from "@/lib/projects/schedule-read-index";

export function canReadProjectRoster(project: Project, canManage: boolean) {
  return (
    canManage ||
    (project.show_attendees_publicly &&
      (project.visibility === "public" || project.visibility === "unlisted"))
  );
}

/** Groups only the rows the attendee RPC has already authorized. */
export function groupProjectRoster(
  project: Project,
  canManage: boolean,
  attendees: readonly SlotAttendee[],
) {
  const slots = new Map<string, SlotAttendee[]>();
  const previousSchedule: SlotAttendee[] = [];
  if (!canReadProjectRoster(project, canManage))
    return { slots, previousSchedule };

  const index = buildScheduleReadIndex(project);
  for (const attendee of attendees) {
    const slot = index.get(attendee.schedule_id);
    if (!slot) previousSchedule.push(attendee);
    else slots.set(slot, [...(slots.get(slot) ?? []), attendee]);
  }
  return { slots, previousSchedule };
}
