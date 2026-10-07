import * as z from "zod";
import type {
  Project,
  RecurrenceEndType,
  RecurrenceFrequency,
  RecurrenceWeekday,
} from "@/types";

// Constants for character limits
export const TITLE_LIMIT = 125;
export const LOCATION_LIMIT = 200;
export const DESCRIPTION_LIMIT = 2000;

// Constants for file validations
export const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_DOCUMENTS_COUNT = 5;
export const MAX_WAIVER_PDF_SIZE = 10 * 1024 * 1024; // 10MB

// Allowed file types
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

export const formSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(TITLE_LIMIT, `Title must be less than ${TITLE_LIMIT} characters`),
  description: z
    .string()
    .min(1, "Description is required")
    .max(
      DESCRIPTION_LIMIT,
      `Description must be less than ${DESCRIPTION_LIMIT} characters`,
    ),
  location: z
    .string()
    .min(1, "Location is required")
    .max(
      LOCATION_LIMIT,
      `Location must be less than ${LOCATION_LIMIT} characters`,
    ),
  location_data: z
    .object({
      text: z.string(),
      display_name: z.string().optional(),
      coordinates: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
        })
        .optional(),
    })
    .optional(),
  require_login: z.boolean(),
  enable_volunteer_comments: z.boolean(),
  show_attendees_publicly: z.boolean(),
  waiver_required: z.boolean(),
  waiver_allow_upload: z.boolean(),
  waiver_disable_esignature: z.boolean(),
  verification_method: z.enum(["qr-code", "manual", "auto", "signup-only"]),
  visibility: z.enum(["public", "unlisted", "organization_only"]),
});

export type FormValues = z.infer<typeof formSchema>;

// Helper to initialize schedule state from project
export function initializeScheduleState(project: Project) {
  const eventType = project.event_type;

  if (eventType === "oneTime" && project.schedule.oneTime) {
    return {
      oneTime: {
        date: project.schedule.oneTime.date,
        startTime: project.schedule.oneTime.startTime,
        endTime: project.schedule.oneTime.endTime,
        volunteers: project.schedule.oneTime.volunteers,
      },
      multiDay: [
        {
          date: "",
          slots: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
        },
      ],
      sameDayMultiArea: {
        date: "",
        overallStart: "",
        overallEnd: "",
        roles: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
      },
    };
  } else if (eventType === "multiDay" && project.schedule.multiDay) {
    return {
      oneTime: { date: "", startTime: "", endTime: "", volunteers: 0 },
      multiDay: project.schedule.multiDay.map((day) => ({
        date: day.date,
        slots: day.slots.map((slot) => ({
          name: slot.name || "",
          startTime: slot.startTime,
          endTime: slot.endTime,
          volunteers: slot.volunteers,
        })),
      })),
      sameDayMultiArea: {
        date: "",
        overallStart: "",
        overallEnd: "",
        roles: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
      },
    };
  } else if (
    eventType === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    return {
      oneTime: { date: "", startTime: "", endTime: "", volunteers: 0 },
      multiDay: [
        {
          date: "",
          slots: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
        },
      ],
      sameDayMultiArea: {
        date: project.schedule.sameDayMultiArea.date,
        overallStart: project.schedule.sameDayMultiArea.overallStart,
        overallEnd: project.schedule.sameDayMultiArea.overallEnd,
        roles: project.schedule.sameDayMultiArea.roles.map((role) => ({
          name: role.name,
          startTime: role.startTime,
          endTime: role.endTime,
          volunteers: role.volunteers,
        })),
      },
    };
  }

  return {
    oneTime: { date: "", startTime: "", endTime: "", volunteers: 0 },
    multiDay: [
      {
        date: "",
        slots: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
      },
    ],
    sameDayMultiArea: {
      date: "",
      overallStart: "",
      overallEnd: "",
      roles: [{ name: "", startTime: "", endTime: "", volunteers: 0 }],
    },
  };
}

// Helper to initialize recurrence state from project
export function initializeRecurrenceState(project: Project) {
  const recurrence = project.recurrence_rule;

  return {
    enabled: !!recurrence,
    frequency: (recurrence?.frequency || "weekly") as RecurrenceFrequency,
    interval: recurrence?.interval || 1,
    endType: (recurrence?.end_type || "never") as RecurrenceEndType,
    endDate: recurrence?.end_date || undefined,
    endOccurrences: recurrence?.end_occurrences || undefined,
    weekdays: (recurrence?.weekdays || []) as RecurrenceWeekday[],
  };
}
