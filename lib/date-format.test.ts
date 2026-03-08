import { describe, expect, it } from "vitest";

import { formatUtcCalendarDateLabel } from "@/lib/date-format";

describe("formatUtcCalendarDateLabel", () => {
  it("formats timestamps using a stable UTC calendar date", () => {
    expect(formatUtcCalendarDateLabel("2026-03-07T00:30:00.000Z")).toBe(
      "March 7, 2026",
    );
  });

  it("returns N/A for missing or invalid values", () => {
    expect(formatUtcCalendarDateLabel(null)).toBe("N/A");
    expect(formatUtcCalendarDateLabel(undefined)).toBe("N/A");
    expect(formatUtcCalendarDateLabel("not-a-date")).toBe("N/A");
  });
});