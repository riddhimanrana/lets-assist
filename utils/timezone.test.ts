import { describe, expect, test } from "bun:test";

import { formatScheduleDisplay, getTimezoneAbbreviation } from "./timezone";

describe("getTimezoneAbbreviation", () => {
  test("uses the season of the given day, not today's", () => {
    expect(getTimezoneAbbreviation("America/Los_Angeles", "2026-12-05")).toBe(
      "PST",
    );
    expect(getTimezoneAbbreviation("America/Los_Angeles", "2026-07-04")).toBe(
      "PDT",
    );
  });

  test("accepts a Date and an ISO timestamp", () => {
    expect(
      getTimezoneAbbreviation(
        "America/New_York",
        new Date("2026-12-05T17:00:00Z"),
      ),
    ).toBe("EST");
    expect(
      getTimezoneAbbreviation("America/New_York", "2026-07-04T17:00:00Z"),
    ).toBe("EDT");
  });

  test("falls back to today when the date is missing or unreadable", () => {
    const today = getTimezoneAbbreviation("America/Los_Angeles");

    expect(["PST", "PDT"]).toContain(today);
    expect(getTimezoneAbbreviation("America/Los_Angeles", null)).toBe(today);
    expect(getTimezoneAbbreviation("America/Los_Angeles", "not a date")).toBe(
      today,
    );
  });
});

describe("formatScheduleDisplay", () => {
  test("labels the time with the abbreviation in force on the event day", () => {
    expect(
      formatScheduleDisplay(
        { date: "2026-12-05", startTime: "09:00", endTime: "12:00" },
        "America/Los_Angeles",
        "America/Los_Angeles",
      ),
    ).toEndWith("PST");
  });
});
