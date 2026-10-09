import { z } from "zod";

import {
  DESCRIPTION_MARKUP_MAX,
  DESCRIPTION_TEXT_MAX,
  isDateTimeInPast,
  richTextToPlainText,
} from "./event-form-helpers";

export const DUPLICATE_ROLE_NAME_MESSAGE =
  "Two roles share this name. Give each role a different name.";
export const VOLUNTEERS_REQUIRED_MESSAGE = "Enter a number of volunteers";

/**
 * How a schedule decides that a time is already behind us. The project's own
 * timezone is used, not the browser's, so an organizer in another zone gets
 * the same answer the server gives.
 */
export type ScheduleSchemaOptions = {
  timeZone?: string;
  now?: () => Date;
};

// Helper to convert HH:MM time string to minutes since midnight
const timeToMinutes = (timeStr: string): number => {
  if (!timeStr || !timeStr.includes(":")) return -1; // Return invalid value if format is wrong
  const [hours, minutes] = timeStr.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return -1;
  return hours * 60 + minutes;
};

const endsAfterStart = (startTime: string, endTime: string): boolean => {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  return startMinutes !== -1 && endMinutes !== -1 && endMinutes > startMinutes;
};

// A cleared number input reaches the schema as NaN (or null once serialized).
const volunteersSchema = z
  .number({ error: VOLUNTEERS_REQUIRED_MESSAGE })
  .int("Enter a whole number of volunteers")
  .min(1, "At least 1 volunteer is required")
  .max(1000, "Maximum 1000 volunteers allowed");

// Basic Info Schema
export const basicInfoSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(125, "Title cannot exceed 125 characters"),
  location: z
    .string()
    .min(1, "Location is required")
    .max(250, "Location cannot exceed 250 characters"),
  locationData: z.any().optional(),
  // The limit counts the text a reader sees, the same thing the editor's
  // counter shows, so an empty editor ("<p></p>") is empty here too.
  description: z
    .string()
    .max(DESCRIPTION_MARKUP_MAX, "Description is too long")
    .refine((value) => richTextToPlainText(value).trim().length > 0, {
      message: "Description is required",
    })
    .refine(
      (value) => richTextToPlainText(value).length <= DESCRIPTION_TEXT_MAX,
      {
        message: `Description cannot exceed ${DESCRIPTION_TEXT_MAX} characters`,
      },
    ),
  organizationId: z.string().nullable(),
});

// One Time Event Schema
export function createOneTimeSchema(options: ScheduleSchemaOptions = {}) {
  const inPast = (date: string, time: string) =>
    isDateTimeInPast(date, time, options.timeZone, options.now?.());

  return z
    .object({
      date: z.string().min(1, "Date is required"),
      startTime: z.string().min(1, "Start time is required"),
      endTime: z.string().min(1, "End time is required"),
      volunteers: volunteersSchema,
    })
    .refine((data) => endsAfterStart(data.startTime, data.endTime), {
      message: "End time must be after start time",
      path: ["endTime"],
    })
    .refine((data) => !inPast(data.date, data.startTime), {
      message: "Start time must be in the future",
      path: ["startTime"],
    })
    .refine((data) => !inPast(data.date, data.endTime), {
      message: "End time must be in the future",
      path: ["endTime"],
    });
}

// Slot Schema for Multi Day Events
const slotSchema = z.object({
  name: z.string().max(75, "Slot name cannot exceed 75 characters").optional(),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  volunteers: volunteersSchema,
});

// Day Schema for Multi Day Events
const daySchema = z.object({
  date: z.string().min(1, "Date is required"),
  slots: z
    .array(slotSchema)
    .min(1, "At least one time slot is required")
    .refine(
      (slots) =>
        slots.every((slot) => endsAfterStart(slot.startTime, slot.endTime)),
      {
        message: "End time must be after start time for all slots",
        path: [],
      },
    ),
});

// Multi Day Event Schema
export function createMultiDaySchema(options: ScheduleSchemaOptions = {}) {
  const inPast = (date: string, time: string) =>
    isDateTimeInPast(date, time, options.timeZone, options.now?.());

  return z
    .array(daySchema)
    .min(1, "At least one day is required")
    .refine(
      (days) =>
        days.every((day) =>
          day.slots.every(
            (slot) =>
              !inPast(day.date, slot.startTime) &&
              !inPast(day.date, slot.endTime),
          ),
        ),
      {
        message: "All dates and times must be in the future",
        path: [],
      },
    );
}

// Role Schema for Multi Role Events
const roleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(75, "Role name cannot exceed 75 characters"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  volunteers: volunteersSchema,
});

// Multi Role Event Schema
export function createMultiRoleSchema(options: ScheduleSchemaOptions = {}) {
  const inPast = (date: string, time: string) =>
    isDateTimeInPast(date, time, options.timeZone, options.now?.());

  return z
    .object({
      date: z.string().min(1, "Date is required"),
      overallStart: z.string().min(1, "Overall start time is required"),
      overallEnd: z.string().min(1, "Overall end time is required"),
      roles: z
        .array(roleSchema)
        .min(1, "At least one role is required")
        .refine(
          (roles) =>
            roles.every((role) => endsAfterStart(role.startTime, role.endTime)),
          {
            message: "End time must be after start time for all roles",
            path: ["roles"],
          },
        )
        // Role names key the published-hours record, so two roles cannot
        // share one. The issue lands on each repeated name field.
        .superRefine((roles, ctx) => {
          const seen = new Set<string>();
          roles.forEach((role, index) => {
            const name = role.name.trim().toLowerCase();
            if (!name) return;
            if (seen.has(name)) {
              ctx.addIssue({
                code: "custom",
                message: DUPLICATE_ROLE_NAME_MESSAGE,
                path: [index, "name"],
              });
            }
            seen.add(name);
          });
        }),
    })
    .refine((data) => endsAfterStart(data.overallStart, data.overallEnd), {
      message: "Overall end time must be after overall start time",
      path: ["overallEnd"],
    })
    .refine((data) => !inPast(data.date, data.overallStart), {
      message: "Overall start time must be in the future",
      path: ["overallStart"],
    })
    .refine((data) => !inPast(data.date, data.overallEnd), {
      message: "Overall end time must be in the future",
      path: ["overallEnd"],
    })
    .refine(
      (data) =>
        data.roles.every(
          (role) =>
            !inPast(data.date, role.startTime) &&
            !inPast(data.date, role.endTime),
        ),
      {
        message: "All role times must be in the future",
        path: ["roles"],
      },
    )
    .refine(
      (data) => {
        // Check if overallStart encompasses the earliest role startTime
        if (data.roles.length === 0) return true; // Pass if no roles
        const overallStartMinutes = timeToMinutes(data.overallStart);
        const minRoleStartMinutes = Math.min(
          ...data.roles.map((role) => timeToMinutes(role.startTime)),
        );
        return (
          overallStartMinutes !== -1 &&
          minRoleStartMinutes !== -1 &&
          overallStartMinutes <= minRoleStartMinutes
        );
      },
      {
        message:
          "Overall start time must be at or before the earliest role start time",
        path: ["overallStart"],
      },
    )
    .refine(
      (data) => {
        // Check if overallEnd encompasses the latest role endTime
        if (data.roles.length === 0) return true; // Pass if no roles
        const overallEndMinutes = timeToMinutes(data.overallEnd);
        const maxRoleEndMinutes = Math.max(
          ...data.roles.map((role) => timeToMinutes(role.endTime)),
        );
        return (
          overallEndMinutes !== -1 &&
          maxRoleEndMinutes !== -1 &&
          overallEndMinutes >= maxRoleEndMinutes
        );
      },
      {
        message:
          "Overall end time must be at or after the latest role end time",
        path: ["overallEnd"],
      },
    );
}

// Schedules judged in the runtime's own timezone. Prefer the factories above
// with the project's timezone wherever one is known.
export const oneTimeSchema = createOneTimeSchema();
export const multiDaySchema = createMultiDaySchema();
export const multiRoleSchema = createMultiRoleSchema();

// Verification Settings Schema
export const verificationSettingsSchema = z.object({
  verificationMethod: z.enum([
    "qr-code",
    "manual",
    "auto",
    "signup-only",
  ] as const),
  requireLogin: z.boolean(),
  visibility: z.enum(["public", "unlisted", "organization_only"] as const),
  enableVolunteerComments: z.boolean().optional(),
  showAttendeesPublicly: z.boolean().optional(),
  waiverRequired: z.boolean().optional(),
  waiverAllowUpload: z.boolean().optional(),
  waiverDisableEsignature: z.boolean().optional(),
});

// Event Form Schema
export const eventFormSchema = z.object({
  eventType: z.enum(["oneTime", "multiDay", "sameDayMultiArea"] as const),
  basicInfo: basicInfoSchema,
  schedule: z.object({
    oneTime: oneTimeSchema,
    multiDay: multiDaySchema,
    sameDayMultiArea: multiRoleSchema,
  }),
  verificationMethod: z.enum([
    "qr-code",
    "manual",
    "auto",
    "signup-only",
  ] as const),
  requireLogin: z.boolean(),
  visibility: z.enum(["public", "unlisted", "organization_only"] as const),
  enableVolunteerComments: z.boolean().optional(),
  showAttendeesPublicly: z.boolean().optional(),
  waiverRequired: z.boolean().optional(),
  waiverAllowUpload: z.boolean().optional(),
});
