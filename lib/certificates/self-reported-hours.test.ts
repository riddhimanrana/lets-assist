import { describe, expect, test } from "bun:test";
import { parseSelfReportedHours } from "./self-reported-hours";

const input = {
  title: "Fictional park cleanup",
  creatorName: "Fictional supervisor",
  date: "2026-10-06",
  startTime: "09:00",
  endTime: "10:30",
  timeZone: "America/Los_Angeles",
};

describe("self-reported hours input", () => {
  test("converts the stated local time to UTC independent of the server zone", () => {
    const parsed = parseSelfReportedHours(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.eventStart).toBe("2026-10-06T16:00:00.000Z");
    expect(parsed.eventEnd).toBe("2026-10-06T17:30:00.000Z");
    expect(
      parseSelfReportedHours({ ...input, timeZone: "Asia/Kolkata" }),
    ).toHaveProperty("eventStart", "2026-10-06T03:30:00.000Z");
    expect(
      parseSelfReportedHours({ ...input, date: "2026-12-06" }),
    ).toHaveProperty("eventStart", "2026-12-06T17:00:00.000Z");
  });

  test.each(
    [
      null,
      [],
      {},
      { ...input, title: 42 },
      { ...input, title: " " },
      { ...input, title: "x".repeat(141) },
      { ...input, creatorName: {} },
      { ...input, organizationName: [] },
      { ...input, description: "x".repeat(5001) },
      { ...input, date: "2026-02-30" },
      { ...input, startTime: "25:00" },
      { ...input, endTime: "08:00" },
      { ...input, endTime: "09:00" },
      { ...input, timeZone: undefined },
      { ...input, timeZone: "not-a-zone" },
      { ...input, date: "2026-03-08", startTime: "02:30" },
    ].map((value) => [value]),
  )("rejects malformed or impossible input %#", (value) => {
    expect(parseSelfReportedHours(value).ok).toBe(false);
  });
  const NONEXISTENT =
    "This local time does not exist in the selected time zone.";
  const twice = (choices: string) =>
    `That time happens twice on this date because clocks change. Enter a time ${choices}, or split the entry.`;
  const errorFor = (overrides: Record<string, unknown>) => {
    const parsed = parseSelfReportedHours({ ...input, ...overrides });
    return parsed.ok ? null : parsed.error;
  };

  test.each([
    // Los Angeles falls back at 2:00 AM, so 1:00 to 1:59 happens twice.
    [
      "America/Los_Angeles",
      "2026-11-01",
      "01:30",
      "02:30",
      "1:00 AM",
      "2:00 AM",
    ],
    [
      "America/Los_Angeles",
      "2026-11-01",
      "01:00",
      "03:00",
      "1:00 AM",
      "2:00 AM",
    ],
    [
      "America/Los_Angeles",
      "2026-11-01",
      "00:30",
      "01:59",
      "1:00 AM",
      "2:00 AM",
    ],
    // London falls back at 2:00 AM too; Berlin an hour later on the wall.
    ["Europe/London", "2026-10-25", "01:15", "04:00", "1:00 AM", "2:00 AM"],
    ["Europe/Berlin", "2026-10-25", "02:30", "05:00", "2:00 AM", "3:00 AM"],
    // Lord Howe Island moves its clocks by half an hour.
    [
      "Australia/Lord_Howe",
      "2026-04-05",
      "01:45",
      "05:00",
      "1:30 AM",
      "2:00 AM",
    ],
  ])(
    "rejects a wall time that happens twice in %s on %s (%s to %s)",
    (timeZone, date, startTime, endTime, from, until) => {
      expect(errorFor({ timeZone, date, startTime, endTime })).toBe(
        twice(`before ${from} or after ${until}`),
      );
    },
  );

  test("a repeated hour that starts at midnight offers only the later side", () => {
    // Havana falls back from 1:00 AM to midnight.
    expect(
      errorFor({
        timeZone: "America/Havana",
        date: "2026-11-01",
        startTime: "00:30",
        endTime: "03:00",
      }),
    ).toBe(twice("after 1:00 AM"));
  });

  test("the hours on either side of a repeated hour are recorded once", () => {
    const fallBack = { timeZone: "America/Los_Angeles", date: "2026-11-01" };
    // 12:30 AM is still daylight time; 2:00 AM onward is standard time.
    expect(
      parseSelfReportedHours({
        ...input,
        ...fallBack,
        startTime: "00:30",
        endTime: "02:00",
      }),
    ).toMatchObject({
      eventStart: "2026-11-01T07:30:00.000Z",
      eventEnd: "2026-11-01T10:00:00.000Z",
    });
    expect(
      parseSelfReportedHours({
        ...input,
        ...fallBack,
        startTime: "02:00",
        endTime: "03:00",
      }),
    ).toMatchObject({
      eventStart: "2026-11-01T10:00:00.000Z",
      eventEnd: "2026-11-01T11:00:00.000Z",
    });
  });

  test.each([
    ["America/Los_Angeles", "2026-03-08", "02:30", "04:00"],
    ["America/Los_Angeles", "2026-03-08", "01:00", "02:00"],
    ["Europe/London", "2026-03-29", "01:30", "04:00"],
    ["Europe/Berlin", "2026-03-29", "02:00", "04:00"],
  ])(
    "still rejects a wall time that clocks skip in %s on %s (%s to %s)",
    (timeZone, date, startTime, endTime) => {
      expect(errorFor({ timeZone, date, startTime, endTime })).toBe(
        NONEXISTENT,
      );
    },
  );

  test.each([
    ["America/Los_Angeles", "2026-03-08", "03:00", "2026-03-08T10:00:00.000Z"],
    ["America/Los_Angeles", "2026-07-15", "01:30", "2026-07-15T08:30:00.000Z"],
    ["Europe/London", "2026-10-24", "01:30", "2026-10-24T00:30:00.000Z"],
    ["Europe/London", "2026-10-26", "01:30", "2026-10-26T01:30:00.000Z"],
    // No daylight saving: the dates other zones change on are ordinary here.
    ["Asia/Kolkata", "2026-11-01", "01:30", "2026-10-31T20:00:00.000Z"],
    ["Asia/Kolkata", "2026-03-08", "02:30", "2026-03-07T21:00:00.000Z"],
    ["America/Phoenix", "2026-11-01", "01:30", "2026-11-01T08:30:00.000Z"],
    ["America/Phoenix", "2026-03-08", "02:30", "2026-03-08T09:30:00.000Z"],
    ["UTC", "2026-11-01", "01:30", "2026-11-01T01:30:00.000Z"],
    // The far ends of the offset range resolve to one instant as well.
    ["Pacific/Kiritimati", "2026-11-01", "01:30", "2026-10-31T11:30:00.000Z"],
    ["Pacific/Niue", "2026-11-01", "01:30", "2026-11-01T12:30:00.000Z"],
  ])(
    "accepts an ordinary wall time in %s on %s at %s",
    (timeZone, date, startTime, eventStart) => {
      const parsed = parseSelfReportedHours({
        ...input,
        timeZone,
        date,
        startTime,
        endTime: "06:00",
      });
      expect(parsed).toMatchObject({ ok: true, eventStart });
    },
  );
});
