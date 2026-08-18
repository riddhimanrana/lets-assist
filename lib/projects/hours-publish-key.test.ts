import assert from "node:assert/strict";
import test from "node:test";

import { getPublishStateKey } from "./hours-publish-key";

test("multi-day aliases share the database canonical key", () => {
  const project = {
    event_type: "multiDay" as const,
    schedule: {
      multiDay: [
        {
          date: "2030-08-18",
          slots: [
            { startTime: "09:00", endTime: "11:00", volunteers: 5 },
            { startTime: "12:00", endTime: "14:00", volunteers: 5 },
          ],
        },
      ],
    },
  };

  for (const alias of [
    "2030-08-18-0-1",
    "0-1",
    "2030-08-18-1",
    "day-0-slot-1",
  ]) {
    assert.equal(getPublishStateKey(project, alias), "2030-08-18-1");
  }
});

test("one-time and role aliases mirror the database contract", () => {
  const oneTime = {
    event_type: "oneTime" as const,
    schedule: {
      oneTime: {
        date: "2030-08-18",
        startTime: "09:00",
        endTime: "11:00",
        volunteers: 5,
      },
    },
  };
  assert.equal(getPublishStateKey(oneTime, "default"), "oneTime");

  const multiArea = {
    event_type: "sameDayMultiArea" as const,
    schedule: {
      sameDayMultiArea: {
        date: "2030-08-18",
        overallStart: "09:00",
        overallEnd: "11:00",
        roles: [
          {
            name: "Welcome Desk",
            startTime: "09:00",
            endTime: "11:00",
            volunteers: 5,
          },
        ],
      },
    },
  };
  assert.equal(getPublishStateKey(multiArea, "role-0"), "Welcome Desk");
});
