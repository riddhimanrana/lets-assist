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
  test.each([
    [
      "2025-10-26T01:30",
      "Antarctica/Troll",
      ["2025-10-25T23:30:00.000Z", "2025-10-26T01:30:00.000Z"],
    ],
    [
      "2026-04-05T01:45",
      "Australia/Lord_Howe",
      ["2026-04-04T14:45:00.000Z", "2026-04-04T15:15:00.000Z"],
    ],
    [
      "1969-09-30T12:00",
      "Pacific/Kwajalein",
      ["1969-09-30T01:00:00.000Z", "1969-10-01T00:00:00.000Z"],
    ],
    [
      "1892-07-04T12:00",
      "Pacific/Apia",
      ["1892-07-03T23:26:56.000Z", "1892-07-04T23:26:56.000Z"],
    ],
    ["1900-01-01T12:00", "Europe/Paris", ["1900-01-01T11:50:39.000Z"]],
    ["2026-09-20T10:00", "Asia/Kathmandu", ["2026-09-20T04:15:00.000Z"]],
  ])("uses every actual offset for %s in %s", (value, timezone, expected) => {
    expect(
      localDateTimeCandidates(value as string, timezone as string),
    ).toEqual(expected);
  });
  test.each([
    ["2025-03-30T01:30", "Antarctica/Troll"],
    ["2011-12-30T12:00", "Pacific/Apia"],
    ["2026-04-31T10:00", "UTC"],
    ["2026-09-20T24:00", "UTC"],
    ["2026-09-20T10:00", "Invalid/Timezone"],
  ])("rejects nonexistent local time %s in %s", (value, timezone) => {
    expect(localDateTimeCandidates(value, timezone)).toEqual([]);
  });
  test("a later cached time does not hide an earlier fold on the same date", () => {
    expect(
      localDateTimeCandidates("2026-10-25T23:45", "Antarctica/Troll"),
    ).toEqual(["2026-10-25T23:45:00.000Z"]);
    expect(
      localDateTimeCandidates("2026-10-25T01:30", "Antarctica/Troll"),
    ).toEqual(["2026-10-24T23:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
  });
  test("historical second offsets preserve both exact wall-clock occurrences", () => {
    expect(localDateTimeCandidates("1911-03-10T23:55", "Europe/Paris")).toEqual(
      ["1911-03-10T23:45:39.000Z", "1911-03-10T23:55:00.000Z"],
    );
  });
  test("cached dates preserve both occurrences for later times on the same date", () => {
    expect(
      localDateTimeCandidates("1969-09-30T00:30", "Pacific/Kwajalein"),
    ).toEqual(["1969-09-29T13:30:00.000Z"]);
    expect(
      localDateTimeCandidates("1969-09-30T23:45", "Pacific/Kwajalein"),
    ).toEqual(["1969-09-30T12:45:00.000Z", "1969-10-01T11:45:00.000Z"]);
  });
  test("repeated autumn clock times expose both offsets for review", () => {
    expect(
      localDateTimeCandidates("2026-11-01T01:30", "America/Los_Angeles"),
    ).toEqual(["2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"]);
  });
});
