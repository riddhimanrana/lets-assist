import { describe, expect, test } from "bun:test";

import { formatHoursDuration } from "./hours";

describe("formatHoursDuration", () => {
  test("zero, negative and unreadable totals read as 0h", () => {
    expect(formatHoursDuration(0)).toBe("0h");
    expect(formatHoursDuration(-2)).toBe("0h");
    expect(formatHoursDuration(Number.NaN)).toBe("0h");
    expect(formatHoursDuration(0.001)).toBe("0h");
  });

  test("whole hours, minutes and both", () => {
    expect(formatHoursDuration(3)).toBe("3h");
    expect(formatHoursDuration(0.5)).toBe("30m");
    expect(formatHoursDuration(1.5)).toBe("1h 30m");
  });

  test("rounds to the minute and carries a full hour", () => {
    expect(formatHoursDuration(1.999)).toBe("2h");
    expect(formatHoursDuration(2.26)).toBe("2h 16m");
  });
});
