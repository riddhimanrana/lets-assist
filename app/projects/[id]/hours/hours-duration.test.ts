import { describe, expect, it } from "bun:test";

import { calculateHoursDuration } from "./hours-duration";

describe("volunteer-hours duration validation", () => {
  it("rejects an identical check-in and check-out before publication", () => {
    const instant = "2026-08-11T09:00:00.000Z";

    expect(calculateHoursDuration(instant, instant)).toEqual({
      text: "Invalid: Check-out must be after check-in",
      isValid: false,
      minutes: 0,
    });
  });

  it("rejects reversed, missing, rounded-zero, and excessive durations", () => {
    expect(
      calculateHoursDuration(
        "2026-08-11T09:01:00.000Z",
        "2026-08-11T09:00:00.000Z",
      ).isValid,
    ).toBe(false);
    expect(calculateHoursDuration(null, null).isValid).toBe(false);
    expect(calculateHoursDuration("not-a-date", "also-not-a-date")).toEqual({
      text: "Error parsing dates",
      isValid: false,
      minutes: 0,
    });
    expect(
      calculateHoursDuration(
        "2026-08-11T09:00:00.000Z",
        "2026-08-11T09:00:20.000Z",
      ).isValid,
    ).toBe(false);
    expect(
      calculateHoursDuration(
        "2026-08-11T09:00:00.000Z",
        "2026-08-12T09:01:00.000Z",
      ).isValid,
    ).toBe(false);
  });

  it("accepts a positive duration within the 24-hour bound", () => {
    expect(
      calculateHoursDuration(
        "2026-08-11T09:00:00.000Z",
        "2026-08-11T10:30:00.000Z",
      ),
    ).toEqual({ text: "1h 30m", isValid: true, minutes: 90 });
    expect(
      calculateHoursDuration(
        "2026-08-11T09:00:00.000Z",
        "2026-08-12T09:00:00.000Z",
      ),
    ).toEqual({ text: "24h 0m", isValid: true, minutes: 1440 });
  });

  it("rejects an exact duration beyond 24 hours even when minutes round down", () => {
    expect(
      calculateHoursDuration(
        "2026-08-11T09:00:00.000Z",
        "2026-08-12T09:00:01.000Z",
      ).isValid,
    ).toBe(false);
  });
});
