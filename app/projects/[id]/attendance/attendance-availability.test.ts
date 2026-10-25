import { describe, expect, test } from "bun:test";
import type { Project } from "@/types";
import { getProjectAttendanceAvailability } from "./attendance-availability";
import { formatAttendanceStartTime } from "./attendance-format";

function project(
  eventType: Project["event_type"] = "oneTime",
  overrides: Partial<Project> = {},
): Project {
  const session = {
    startTime: "09:00",
    endTime: "13:00",
    volunteers: 25,
  };
  return {
    event_type: eventType,
    project_timezone: "America/Los_Angeles",
    schedule: {
      oneTime: { date: "2026-12-05", ...session },
      multiDay: [{ date: "2026-12-05", slots: [session] }],
      sameDayMultiArea: {
        date: "2026-12-05",
        roles: [{ name: "Cleanup", ...session }],
      },
    },
    ...overrides,
  } as Project;
}

describe("project attendance availability", () => {
  for (const kind of ["oneTime", "multiDay", "sameDayMultiArea"] as const) {
    test(`${kind} stays closed until two hours before the Pacific start`, () => {
      const row = project(kind);
      expect(
        getProjectAttendanceAvailability(
          row,
          new Date("2026-12-05T14:59:59.999Z"),
        ),
      ).toEqual({ isActive: false, earliestTime: "2026-12-05T17:00:00.000Z" });
      expect(
        getProjectAttendanceAvailability(row, new Date("2026-12-05T15:00Z")),
      ).toEqual({ isActive: true, earliestTime: "2026-12-05T17:00:00.000Z" });
    });
  }

  test("uses the earliest valid session even when days are unordered", () => {
    const row = project("multiDay", {
      schedule: {
        multiDay: [
          {
            date: "2026-12-06",
            slots: [{ startTime: "08:00", endTime: "10:00", volunteers: 5 }],
          },
          {
            date: "2026-12-05",
            slots: [{ startTime: "09:00", endTime: "13:00", volunteers: 5 }],
          },
        ],
      },
    });
    expect(
      getProjectAttendanceAvailability(row, new Date("2026-12-05T15:00Z")),
    ).toEqual({ isActive: true, earliestTime: "2026-12-05T17:00:00.000Z" });
  });

  test("a literal role-0 starting first takes precedence over the first role alias", () => {
    const row = project("sameDayMultiArea", {
      schedule: {
        sameDayMultiArea: {
          date: "2026-12-05",
          overallStart: "09:00",
          overallEnd: "15:00",
          roles: [
            {
              name: "Setup",
              startTime: "13:00",
              endTime: "15:00",
              volunteers: 5,
            },
            {
              name: "role-0",
              startTime: "09:00",
              endTime: "11:00",
              volunteers: 5,
            },
          ],
        },
      },
    });
    expect(
      getProjectAttendanceAvailability(
        row,
        new Date("2026-12-05T14:59:59.999Z"),
      ),
    ).toEqual({ isActive: false, earliestTime: "2026-12-05T17:00:00.000Z" });
    expect(
      getProjectAttendanceAvailability(row, new Date("2026-12-05T15:00Z")),
    ).toEqual({ isActive: true, earliestTime: "2026-12-05T17:00:00.000Z" });
  });

  test("uses the project summer offset and preserves a date across UTC midnight", () => {
    const row = project("oneTime", {
      project_timezone: "Pacific/Auckland",
      schedule: {
        oneTime: {
          date: "2026-12-05",
          startTime: "09:00",
          endTime: "13:00",
          volunteers: 5,
        },
      },
    });
    expect(
      getProjectAttendanceAvailability(row, new Date("2026-12-04T18:00Z")),
    ).toEqual({ isActive: true, earliestTime: "2026-12-04T20:00:00.000Z" });
  });

  test("defaults a legacy missing timezone to Pacific", () => {
    const row = project("oneTime", { project_timezone: undefined });
    expect(
      getProjectAttendanceAvailability(row, new Date("2026-12-05T10:00Z")),
    ).toEqual({ isActive: false, earliestTime: "2026-12-05T17:00:00.000Z" });
  });

  test("does not open invalid timezone, invalid date, or DST-gap schedules", () => {
    const invalidRows = [
      project("oneTime", { project_timezone: "Invalid/Zone" }),
      project("oneTime", {
        schedule: {
          oneTime: {
            date: "2026-02-30",
            startTime: "09:00",
            endTime: "13:00",
            volunteers: 5,
          },
        },
      }),
      project("oneTime", {
        schedule: {
          oneTime: {
            date: "2026-03-08",
            startTime: "02:30",
            endTime: "04:00",
            volunteers: 5,
          },
        },
      }),
      project("oneTime", { schedule: {} }),
    ];
    for (const row of invalidRows) {
      expect(
        getProjectAttendanceAvailability(row, new Date("2027-01-01T00:00Z")),
      ).toEqual({ isActive: false });
    }
  });

  test("does not open when the comparison clock is invalid", () => {
    expect(
      getProjectAttendanceAvailability(project(), new Date("invalid")).isActive,
    ).toBe(false);
  });
});

describe("attendance session start label", () => {
  test("names the project zone instead of the viewer or server zone", () => {
    expect(
      formatAttendanceStartTime(
        new Date("2026-12-05T17:00Z"),
        "America/Los_Angeles",
      ),
    ).toBe("December 5, 2026 at 9:00 AM PST");
    expect(
      formatAttendanceStartTime(
        new Date("2026-07-05T16:00Z"),
        "America/Los_Angeles",
      ),
    ).toBe("July 5, 2026 at 9:00 AM PDT");
  });

  test("keeps the project date when the instant falls on the previous UTC day", () => {
    expect(
      formatAttendanceStartTime(
        new Date("2026-12-04T20:00Z"),
        "Pacific/Auckland",
      ),
    ).toContain("December 5, 2026 at 9:00 AM");
  });

  test("uses Pacific for legacy rows and omits invalid display inputs", () => {
    expect(formatAttendanceStartTime(new Date("2026-12-05T17:00Z"))).toBe(
      "December 5, 2026 at 9:00 AM PST",
    );
    expect(formatAttendanceStartTime(new Date("invalid"), "UTC")).toBeNull();
    expect(
      formatAttendanceStartTime(new Date("2026-12-05T17:00Z"), "Invalid/Zone"),
    ).toBeNull();
  });
});
