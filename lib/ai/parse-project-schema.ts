import { z } from "zod";
import { RECURRENCE_OCCURRENCE_MAX } from "@/lib/projects/schedule-validation";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected an ISO date")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Expected a valid calendar date");

const timeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Expected a 24-hour time");

const volunteersSchema = z.number().int().min(1).max(1_000);

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

const recurrenceFrequencySchema = z.enum([
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
const recurrenceEndTypeSchema = z.enum([
  "never",
  "on_date",
  "after_occurrences",
]);
const recurrenceWeekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const optionalRecurrenceFields = {
  frequency: recurrenceFrequencySchema.optional(),
  interval: z.number().int().min(1).max(365).optional(),
  endType: recurrenceEndTypeSchema.optional(),
  endDate: dateSchema.optional(),
  endOccurrences: z.number().int().min(1).max(RECURRENCE_OCCURRENCE_MAX).optional(),
  weekdays: z.array(recurrenceWeekdaySchema).max(7).optional(),
};

const disabledRecurrenceSchema = z
  .object({
    enabled: z.literal(false),
    ...optionalRecurrenceFields,
  })
  .strict();

const enabledRecurrenceSchema = z
  .object({
    enabled: z.literal(true),
    frequency: recurrenceFrequencySchema,
    interval: z.number().int().min(1).max(365).default(1),
    endType: recurrenceEndTypeSchema.default("never"),
    endDate: dateSchema.optional(),
    endOccurrences: z.number().int().min(1).max(RECURRENCE_OCCURRENCE_MAX).optional(),
    weekdays: z.array(recurrenceWeekdaySchema).max(7).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endType === "on_date" && !value.endDate) {
      context.addIssue({
        code: "custom",
        message: "An end date is required for on-date recurrence",
        path: ["endDate"],
      });
    }
    if (value.endType === "after_occurrences" && !value.endOccurrences) {
      context.addIssue({
        code: "custom",
        message: "An occurrence count is required",
        path: ["endOccurrences"],
      });
    }
    if (value.frequency === "weekly" && !value.weekdays?.length) {
      context.addIssue({
        code: "custom",
        message: "At least one weekday is required for weekly recurrence",
        path: ["weekdays"],
      });
    }
  });

const recurrenceSchema = z
  .discriminatedUnion("enabled", [
    disabledRecurrenceSchema,
    enabledRecurrenceSchema,
  ])
  .optional()
  .default({ enabled: false });

const commonProjectFields = {
  title: z.string().trim().min(1).max(125),
  location: z.string().trim().min(1).max(250),
  description: z.string().trim().min(1).max(2_000),
  verificationMethod: z
    .enum(["qr-code", "manual", "auto", "signup-only"])
    .default("qr-code"),
  requireLogin: z.boolean().default(true),
  recurrence: recurrenceSchema,
};

const oneTimeScheduleSchema = z
  .object({
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    volunteers: volunteersSchema,
  })
  .strict()
  .refine(
    (value) => timeToMinutes(value.endTime) > timeToMinutes(value.startTime),
    { message: "End time must be after start time", path: ["endTime"] },
  );

const multiDaySlotSchema = z
  .object({
    name: z.string().trim().max(75).optional(),
    startTime: timeSchema,
    endTime: timeSchema,
    volunteers: volunteersSchema,
  })
  .strict()
  .refine(
    (value) => timeToMinutes(value.endTime) > timeToMinutes(value.startTime),
    { message: "End time must be after start time", path: ["endTime"] },
  );

const multiDayScheduleSchema = z
  .array(
    z
      .object({
        date: dateSchema,
        slots: z.array(multiDaySlotSchema).min(1).max(24),
      })
      .strict(),
  )
  .min(1)
  .max(31);

const sameDayRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(75),
    startTime: timeSchema,
    endTime: timeSchema,
    volunteers: volunteersSchema,
  })
  .strict()
  .refine(
    (value) => timeToMinutes(value.endTime) > timeToMinutes(value.startTime),
    { message: "End time must be after start time", path: ["endTime"] },
  );

const sameDayScheduleSchema = z
  .object({
    date: dateSchema,
    overallStart: timeSchema,
    overallEnd: timeSchema,
    roles: z.array(sameDayRoleSchema).min(1).max(50),
  })
  .strict()
  .superRefine((value, context) => {
    const overallStart = timeToMinutes(value.overallStart);
    const overallEnd = timeToMinutes(value.overallEnd);
    if (overallEnd <= overallStart) {
      context.addIssue({
        code: "custom",
        message: "Overall end time must be after overall start time",
        path: ["overallEnd"],
      });
    }
    if (
      value.roles.some(
        (role) =>
          timeToMinutes(role.startTime) < overallStart ||
          timeToMinutes(role.endTime) > overallEnd,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Role times must fit inside the overall event window",
        path: ["roles"],
      });
    }
  });

export const parseProjectOutputSchema = z.discriminatedUnion("eventType", [
  z
    .object({
      ...commonProjectFields,
      eventType: z.literal("oneTime"),
      schedule: oneTimeScheduleSchema,
    })
    .strict(),
  z
    .object({
      ...commonProjectFields,
      eventType: z.literal("multiDay"),
      schedule: multiDayScheduleSchema,
    })
    .strict(),
  z
    .object({
      ...commonProjectFields,
      eventType: z.literal("sameDayMultiArea"),
      schedule: sameDayScheduleSchema,
    })
    .strict(),
]);

export type ParseProjectResult = z.infer<typeof parseProjectOutputSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Preserve compatibility with older model output that represented a multi-day
 * day as one flat slot. The result still has to pass the bounded output schema.
 */
export function normalizeParseProjectCandidate(value: unknown): unknown {
  if (!isRecord(value) || value.eventType !== "multiDay") return value;
  if (!Array.isArray(value.schedule)) return value;

  return {
    ...value,
    schedule: value.schedule.map((candidateDay) => {
      if (!isRecord(candidateDay) || Array.isArray(candidateDay.slots)) {
        return candidateDay;
      }

      return {
        date: candidateDay.date,
        slots: [
          {
            name:
              typeof candidateDay.name === "string" ? candidateDay.name : "",
            startTime:
              typeof candidateDay.startTime === "string"
                ? candidateDay.startTime
                : "09:00",
            endTime:
              typeof candidateDay.endTime === "string"
                ? candidateDay.endTime
                : "17:00",
            volunteers:
              typeof candidateDay.volunteers === "number"
                ? candidateDay.volunteers
                : 10,
          },
        ],
      };
    }),
  };
}
