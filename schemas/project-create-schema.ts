import { z } from "zod";

import {
  buildRecurrenceRuleFromState,
  firstRecurrenceError,
  validateRecurrenceFormState,
} from "@/lib/projects/recurrence";
import {
  validateProjectSchedule,
  validateProjectTimezone,
  validateRecurrenceRule,
  type ValidatedProjectSchedule,
  type ValidatedRecurrenceRule,
} from "@/lib/projects/schedule-validation";
import type { EventType } from "@/types";

import {
  basicInfoSchema,
  createMultiDaySchema,
  createMultiRoleSchema,
  createOneTimeSchema,
  type ScheduleSchemaOptions,
} from "./event-form-schema";

export const DEFAULT_PROJECT_TIMEZONE = "America/Los_Angeles";

const GENERIC_PAYLOAD_MESSAGE =
  "Some project details are missing or not valid. Review each step and try again.";
const GENERIC_SCHEDULE_MESSAGE =
  "Check the schedule dates, times and volunteer counts, then try again.";

const eventTypeSchema = z.enum(["oneTime", "multiDay", "sameDayMultiArea"]);

const locationDataSchema = z.object({
  text: z.string().max(500),
  display_name: z.string().max(500).nullish(),
  coordinates: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .nullish(),
});

const numberOrNaN = z
  .unknown()
  .optional()
  .transform((value) => (typeof value === "number" ? value : Number.NaN));

// Shape only. Ranges and combinations are judged by
// validateRecurrenceFormState so each problem gets a plain message.
const recurrenceFormSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: numberOrNaN,
  endType: z.enum(["never", "on_date", "after_occurrences"]),
  endDate: z.string().nullish(),
  endOccurrences: z
    .unknown()
    .optional()
    .transform((value) => (typeof value === "number" ? value : undefined)),
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
    .max(7)
    .nullish(),
});

const signupFormFieldSchema = z.looseObject({
  key: z.string().min(1).max(200),
  label: z.string().max(1000),
  type: z.enum([
    "text",
    "email",
    "tel",
    "number",
    "textarea",
    "select",
    "multi-select",
    "checkbox",
    "radio",
    "date",
    "file",
    "heading",
    "paragraph",
  ]),
});

const signupFormSchemaSchema = z.looseObject({
  version: z.literal(1),
  sections: z
    .array(
      z.looseObject({
        fields: z.array(signupFormFieldSchema).max(200),
      }),
    )
    .max(50),
});

const createProjectEnvelopeSchema = z.object({
  eventType: eventTypeSchema,
  basicInfo: basicInfoSchema.extend({
    locationData: locationDataSchema.nullish(),
    organizationId: z.string().min(1).nullish(),
    projectTimezone: z.string().nullish(),
  }),
  schedule: z.record(z.string(), z.unknown()),
  verificationMethod: z.enum(["qr-code", "manual", "auto", "signup-only"]),
  requireLogin: z.boolean().nullish(),
  visibility: z.enum(["public", "unlisted", "organization_only"]).nullish(),
  restrictToOrgDomains: z.boolean().nullish(),
  enableVolunteerComments: z.boolean().nullish(),
  showAttendeesPublicly: z.boolean().nullish(),
  waiverRequired: z.boolean().nullish(),
  waiverAllowUpload: z.boolean().nullish(),
  waiverDisableEsignature: z.boolean().nullish(),
  // A browser File serializes to an empty object. It is only ever a marker
  // that a PDF was chosen, never the document itself.
  waiverPdfFile: z.unknown().optional(),
  waiverPdfUrl: z.string().nullish(),
  recurrence: recurrenceFormSchema.nullish(),
  signupFormSchema: signupFormSchemaSchema.nullish(),
  pluginData: z.record(z.string(), z.unknown()).nullish(),
  creationIdempotencyKey: z.string().nullish(),
});

type CreateProjectEnvelope = z.infer<typeof createProjectEnvelopeSchema>;

export type ValidatedCreateProject = {
  eventType: EventType;
  basicInfo: {
    title: string;
    location: string;
    description: string;
    locationData: z.infer<typeof locationDataSchema> | null;
    organizationId: string | null;
    projectTimezone: string;
  };
  schedule: ValidatedProjectSchedule;
  verificationMethod: CreateProjectEnvelope["verificationMethod"];
  requireLogin: boolean;
  visibility: NonNullable<CreateProjectEnvelope["visibility"]>;
  restrictToOrgDomains: boolean;
  enableVolunteerComments: boolean;
  showAttendeesPublicly: boolean;
  waiverRequired: boolean;
  waiverAllowUpload: boolean;
  waiverDisableEsignature: boolean;
  waiverPdfFile: unknown;
  waiverPdfUrl: string | null;
  recurrenceRule: ValidatedRecurrenceRule | null;
  signupFormSchema: z.infer<typeof signupFormSchemaSchema> | null;
  pluginData: Record<string, unknown>;
  creationIdempotencyKey: string | null;
};

export type ProjectValidationResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

const REQUIRED_FIELD_MESSAGES: Record<string, string> = {
  "basicInfo.title": "Title is required",
  "basicInfo.location": "Location is required",
  "basicInfo.description": "Description is required",
  eventType: "Choose an event type.",
  verificationMethod: "Choose how attendance is tracked.",
  schedule: "Add a date and time for this project.",
};

const LIBRARY_MESSAGE_PATTERN =
  /^(?:Invalid|Too big|Too small|Unrecognized|Expected)\b/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Messages we wrote are shown as they are; the library's own are replaced. */
function plainIssueMessage(issue: z.core.$ZodIssue, fallback: string): string {
  const path = issue.path.join(".");
  if (!LIBRARY_MESSAGE_PATTERN.test(issue.message)) return issue.message;
  return REQUIRED_FIELD_MESSAGES[path] ?? fallback;
}

/** The start date a series is anchored to, when the event type has one. */
export function getScheduleStartDate(
  schedule: ValidatedProjectSchedule,
): string | null {
  if ("oneTime" in schedule) return schedule.oneTime.date;
  if ("sameDayMultiArea" in schedule) return schedule.sameDayMultiArea.date;
  return schedule.multiDay[0]?.date ?? null;
}

/**
 * The schedule rules a project must meet to be published: the form's own
 * (at least one volunteer, an end after its start, nothing in the past in the
 * project's timezone, unique role names) and then the strict stored shape.
 */
export function validateScheduleForPublication(
  eventType: EventType,
  schedule: unknown,
  options: ScheduleSchemaOptions = {},
): ProjectValidationResult<ValidatedProjectSchedule> {
  const active = isRecord(schedule) ? schedule[eventType] : undefined;
  if (active === undefined || active === null) {
    return { ok: false, error: REQUIRED_FIELD_MESSAGES.schedule };
  }

  const formSchema =
    eventType === "oneTime"
      ? createOneTimeSchema(options)
      : eventType === "multiDay"
        ? createMultiDaySchema(options)
        : createMultiRoleSchema(options);
  const formResult = formSchema.safeParse(active);
  if (!formResult.success) {
    return {
      ok: false,
      error: plainIssueMessage(
        formResult.error.issues[0],
        GENERIC_SCHEDULE_MESSAGE,
      ),
    };
  }

  const strict = validateProjectSchedule(eventType, {
    [eventType]: formResult.data,
  });
  if (!strict.ok) {
    return {
      ok: false,
      error: `The schedule is not valid: ${strict.error}.`,
    };
  }

  return { ok: true, data: strict.schedule };
}

/**
 * Parses what the create form sends into the values the create action stores.
 * The schema is built from the form's own schemas, so the browser and the
 * server agree on every limit.
 */
export function parseCreateProjectPayload(
  input: unknown,
  options: { now?: () => Date } = {},
): ProjectValidationResult<ValidatedCreateProject> {
  const envelope = createProjectEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    return {
      ok: false,
      error: plainIssueMessage(
        envelope.error.issues[0],
        GENERIC_PAYLOAD_MESSAGE,
      ),
    };
  }
  const data = envelope.data;

  const projectTimezone =
    data.basicInfo.projectTimezone || DEFAULT_PROJECT_TIMEZONE;
  const timezoneResult = validateProjectTimezone(projectTimezone);
  if (!timezoneResult.ok) {
    return {
      ok: false,
      error: `Invalid project timezone: ${timezoneResult.error}`,
    };
  }

  const scheduleResult = validateScheduleForPublication(
    data.eventType,
    data.schedule,
    { timeZone: projectTimezone, now: options.now },
  );
  if (!scheduleResult.ok) return scheduleResult;

  const waiverRequired = data.waiverRequired ?? false;
  let recurrenceRule: ValidatedRecurrenceRule | null = null;
  if (data.recurrence?.enabled) {
    const recurrence = {
      ...data.recurrence,
      endDate: data.recurrence.endDate ?? undefined,
      weekdays: data.recurrence.weekdays ?? [],
    };
    const recurrenceError = firstRecurrenceError(
      validateRecurrenceFormState(recurrence, {
        eventType: data.eventType,
        startDate: getScheduleStartDate(scheduleResult.data),
      }),
    );
    if (recurrenceError) return { ok: false, error: recurrenceError };

    const ruleResult = validateRecurrenceRule(
      buildRecurrenceRuleFromState(recurrence),
    );
    if (!ruleResult.ok) {
      return {
        ok: false,
        error: `Invalid recurrence rule: ${ruleResult.error}`,
      };
    }
    recurrenceRule = ruleResult.rule;
  }

  return {
    ok: true,
    data: {
      eventType: data.eventType,
      basicInfo: {
        title: data.basicInfo.title,
        location: data.basicInfo.location,
        description: data.basicInfo.description,
        locationData: data.basicInfo.locationData ?? null,
        organizationId: data.basicInfo.organizationId ?? null,
        projectTimezone,
      },
      schedule: scheduleResult.data,
      verificationMethod: data.verificationMethod,
      requireLogin: data.requireLogin ?? true,
      visibility: data.visibility ?? "unlisted",
      restrictToOrgDomains: data.restrictToOrgDomains ?? false,
      enableVolunteerComments: data.enableVolunteerComments ?? false,
      showAttendeesPublicly: data.showAttendeesPublicly ?? false,
      waiverRequired,
      waiverAllowUpload: data.waiverAllowUpload ?? true,
      waiverDisableEsignature: data.waiverDisableEsignature ?? false,
      waiverPdfFile: data.waiverPdfFile,
      waiverPdfUrl: data.waiverPdfUrl ?? null,
      recurrenceRule,
      signupFormSchema: data.signupFormSchema ?? null,
      pluginData: data.pluginData ?? {},
      creationIdempotencyKey: data.creationIdempotencyKey ?? null,
    },
  };
}
