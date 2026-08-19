import { describe, expect, test } from "bun:test";

import {
  FEEDBACK_BACKFILL_GUARD_MS,
  FEEDBACK_ELIGIBILITY_FLOOR_MS,
  FEEDBACK_PUBLISH_BACKSTOP_MS,
  getFeedbackEligibleAt,
  type FeedbackEligibilityProject,
} from "./feedback-eligibility";

const HOUR = 60 * 60 * 1000;

function oneTimeProject(
  overrides: Partial<FeedbackEligibilityProject> = {},
): FeedbackEligibilityProject {
  return {
    event_type: "oneTime",
    status: "completed",
    project_timezone: "America/Los_Angeles",
    schedule: {
      oneTime: {
        date: "2026-06-15",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 10,
      },
    },
    ...overrides,
  } as FeedbackEligibilityProject;
}

// 2026-06-15 12:00 America/Los_Angeles (PDT, UTC-7) = 19:00 UTC.
const FINISHED_MS = Date.UTC(2026, 5, 15, 19, 0, 0);

describe("getFeedbackEligibleAt", () => {
  test("cancelled projects are never eligible", () => {
    expect(
      getFeedbackEligibleAt({
        project: oneTimeProject({
          status: "cancelled",
          cancelled_at: "2026-06-10T00:00:00Z",
        }),
        allAttendedSlotsPublished: true,
        now: FINISHED_MS + 48 * HOUR,
      }),
    ).toBeNull();
  });

  test("incomplete projects are never eligible", () => {
    expect(
      getFeedbackEligibleAt({
        project: oneTimeProject({ status: "upcoming" }),
        allAttendedSlotsPublished: true,
        now: FINISHED_MS + 48 * HOUR,
      }),
    ).toBeNull();
  });

  test("holds for 24 hours after the timezone-correct finish instant", () => {
    const project = oneTimeProject();
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: true,
        now: FINISHED_MS + FEEDBACK_ELIGIBILITY_FLOOR_MS - 1,
      }),
    ).toBeNull();
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: true,
        now: FINISHED_MS + FEEDBACK_ELIGIBILITY_FLOOR_MS + 1,
      })?.getTime(),
    ).toBe(FINISHED_MS + FEEDBACK_ELIGIBILITY_FLOOR_MS);
  });

  test("waits for published hours until the 96h backstop", () => {
    const project = oneTimeProject();
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: false,
        now: FINISHED_MS + 48 * HOUR,
      }),
    ).toBeNull();
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: false,
        now: FINISHED_MS + FEEDBACK_PUBLISH_BACKSTOP_MS + 1,
      }),
    ).not.toBeNull();
  });

  test("the 30-day backfill guard blocks ancient projects", () => {
    const project = oneTimeProject();
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: true,
        now: FINISHED_MS + FEEDBACK_BACKFILL_GUARD_MS + 1,
      }),
    ).toBeNull();
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: true,
        now: FINISHED_MS + FEEDBACK_BACKFILL_GUARD_MS - HOUR,
      }),
    ).not.toBeNull();
  });

  test("multiDay eligibility keys off the latest slot end across DST", () => {
    // Ends 2026-11-01, the US fall-back day (25 local hours).
    const project = {
      event_type: "multiDay",
      status: "completed",
      project_timezone: "America/Los_Angeles",
      schedule: {
        multiDay: [
          {
            date: "2026-10-31",
            slots: [{ startTime: "09:00", endTime: "12:00", volunteers: 5 }],
          },
          {
            date: "2026-11-01",
            slots: [{ startTime: "09:00", endTime: "15:00", volunteers: 5 }],
          },
        ],
      },
    } as unknown as FeedbackEligibilityProject;

    // 2026-11-01 15:00 PST (UTC-8, after fall-back) = 23:00 UTC.
    const finished = Date.UTC(2026, 10, 1, 23, 0, 0);
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: true,
        now: finished + FEEDBACK_ELIGIBILITY_FLOOR_MS + 1,
      })?.getTime(),
    ).toBe(finished + FEEDBACK_ELIGIBILITY_FLOOR_MS);
  });

  test("sameDayMultiArea uses the latest role end", () => {
    const project = {
      event_type: "sameDayMultiArea",
      status: "completed",
      project_timezone: "America/New_York",
      schedule: {
        sameDayMultiArea: {
          date: "2026-06-15",
          overallStart: "09:00",
          overallEnd: "17:00",
          roles: [
            {
              name: "Setup",
              startTime: "09:00",
              endTime: "11:00",
              volunteers: 3,
            },
            {
              name: "Cleanup",
              startTime: "15:00",
              endTime: "17:00",
              volunteers: 3,
            },
          ],
        },
      },
    } as unknown as FeedbackEligibilityProject;

    // 17:00 America/New_York (EDT, UTC-4) = 21:00 UTC.
    const finished = Date.UTC(2026, 5, 15, 21, 0, 0);
    expect(
      getFeedbackEligibleAt({
        project,
        allAttendedSlotsPublished: true,
        now: finished + FEEDBACK_ELIGIBILITY_FLOOR_MS + 1,
      })?.getTime(),
    ).toBe(finished + FEEDBACK_ELIGIBILITY_FLOOR_MS);
  });
});
