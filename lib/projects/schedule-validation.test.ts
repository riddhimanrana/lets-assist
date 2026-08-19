import { describe, expect, test } from "bun:test";

import {
  isStrictCalendarDate,
  isStrictClockTime,
  isValidIanaTimezone,
  validateProjectSchedule,
  validateRecurrenceRule,
  validateProjectTimezone,
  RECURRENCE_INTERVAL_MAX,
  RECURRENCE_OCCURRENCE_MAX,
} from "./schedule-validation";

describe("strict project date and time grammar", () => {
  test("calendar dates round-trip instead of normalizing", () => {
    expect(isStrictCalendarDate("2026-02-28")).toBe(true);
    expect(isStrictCalendarDate("2024-02-29")).toBe(true);
    expect(isStrictCalendarDate("2026-02-29")).toBe(false);
    expect(isStrictCalendarDate("2026-02-30")).toBe(false);
    expect(isStrictCalendarDate("0000-01-01")).toBe(false);
    expect(isStrictCalendarDate("2026-2-03")).toBe(false);
  });

  test("clock times require canonical, in-range HH:mm", () => {
    expect(isStrictClockTime("00:00")).toBe(true);
    expect(isStrictClockTime("23:59")).toBe(true);
    expect(isStrictClockTime("99:99")).toBe(false);
    expect(isStrictClockTime("24:00")).toBe(false);
    expect(isStrictClockTime("9:00")).toBe(false);
  });

  test("project schedules are parsed to the selected event type", () => {
    const result = validateProjectSchedule("oneTime", {
      oneTime: {
        date: "2026-09-15",
        startTime: "09:00",
        endTime: "11:00",
        volunteers: 10,
      },
      multiDay: [],
    });

    expect(result).toEqual({
      ok: true,
      schedule: {
        oneTime: {
          date: "2026-09-15",
          startTime: "09:00",
          endTime: "11:00",
          volunteers: 10,
        },
      },
    });
  });

  test("project schedules reject invalid dates and times", () => {
    expect(
      validateProjectSchedule("oneTime", {
        oneTime: {
          date: "2026-02-30",
          startTime: "99:99",
          endTime: "11:00",
          volunteers: 10,
        },
      }).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidIanaTimezone
// ---------------------------------------------------------------------------

describe("isValidIanaTimezone", () => {
  test("UTC is valid", () => {
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  test("real IANA zones are valid", () => {
    for (const tz of [
      "America/Los_Angeles",
      "America/New_York",
      "America/Chicago",
      "Europe/London",
      "Europe/Paris",
      "Asia/Tokyo",
      "Asia/Kolkata",
      "Australia/Sydney",
      "Pacific/Honolulu",
      // DST-observing zones
      "America/Denver",
      "America/Phoenix",
    ]) {
      expect(isValidIanaTimezone(tz)).toBe(true);
    }
  });

  test("empty string is invalid", () => {
    expect(isValidIanaTimezone("")).toBe(false);
  });

  test("made-up zones are invalid", () => {
    expect(isValidIanaTimezone("Invalid/Zone")).toBe(false);
    expect(isValidIanaTimezone("NotATimezone")).toBe(false);
    expect(isValidIanaTimezone("America/FakeTown")).toBe(false);
  });

  test("non-IANA strings are invalid", () => {
    // Abbreviations without region are not reliable IANA names; some runtimes
    // accept a handful like "UTC" but reject unknown ones.
    expect(isValidIanaTimezone("FAKE_TZ")).toBe(false);
    expect(isValidIanaTimezone("America")).toBe(false); // prefix without city
  });
});

// ---------------------------------------------------------------------------
// validateProjectTimezone
// ---------------------------------------------------------------------------

describe("validateProjectTimezone", () => {
  test("accepts valid IANA zones", () => {
    expect(validateProjectTimezone("America/Los_Angeles")).toEqual({
      ok: true,
    });
    expect(validateProjectTimezone("UTC")).toEqual({ ok: true });
    expect(validateProjectTimezone("Europe/London")).toEqual({ ok: true });
    expect(validateProjectTimezone("Asia/Kolkata")).toEqual({ ok: true });
  });

  test("rejects empty string", () => {
    const result = validateProjectTimezone("");
    expect(result.ok).toBe(false);
  });

  test("rejects null", () => {
    const result = validateProjectTimezone(null);
    expect(result.ok).toBe(false);
  });

  test("rejects undefined", () => {
    const result = validateProjectTimezone(undefined);
    expect(result.ok).toBe(false);
  });

  test("rejects non-string", () => {
    expect(validateProjectTimezone(42).ok).toBe(false);
    expect(validateProjectTimezone({}).ok).toBe(false);
  });

  test("rejects invalid IANA zone names", () => {
    expect(validateProjectTimezone("Invalid/Zone").ok).toBe(false);
    expect(validateProjectTimezone("BADZONE").ok).toBe(false);
  });

  test("error message contains the rejected value", () => {
    const result = validateProjectTimezone("Not/Real");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Not/Real");
    }
  });
});

// ---------------------------------------------------------------------------
// validateRecurrenceRule — interval edge cases
// ---------------------------------------------------------------------------

describe("validateRecurrenceRule — interval", () => {
  const base = {
    frequency: "daily" as const,
    end_type: "never" as const,
  };

  test("interval -1 is rejected (would cause backward infinite loop)", () => {
    const result = validateRecurrenceRule({ ...base, interval: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/interval/i);
  });

  test("interval 0 is rejected", () => {
    const result = validateRecurrenceRule({ ...base, interval: 0 });
    expect(result.ok).toBe(false);
  });

  test("interval NaN is rejected", () => {
    const result = validateRecurrenceRule({ ...base, interval: NaN });
    expect(result.ok).toBe(false);
  });

  test("interval above RECURRENCE_INTERVAL_MAX is rejected", () => {
    const result = validateRecurrenceRule({
      ...base,
      interval: RECURRENCE_INTERVAL_MAX + 1,
    });
    expect(result.ok).toBe(false);
  });

  test("interval 1 is accepted", () => {
    const result = validateRecurrenceRule({ ...base, interval: 1 });
    expect(result.ok).toBe(true);
  });

  test("interval at RECURRENCE_INTERVAL_MAX is accepted", () => {
    const result = validateRecurrenceRule({
      ...base,
      interval: RECURRENCE_INTERVAL_MAX,
    });
    expect(result.ok).toBe(true);
  });

  test("non-integer interval is rejected", () => {
    const result = validateRecurrenceRule({ ...base, interval: 1.5 });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRecurrenceRule — frequency enum
// ---------------------------------------------------------------------------

describe("validateRecurrenceRule — frequency", () => {
  const base = { interval: 1, end_type: "never" as const };

  test("valid frequencies are accepted", () => {
    for (const freq of ["daily", "weekly", "monthly", "yearly"] as const) {
      expect(validateRecurrenceRule({ ...base, frequency: freq }).ok).toBe(
        true,
      );
    }
  });

  test("invalid frequency is rejected", () => {
    expect(validateRecurrenceRule({ ...base, frequency: "hourly" }).ok).toBe(
      false,
    );
    expect(validateRecurrenceRule({ ...base, frequency: "" }).ok).toBe(false);
    expect(validateRecurrenceRule({ ...base, frequency: "DAILY" }).ok).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// validateRecurrenceRule — end_type and related fields
// ---------------------------------------------------------------------------

describe("validateRecurrenceRule — end_type", () => {
  const base = { frequency: "weekly" as const, interval: 1 };

  test("end_type never is valid without end_date or end_occurrences", () => {
    expect(validateRecurrenceRule({ ...base, end_type: "never" }).ok).toBe(
      true,
    );
  });

  test("a supplied end_date is validated even when end_type is never", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "never",
        end_date: "2026-02-30",
      }).ok,
    ).toBe(false);
  });

  test("unknown recurrence keys are rejected rather than silently stripped", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "never",
        attacker_key: "ignored-before",
      }).ok,
    ).toBe(false);
  });

  test("end_type on_date requires a valid end_date", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "on_date",
        end_date: "2027-01-01",
      }).ok,
    ).toBe(true);
  });

  test("end_type on_date without end_date is rejected", () => {
    expect(
      validateRecurrenceRule({ ...base, end_type: "on_date", end_date: null })
        .ok,
    ).toBe(false);
    expect(validateRecurrenceRule({ ...base, end_type: "on_date" }).ok).toBe(
      false,
    );
  });

  test("end_type on_date with unparseable end_date is rejected", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "on_date",
        end_date: "not-a-date",
      }).ok,
    ).toBe(false);
  });

  // --- Strict YYYY-MM-DD + calendar round-trip (matches parseISO consumers) ---

  test("end_date in MM/DD/YYYY format is rejected (not YYYY-MM-DD)", () => {
    const result = validateRecurrenceRule({
      ...base,
      end_type: "on_date",
      end_date: "12/31/2026",
    });
    expect(result.ok).toBe(false);
  });

  test("end_date 2026-12-31 is accepted (valid YYYY-MM-DD)", () => {
    const result = validateRecurrenceRule({
      ...base,
      end_type: "on_date",
      end_date: "2026-12-31",
    });
    expect(result.ok).toBe(true);
  });

  test("end_date 2026-02-29 is rejected (2026 is not a leap year)", () => {
    const result = validateRecurrenceRule({
      ...base,
      end_type: "on_date",
      end_date: "2026-02-29",
    });
    expect(result.ok).toBe(false);
  });

  test("end_date 2024-02-29 is accepted (2024 is a leap year)", () => {
    const result = validateRecurrenceRule({
      ...base,
      end_type: "on_date",
      end_date: "2024-02-29",
    });
    expect(result.ok).toBe(true);
  });

  test("end_date with invalid month 2026-13-01 is rejected", () => {
    const result = validateRecurrenceRule({
      ...base,
      end_type: "on_date",
      end_date: "2026-13-01",
    });
    expect(result.ok).toBe(false);
  });

  test("end_date with invalid day 2026-01-32 is rejected", () => {
    const result = validateRecurrenceRule({
      ...base,
      end_type: "on_date",
      end_date: "2026-01-32",
    });
    expect(result.ok).toBe(false);
  });

  test("end_type after_occurrences requires end_occurrences >= 1", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "after_occurrences",
        end_occurrences: 5,
      }).ok,
    ).toBe(true);
  });

  test("end_type after_occurrences without end_occurrences is rejected", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "after_occurrences",
        end_occurrences: null,
      }).ok,
    ).toBe(false);
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "after_occurrences",
      }).ok,
    ).toBe(false);
  });

  test("end_occurrences 0 is rejected", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "after_occurrences",
        end_occurrences: 0,
      }).ok,
    ).toBe(false);
  });

  test("end_occurrences above RECURRENCE_OCCURRENCE_MAX is rejected", () => {
    const result = validateRecurrenceRule({
      ...base,
      end_type: "after_occurrences",
      end_occurrences: RECURRENCE_OCCURRENCE_MAX + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/end_occurrences/i);
  });

  test("end_occurrences at RECURRENCE_OCCURRENCE_MAX is accepted", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "after_occurrences",
        end_occurrences: RECURRENCE_OCCURRENCE_MAX,
      }).ok,
    ).toBe(true);
  });

  test("invalid end_type is rejected", () => {
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "forever" as "never",
      }).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hard loop-cap: corrupt row is a bounded fault; subsequent parents continue
// ---------------------------------------------------------------------------

describe("validateRecurrenceRule — corrupt-row isolation", () => {
  test("corrupt rule (interval -1) is rejected and does not block subsequent valid rules", () => {
    const corrupt = { frequency: "daily", interval: -1, end_type: "never" };
    const corruptResult = validateRecurrenceRule(corrupt);
    expect(corruptResult.ok).toBe(false);

    // A valid rule following the corrupt one validates independently.
    const validResult = validateRecurrenceRule({
      frequency: "weekly",
      interval: 2,
      end_type: "after_occurrences",
      end_occurrences: 10,
    });
    expect(validResult.ok).toBe(true);
  });

  test("multiple corrupt rules each fail individually without short-circuiting later checks", () => {
    const corruptRules = [
      { frequency: "daily", interval: 0, end_type: "never" },
      {
        frequency: "weekly",
        interval: 1,
        end_type: "on_date",
        end_date: "not-a-date",
      },
      {
        frequency: "monthly",
        interval: 1,
        end_type: "after_occurrences",
        end_occurrences: 0,
      },
    ] as const;

    for (const corrupt of corruptRules) {
      expect(validateRecurrenceRule(corrupt).ok).toBe(false);
    }

    // Validation still works after all failures.
    expect(
      validateRecurrenceRule({
        frequency: "yearly",
        interval: 1,
        end_type: "never",
      }).ok,
    ).toBe(true);
  });

  test("MAX_ITERATIONS_PER_PARENT is exported with a reasonable upper bound", async () => {
    const mod = await import("@/services/recurring-project-worker");
    const cap = mod.MAX_ITERATIONS_PER_PARENT;
    // Defense ceiling must be positive and not pathologically large.
    expect(cap).toBeGreaterThan(10);
    expect(cap).toBeLessThanOrEqual(10_000);
  });
});
