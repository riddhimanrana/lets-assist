import { describe, expect, test } from "bun:test";
import type { Project } from "@/types";
import {
  getAvailableMultiDaySlots,
  getProjectEndDateTime,
  getProjectStartDateTime,
  getProjectStatus,
  isForwardProjectStatusTransition,
} from "./project";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Synthetic project",
    description: "Synthetic schedule fixture",
    location: "Test location",
    event_type: "oneTime",
    verification_method: "manual",
    require_login: true,
    creator_id: "00000000-0000-4000-8000-000000000002",
    schedule: {
      oneTime: {
        date: "2026-08-29",
        startTime: "10:00",
        endTime: "12:00",
        volunteers: 4,
      },
    },
    status: "upcoming",
    visibility: "public",
    pause_signups: false,
    profiles: {} as Project["profiles"],
    created_at: "2026-08-01T00:00:00.000Z",
    project_timezone: "America/Los_Angeles",
    workflow_status: "published",
    ...overrides,
  };
}

describe("project lifecycle status", () => {
  test("uses the project timezone for one-time boundaries", () => {
    const fixture = project();

    expect(getProjectStartDateTime(fixture).getTime()).toBe(
      new Date("2026-08-29T17:00:00.000Z").getTime(),
    );
    expect(
      getProjectStatus(fixture, new Date("2026-08-29T16:30:00.000Z")),
    ).toBe("upcoming");
    expect(
      getProjectStatus(fixture, new Date("2026-08-29T17:30:00.000Z")),
    ).toBe("in-progress");
  });

  test("keeps a multi-day project in progress between its first and last sessions", () => {
    const fixture = project({
      event_type: "multiDay",
      schedule: {
        multiDay: [
          {
            date: "2026-08-22",
            slots: [{ startTime: "10:00", endTime: "12:30", volunteers: 6 }],
          },
          {
            date: "2026-08-29",
            slots: [{ startTime: "10:00", endTime: "12:30", volunteers: 4 }],
          },
        ],
      },
      status: "in-progress",
    });

    expect(
      getProjectStatus(fixture, new Date("2026-08-26T19:00:00.000Z")),
    ).toBe("in-progress");
  });

  test("ignores blank legacy slots when finding the final session", () => {
    const fixture = project({
      event_type: "multiDay",
      schedule: {
        multiDay: [
          {
            date: "2026-07-26",
            slots: [{ startTime: "14:00", endTime: "17:00", volunteers: 3 }],
          },
          {
            date: "2026-07-25",
            slots: [
              { startTime: "13:00", endTime: "15:30", volunteers: 8 },
              { startTime: "", endTime: "", volunteers: 0 },
            ],
          },
          {
            date: "2026-06-24",
            slots: [{ startTime: "19:00", endTime: "20:30", volunteers: 2 }],
          },
        ],
      },
    });
    const afterProject = new Date("2026-08-26T19:00:00.000Z");

    expect(getProjectStartDateTime(fixture).getTime()).toBe(
      new Date("2026-06-25T02:00:00.000Z").getTime(),
    );
    expect(getProjectEndDateTime(fixture).getTime()).toBe(
      new Date("2026-07-27T00:00:00.000Z").getTime(),
    );
    expect(getProjectStatus(fixture, afterProject)).toBe("completed");
    expect(getAvailableMultiDaySlots(fixture, afterProject)).toEqual([]);
  });

  test("only persists forward lifecycle transitions", () => {
    expect(isForwardProjectStatusTransition("upcoming", "in-progress")).toBe(
      true,
    );
    expect(isForwardProjectStatusTransition("upcoming", "completed")).toBe(
      true,
    );
    expect(isForwardProjectStatusTransition("in-progress", "completed")).toBe(
      true,
    );
    expect(isForwardProjectStatusTransition("in-progress", "upcoming")).toBe(
      false,
    );
    expect(isForwardProjectStatusTransition("completed", "upcoming")).toBe(
      false,
    );
    expect(isForwardProjectStatusTransition("cancelled", "completed")).toBe(
      false,
    );
  });
});
