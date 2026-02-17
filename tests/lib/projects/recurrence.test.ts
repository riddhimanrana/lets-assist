import { describe, expect, it } from "vitest";
import { buildRecurrenceRuleFromState } from "@/lib/projects/recurrence";

describe("buildRecurrenceRuleFromState", () => {
  it("returns null when recurrence is disabled", () => {
    const result = buildRecurrenceRuleFromState({
      enabled: false,
      frequency: "weekly",
      interval: 1,
      endType: "never",
      weekdays: ["monday"],
    });

    expect(result).toBeNull();
  });

  it("normalizes end_date for on_date recurrence", () => {
    const result = buildRecurrenceRuleFromState({
      enabled: true,
      frequency: "weekly",
      interval: 2,
      endType: "on_date",
      endDate: "2026-12-31",
      endOccurrences: 12,
      weekdays: ["monday", "wednesday"],
    });

    expect(result).toEqual({
      frequency: "weekly",
      interval: 2,
      end_type: "on_date",
      end_date: "2026-12-31",
      end_occurrences: null,
      weekdays: ["monday", "wednesday"],
    });
  });

  it("normalizes end_occurrences for after_occurrences recurrence", () => {
    const result = buildRecurrenceRuleFromState({
      enabled: true,
      frequency: "monthly",
      interval: 1,
      endType: "after_occurrences",
      endDate: "2026-12-31",
      endOccurrences: 6,
      weekdays: [],
    });

    expect(result).toEqual({
      frequency: "monthly",
      interval: 1,
      end_type: "after_occurrences",
      end_date: null,
      end_occurrences: 6,
      weekdays: [],
    });
  });
});
