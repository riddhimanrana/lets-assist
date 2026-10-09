"use client";

import { useMemo } from "react";
import type { Project } from "@/types";
import { getPublishStateKey } from "@/lib/projects/hours-publish-key";
import { summarizeAttendanceHours } from "@/lib/projects/attendance-hours-summary";
import { inspectAttendanceIntervals } from "@/lib/projects/paper-signup/intervals";
import { getMultiDaySlotDisplayName } from "@/utils/project";
import {
  certificateOf,
  creditedMinutes,
  emailOf,
  hoursPublicationEntries,
  nameOf,
  savedDraft,
  type AttendanceHoursSignup,
  type HoursWindows,
  type HoursWindow,
} from "./useHoursAttendance";

export type HoursSession = {
  id: string;
  scheduleId: string;
  name: string;
  status: "upcoming" | "in-progress" | "completed" | "invalid";
  window: HoursWindow | null;
  attendees: AttendanceHoursSignup[];
  visibleAttendees: AttendanceHoursSignup[];
  published: boolean;
  readyCount: number;
  pendingCount: number;
  summary: ReturnType<typeof summarizeAttendanceHours>;
};

/** Shows a stored YYYY-MM-DD schedule day as "Sat, Dec 5, 2026" without shifting it across timezones. */
function formatSessionDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function buildHoursSessions({
  project,
  signups,
  windows,
  searchTerm,
  now,
}: {
  project: Project;
  signups: AttendanceHoursSignup[];
  windows: HoursWindows;
  searchTerm: string;
  now: number;
}): HoursSession[] {
  const groups = new Map<
    string,
    { scheduleId: string; name: string; attendees: AttendanceHoursSignup[] }
  >();
  const add = (scheduleId: string, name: string) => {
    const key = getPublishStateKey(project, scheduleId);
    if (!groups.has(key)) groups.set(key, { scheduleId, name, attendees: [] });
  };
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    add(
      "oneTime",
      `Main session · ${formatSessionDay(project.schedule.oneTime.date)}`,
    );
  } else if (project.event_type === "multiDay") {
    for (const [dayIndex, day] of (project.schedule.multiDay ?? []).entries()) {
      for (const [slotIndex, slot] of day.slots.entries()) {
        add(
          `${day.date}-${dayIndex}-${slotIndex}`,
          `${formatSessionDay(day.date)}: ${getMultiDaySlotDisplayName(slot, slotIndex)}`,
        );
      }
    }
  } else if (project.event_type === "sameDayMultiArea") {
    for (const role of project.schedule.sameDayMultiArea?.roles ?? [])
      add(role.name, role.name);
  }
  for (const signup of signups) {
    add(signup.schedule_id, signup.schedule_id);
    groups
      .get(getPublishStateKey(project, signup.schedule_id))!
      .attendees.push(signup);
  }
  const search = searchTerm.trim().toLowerCase();
  return [...groups.entries()].map(([id, group]) => {
    const window = windows[id] ?? null;
    const { attendees } = group;
    return {
      id,
      ...group,
      window,
      status: !window
        ? "invalid"
        : now < window.startsAt
          ? "upcoming"
          : now < window.endsAt
            ? "in-progress"
            : "completed",
      published: Boolean(
        project.published?.[id] ||
        (attendees.length > 0 && attendees.every(certificateOf)),
      ),
      visibleAttendees: attendees.filter((signup) =>
        `${nameOf(signup)} ${emailOf(signup)}`.toLowerCase().includes(search),
      ),
      readyCount: hoursPublicationEntries(attendees, window).length,
      pendingCount: attendees.filter((signup) => !certificateOf(signup)).length,
      summary: summarizeAttendanceHours(
        attendees.map((signup) => ({
          creditedMinutes: creditedMinutes(signup),
          recordedMinutes: inspectAttendanceIntervals(
            savedDraft(signup).intervals,
          ).minutes,
        })),
      ),
    };
  });
}

export function useHoursSessions(
  input: Omit<Parameters<typeof buildHoursSessions>[0], "now">,
) {
  const { project, signups, windows, searchTerm } = input;
  return useMemo(
    () =>
      buildHoursSessions({
        project,
        signups,
        windows,
        searchTerm,
        now: Date.now(),
      }),
    [project, signups, windows, searchTerm],
  );
}
