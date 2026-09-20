import { describe, expect, test } from "bun:test";
import {
  inspectAttendanceIntervals,
  localDateTimeCandidates,
} from "./intervals";

describe("reviewed attendance intervals", () => {
  test("breaks do not receive credit and rounding occurs after summing", () => {
    expect(
      inspectAttendanceIntervals([
        { checkIn: "2026-09-20T09:00:00Z", checkOut: "2026-09-20T10:00:20Z" },
        { checkIn: "2026-09-20T10:30:00Z", checkOut: "2026-09-20T11:00:20Z" },
      ]).minutes,
    ).toBe(91);
  });
  test("missing, reversed, overlapping, and excessive times cannot award credit", () => {
    for (const intervals of [
      [{ checkIn: null, checkOut: null }],
      [{ checkIn: "2026-09-20T10:00Z", checkOut: "2026-09-20T09:00Z" }],
      [{ checkIn: "2026-09-20T09:00Z", checkOut: "2026-09-21T10:00Z" }],
      [
        { checkIn: "2026-09-20T09:00Z", checkOut: "2026-09-20T11:00Z" },
        { checkIn: "2026-09-20T10:00Z", checkOut: "2026-09-20T12:00Z" },
      ],
    ])
      expect(inspectAttendanceIntervals(intervals).minutes).toBeNull();
  });
  test("outside-session time is flagged without being clamped", () => {
    const result = inspectAttendanceIntervals(
      [{ checkIn: "2026-09-20T08:00Z", checkOut: "2026-09-20T12:00Z" }],
      {
        startsAt: Date.parse("2026-09-20T09:00Z"),
        endsAt: Date.parse("2026-09-20T11:00Z"),
      },
    );
    expect(result).toEqual({
      problems: [],
      minutes: 240,
      outsideSession: true,
    });
  });
  test("nonexistent local dates and spring clock times are rejected", () => {
    expect(
      localDateTimeCandidates("2026-03-08T02:30", "America/Los_Angeles"),
    ).toEqual([]);
    expect(
      localDateTimeCandidates("2026-02-30T10:00", "America/Los_Angeles"),
    ).toEqual([]);
  });
  test("repeated autumn clock times expose both offsets for review", () => {
    expect(
      localDateTimeCandidates("2026-11-01T01:30", "America/Los_Angeles"),
    ).toEqual(["2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"]);
  });
});
