import { describe, expect, test } from "bun:test";

import {
  isValidIanaTimezone,
  validateRecurrenceRule,
  validateProjectTimezone,
  RECURRENCE_INTERVAL_MAX,
  RECURRENCE_OCCURRENCE_MAX,
} from "./schedule-validation";

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
    expect(validateProjectTimezone("America/Los_Angeles")).toEqual({ ok: true });
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
    expect(
      validateRecurrenceRule({ ...base, frequency: "hourly" }).ok,
    ).toBe(false);
    expect(
      validateRecurrenceRule({ ...base, frequency: "" }).ok,
    ).toBe(false);
    expect(
      validateRecurrenceRule({ ...base, frequency: "DAILY" }).ok,
    ).toBe(false);
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
      validateRecurrenceRule({ ...base, end_type: "on_date", end_date: null }).ok,
    ).toBe(false);
    expect(
      validateRecurrenceRule({ ...base, end_type: "on_date" }).ok,
    ).toBe(false);
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
    expect(
      validateRecurrenceRule({
        ...base,
        end_type: "after_occurrences",
        end_occurrences: RECURRENCE_OCCURRENCE_MAX + 1,
      }).ok,
    ).toBe(false);
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

describe("validateRecurrenceRule — loop-cap coverage via validation", () => {
  test("corrupt rule (interval -1, end_type never) is rejected, leaving run to continue", () => {
    const corrupt = {
      frequency: "daily",
      interval: -1,
      end_type: "never",
    };
    const result = validateRecurrenceRule(corrupt);
    expect(result.ok).toBe(false);
    // A valid parent after the corrupt one passes independently.
    const valid = validateRecurrenceRule({
      frequency: "weekly",
      interval: 2,
      end_type: "after_occurrences",
      end_occurrences: 10,
    });
    expect(valid.ok).toBe(true);
  });

  test("MAX_ITERATIONS_PER_PARENT constant is exported and reasonable", async () => {
    // Import dynamically to test the exported constant from the cron route.
    const mod = await import(
      "@/app/api/cron/generate-recurring-projects/route"
    );
    expect(typeof mod.MAX_ITERATIONS_PER_PARENT).toBe("number");
    expect(mod.MAX_ITERATIONS_PER_PARENT).toBeGreaterThan(10);
    expect(mod.MAX_ITERATIONS_PER_PARENT).toBeLessThanOrEqual(10000);
  });
});
