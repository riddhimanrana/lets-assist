import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeParseProjectCandidate,
  parseProjectOutputSchema,
} from "./parse-project-schema";

const common = {
  title: "Beach cleanup",
  location: "Ocean Beach",
  description: "Remove litter from the shoreline.",
  verificationMethod: "qr-code" as const,
  requireLogin: true,
  recurrence: { enabled: false as const },
};

test("accepts each bounded project schedule shape", () => {
  const oneTime = parseProjectOutputSchema.safeParse({
    ...common,
    eventType: "oneTime",
    schedule: {
      date: "2026-08-01",
      startTime: "09:00",
      endTime: "12:00",
      volunteers: 25,
    },
  });
  assert.equal(oneTime.success, true);

  const multiDay = parseProjectOutputSchema.safeParse({
    ...common,
    eventType: "multiDay",
    schedule: [
      {
        date: "2026-08-01",
        slots: [
          {
            name: "Morning",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 20,
          },
        ],
      },
    ],
  });
  assert.equal(multiDay.success, true);

  const sameDay = parseProjectOutputSchema.safeParse({
    ...common,
    eventType: "sameDayMultiArea",
    schedule: {
      date: "2026-08-01",
      overallStart: "09:00",
      overallEnd: "17:00",
      roles: [
        {
          name: "Registration",
          startTime: "09:00",
          endTime: "12:00",
          volunteers: 5,
        },
      ],
    },
  });
  assert.equal(sameDay.success, true);
});

test("normalizes the legacy flat multi-day shape before validation", () => {
  const normalized = normalizeParseProjectCandidate({
    ...common,
    eventType: "multiDay",
    schedule: [
      {
        date: "2026-08-01",
        name: "Morning",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 15,
      },
    ],
  });

  assert.equal(parseProjectOutputSchema.safeParse(normalized).success, true);
});

test("rejects extra fields, invalid time windows, and oversized collections", () => {
  assert.equal(
    parseProjectOutputSchema.safeParse({
      ...common,
      eventType: "oneTime",
      schedule: {
        date: "2026-08-01",
        startTime: "18:00",
        endTime: "09:00",
        volunteers: 10,
      },
      unexpected: "model-injected-field",
    }).success,
    false,
  );

  assert.equal(
    parseProjectOutputSchema.safeParse({
      ...common,
      eventType: "multiDay",
      schedule: Array.from({ length: 32 }, (_, index) => ({
        date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
        slots: [
          {
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 10,
          },
        ],
      })),
    }).success,
    false,
  );
});
