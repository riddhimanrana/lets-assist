import { z } from "zod";

import type { EventType } from "@/types";

export const RECURRENCE_INTERVAL_MAX = 365;
/** Unified ceiling used by the server schema, AI schema, and UI input max. */
export const RECURRENCE_OCCURRENCE_MAX = 52;

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function isStrictCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return false;
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isStrictClockTime(value: string): boolean {
  return CLOCK_TIME_PATTERN.test(value);
}

const calendarDateSchema = z.string().refine(isStrictCalendarDate, {
  message: "date must be a real calendar date in YYYY-MM-DD format",
});

const clockTimeSchema = z.string().refine(isStrictClockTime, {
  message: "time must be in 24-hour HH:mm format",
});

const volunteerCountSchema = z.number().int().min(0);

const oneTimeScheduleSchema = z
  .object({
    date: calendarDateSchema,
    startTime: clockTimeSchema,
    endTime: clockTimeSchema,
    volunteers: volunteerCountSchema,
  })
  .strict();

const multiDaySlotSchema = z
  .object({
    name: z.string().optional(),
    startTime: clockTimeSchema,
    endTime: clockTimeSchema,
    volunteers: volunteerCountSchema,
  })
  .strict();

const multiDayScheduleSchema = z
  .array(
    z
      .object({
        date: calendarDateSchema,
        slots: z.array(multiDaySlotSchema).min(1),
      })
      .strict(),
  )
  .min(1);

const sameDayMultiAreaScheduleSchema = z
  .object({
    date: calendarDateSchema,
    overallStart: clockTimeSchema,
    overallEnd: clockTimeSchema,
    roles: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            startTime: clockTimeSchema,
            endTime: clockTimeSchema,
            volunteers: volunteerCountSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/**
 * Server-safe IANA timezone validation. Uses Intl.DateTimeFormat which is
 * available in Node.js and Edge runtimes without any browser APIs.
 * Accepts "UTC" and all real IANA zone names.
 */
export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const recurrenceRuleSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z
      .number()
      .int("interval must be an integer")
      .min(1, "interval must be at least 1")
      .max(
        RECURRENCE_INTERVAL_MAX,
        `interval must be at most ${RECURRENCE_INTERVAL_MAX}`,
      ),
    end_type: z.enum(["never", "on_date", "after_occurrences"]),
    end_date: z.string().nullable().optional(),
    end_occurrences: z
      .number()
      .int()
      .min(1, "end_occurrences must be at least 1")
      .max(
        RECURRENCE_OCCURRENCE_MAX,
        `end_occurrences must be at most ${RECURRENCE_OCCURRENCE_MAX}`,
      )
      .nullable()
      .optional(),
    weekdays: z
      .array(
        z.enum([
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ]),
      )
      .optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.end_date !== null && rule.end_date !== undefined) {
      if (!CALENDAR_DATE_PATTERN.test(rule.end_date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "end_date must be in YYYY-MM-DD format",
          path: ["end_date"],
        });
      } else if (!isStrictCalendarDate(rule.end_date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "end_date must be a real calendar date",
          path: ["end_date"],
        });
      }
    }

    if (rule.end_type === "on_date") {
      if (!rule.end_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "end_date is required when end_type is on_date",
          path: ["end_date"],
        });
      }
    }
    if (rule.end_type === "after_occurrences") {
      if (rule.end_occurrences === null || rule.end_occurrences === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "end_occurrences is required when end_type is after_occurrences",
          path: ["end_occurrences"],
        });
      }
    }
  });

export type ValidatedRecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export type ValidatedProjectSchedule =
  | { oneTime: z.infer<typeof oneTimeScheduleSchema> }
  | { multiDay: z.infer<typeof multiDayScheduleSchema> }
  | { sameDayMultiArea: z.infer<typeof sameDayMultiAreaScheduleSchema> };

export function validateProjectSchedule(
  eventType: EventType,
  schedule: unknown,
):
  | { ok: true; schedule: ValidatedProjectSchedule }
  | { ok: false; error: string } {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    return { ok: false, error: "schedule must be an object" };
  }

  const scheduleRecord = schedule as Record<string, unknown>;
  const schema =
    eventType === "oneTime"
      ? oneTimeScheduleSchema
      : eventType === "multiDay"
        ? multiDayScheduleSchema
        : sameDayMultiAreaScheduleSchema;
  const result = schema.safeParse(scheduleRecord[eventType]);

  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "Invalid project schedule",
    };
  }

  return {
    ok: true,
    schedule: { [eventType]: result.data } as ValidatedProjectSchedule,
  };
}

/**
 * Validate a recurrence_rule object. Returns the validated rule on success or
 * an error string on failure. Used by create/update actions and the cron
 * generator so the same constraints are enforced in both paths.
 */
export function validateRecurrenceRule(
  rule: unknown,
): { ok: true; rule: ValidatedRecurrenceRule } | { ok: false; error: string } {
  const result = recurrenceRuleSchema.safeParse(rule);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? "Invalid recurrence rule",
    };
  }
  return { ok: true, rule: result.data };
}

/**
 * Validate a project_timezone string (IANA or "UTC").
 */
export function validateProjectTimezone(
  tz: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof tz !== "string" || !tz) {
    return {
      ok: false,
      error: "project_timezone must be a non-empty string",
    };
  }
  if (!isValidIanaTimezone(tz)) {
    return {
      ok: false,
      error: `"${tz}" is not a valid IANA timezone`,
    };
  }
  return { ok: true };
}
