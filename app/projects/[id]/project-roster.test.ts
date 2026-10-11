import { expect, test } from "bun:test";
import type { Project } from "@/types";
import type { SlotAttendee } from "@/components/projects/SlotAttendeesDropdown";
import { groupProjectRoster } from "./project-roster";

const project = {
  id: "fictional-project",
  event_type: "multiDay",
  status: "completed",
  workflow_status: "archived",
  visibility: "unlisted",
  show_attendees_publicly: true,
  schedule: { multiDay: [{ date: "2030-03-14", slots: [{ volunteers: 8 }] }] },
} as unknown as Project;
const row = (id: string, schedule_id: string, anonymous = false) =>
  ({
    signup_id: id,
    schedule_id,
    user_id: anonymous ? null : id,
    is_anonymous: anonymous,
    full_name: "Fictional volunteer",
    anonymous_name: anonymous ? "Fictional guest" : "",
  }) as SlotAttendee;
const rows = [
  row("own", "2030-03-14-0-0"),
  row("legacy-guest", "2030-03-14-0", true),
  row("legacy-index", "0-0"),
  row("legacy-label", "day-0-slot-0"),
  row("removed-slot", "2030-03-14-0-2"),
  row("removed-day", "2030-03-07-0-0"),
];

test("legacy and current own/other/guest rows remain visible on completed archived projects", () => {
  const grouped = groupProjectRoster(project, false, rows);
  expect(grouped.slots.get("2030-03-14-0-0")?.map((r) => r.signup_id)).toEqual([
    "own",
    "legacy-guest",
    "legacy-index",
    "legacy-label",
  ]);
  expect(grouped.previousSchedule.map((r) => r.signup_id)).toEqual([
    "removed-slot",
    "removed-day",
  ]);
  // Reads never relabel stored identities or manufacture missing rows.
  expect(rows[1].schedule_id).toBe("2030-03-14-0");
  expect(groupProjectRoster(project, false, []).slots.size).toBe(0);
});

test("organizer/admin callers retain the existing manager access; participants respect visibility", () => {
  for (const canManage of [false, true]) {
    for (const visibility of [
      "public",
      "unlisted",
      "organization_only",
    ] as const) {
      for (const show_attendees_publicly of [false, true]) {
        const grouped = groupProjectRoster(
          { ...project, visibility, show_attendees_publicly },
          canManage,
          rows,
        );
        const permitted =
          canManage ||
          (show_attendees_publicly && visibility !== "organization_only");
        expect(grouped.slots.size).toBe(permitted ? 1 : 0);
        expect(grouped.previousSchedule.length).toBe(permitted ? 2 : 0);
      }
    }
  }
});

test("a repeated date never assigns an ambiguous legacy date-only row to an arbitrary slot", () => {
  const repeated = {
    ...project,
    schedule: {
      multiDay: [project.schedule.multiDay![0], project.schedule.multiDay![0]],
    },
  };
  const grouped = groupProjectRoster(repeated, false, [
    row("ambiguous", "2030-03-14-0"),
    row("precise", "2030-03-14-1-0"),
  ]);
  expect(grouped.previousSchedule.map((r) => r.signup_id)).toEqual([
    "ambiguous",
  ]);
  expect(grouped.slots.get("2030-03-14-1-0")?.[0].signup_id).toBe("precise");
});

test("one-time and named-role projects also accept their known read aliases", () => {
  const fixtures: {
    event_type: Project["event_type"];
    schedule: Project["schedule"];
    current: string;
    legacy: string;
  }[] = [
    {
      event_type: "oneTime",
      schedule: {
        oneTime: {
          date: "2030-03-14",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 5,
        },
      },
      current: "oneTime",
      legacy: "default",
    },
    {
      event_type: "sameDayMultiArea",
      schedule: {
        sameDayMultiArea: {
          date: "2030-03-14",
          overallStart: "09:00",
          overallEnd: "12:00",
          roles: [
            {
              name: "Greeters",
              startTime: "09:00",
              endTime: "12:00",
              volunteers: 5,
            },
          ],
        },
      },
      current: "Greeters",
      legacy: "role-0",
    },
  ];
  for (const fixture of fixtures) {
    const grouped = groupProjectRoster(
      { ...project, ...fixture } as Project,
      false,
      [row("new", fixture.current), row("old", fixture.legacy)],
    );
    expect(grouped.slots.get(fixture.current)?.length).toBe(2);
    expect(grouped.previousSchedule).toEqual([]);
  }
});
