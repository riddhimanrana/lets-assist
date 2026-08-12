import { z } from "zod";

export const RECURRENCE_INTERVAL_MAX = 365;
export const RECURRENCE_OCCURRENCE_MAX = 730;

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
  .superRefine((rule, ctx) => {
    if (rule.end_type === "on_date") {
      if (!rule.end_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "end_date is required when end_type is on_date",
          path: ["end_date"],
        });
        return;
      }
      const parsed = new Date(rule.end_date);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "end_date must be a valid date string",
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
