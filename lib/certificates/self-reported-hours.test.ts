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
});
