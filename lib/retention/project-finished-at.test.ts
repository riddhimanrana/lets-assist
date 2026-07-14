import assert from "node:assert/strict";
import test from "node:test";

import { getProjectRetentionFinishedAt } from "./project-finished-at";

test("uses the project timezone and rolls an overnight session forward", () => {
  const finishedAt = getProjectRetentionFinishedAt({
    status: "completed",
    event_type: "oneTime",
    project_timezone: "America/Los_Angeles",
    schedule: {
      oneTime: {
        date: "2026-07-11",
        startTime: "22:00",
        endTime: "01:00",
        volunteers: 5,
      },
    },
  });

  assert.equal(finishedAt?.toISOString(), "2026-07-12T08:00:00.000Z");
});

test("uses the latest slot across a multi-day schedule", () => {
  const finishedAt = getProjectRetentionFinishedAt({
    status: "completed",
    event_type: "multiDay",
    project_timezone: "America/New_York",
    schedule: {
      multiDay: [
        {
          date: "2026-07-10",
          slots: [{ name: "Early", startTime: "09:00", endTime: "10:00", volunteers: 2 }],
        },
        {
          date: "2026-07-12",
          slots: [{ name: "Late", startTime: "20:00", endTime: "22:30", volunteers: 2 }],
        },
      ],
    },
  });

  assert.equal(finishedAt?.toISOString(), "2026-07-13T02:30:00.000Z");
});

test("uses the authoritative cancellation instant", () => {
  const finishedAt = getProjectRetentionFinishedAt({
    status: "cancelled",
    cancelled_at: "2026-07-11T18:30:00.000Z",
    event_type: "oneTime",
    project_timezone: "Asia/Tokyo",
    schedule: {},
  });

  assert.equal(finishedAt?.toISOString(), "2026-07-11T18:30:00.000Z");
});
