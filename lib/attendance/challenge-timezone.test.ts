import { describe, expect, test } from "bun:test";

import {
  getAttendanceScheduleWindow,
  listAttendanceScheduleIds,
} from "./challenge";
import type { Project } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oneTimeProject(
  overrides: Partial<Project> = {},
): Project {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Test Project",
    description: "",
    location: "",
    event_type: "oneTime",
    verification_method: "qr-code",
    require_login: false,
    creator_id: "00000000-0000-0000-0000-000000000002",
    schedule: {
      oneTime: {
        date: "2026-09-15",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 10,
      },
    },
    status: "upcoming",
    visibility: "unlisted",
    pause_signups: false,
    profiles: {} as Project["profiles"],
    created_at: "2026-01-01T00:00:00Z",
    project_timezone: "America/Los_Angeles",
    ...overrides,
  } as Project;
}

// ---------------------------------------------------------------------------
// getAttendanceScheduleWindow — invalid timezone
// ---------------------------------------------------------------------------

describe("getAttendanceScheduleWindow — timezone handling", () => {
  test("returns null for an invalid IANA timezone (never throws)", () => {
    const project = oneTimeProject({ project_timezone: "Invalid/Zone" });
    // Must not throw; must return null so attendance window never silently opens.
    const result = getAttendanceScheduleWindow(project, "oneTime");
    expect(result).toBeNull();
  });

  test("returns null for a clearly bogus timezone string", () => {
    const project = oneTimeProject({ project_timezone: "NOTREAL" });
    const result = getAttendanceScheduleWindow(project, "oneTime");
    expect(result).toBeNull();
  });

  test("returns a valid window for UTC", () => {
    const project = oneTimeProject({ project_timezone: "UTC" });
    const window = getAttendanceScheduleWindow(project, "oneTime");
    expect(window).not.toBeNull();
    if (window) {
      // 2026-09-15 09:00 UTC → 1758045600000 (exact epoch ms)
      expect(window.startsAt).toBe(Date.UTC(2026, 8, 15, 9, 0, 0));
      expect(window.endsAt).toBe(Date.UTC(2026, 8, 15, 12, 0, 0));
      expect(window.endsAt).toBeGreaterThan(window.startsAt);
    }
  });

  test("returns a valid window for America/New_York (DST-observing zone)", () => {
    // 2026-09-15 is in US EDT (UTC-4).
    // 09:00 EDT = 13:00 UTC
    const project = oneTimeProject({ project_timezone: "America/New_York" });
    const window = getAttendanceScheduleWindow(project, "oneTime");
    expect(window).not.toBeNull();
    if (window) {
      expect(window.startsAt).toBe(Date.UTC(2026, 8, 15, 13, 0, 0));
      expect(window.endsAt).toBe(Date.UTC(2026, 8, 15, 16, 0, 0));
      expect(window.endsAt).toBeGreaterThan(window.startsAt);
    }
  });

  test("returns a valid window for America/Los_Angeles (PST/PDT)", () => {
    // 2026-09-15 is in US PDT (UTC-7).
    // 09:00 PDT = 16:00 UTC
    const project = oneTimeProject({ project_timezone: "America/Los_Angeles" });
    const window = getAttendanceScheduleWindow(project, "oneTime");
    expect(window).not.toBeNull();
    if (window) {
      expect(window.startsAt).toBe(Date.UTC(2026, 8, 15, 16, 0, 0));
      expect(window.endsAt).toBe(Date.UTC(2026, 8, 15, 19, 0, 0));
    }
  });

  test("invalid timezone makes scheduleIds still list correctly", () => {
    // listAttendanceScheduleIds is pure and does not use timezone.
    const project = oneTimeProject({ project_timezone: "Bogus/Zone" });
    const ids = listAttendanceScheduleIds(project);
    expect(ids).toEqual(["oneTime"]);
  });

  test("window for valid zone has endsAt > startsAt (not NaN)", () => {
    const project = oneTimeProject({ project_timezone: "Europe/London" });
    const window = getAttendanceScheduleWindow(project, "oneTime");
    expect(window).not.toBeNull();
    if (window) {
      expect(Number.isNaN(window.startsAt)).toBe(false);
      expect(Number.isNaN(window.endsAt)).toBe(false);
      expect(window.endsAt).toBeGreaterThan(window.startsAt);
    }
  });

  test("overnight slot rolls forward correctly for valid timezone", () => {
    const project = oneTimeProject({
      project_timezone: "UTC",
      schedule: {
        oneTime: {
          date: "2026-09-15",
          startTime: "22:00",
          endTime: "02:00",
          volunteers: 5,
        },
      },
    });
    const window = getAttendanceScheduleWindow(project, "oneTime");
    expect(window).not.toBeNull();
    if (window) {
      const startUtc = Date.UTC(2026, 8, 15, 22, 0, 0);
      const endUtc = Date.UTC(2026, 8, 16, 2, 0, 0);
      expect(window.startsAt).toBe(startUtc);
      expect(window.endsAt).toBe(endUtc);
    }
  });
});
