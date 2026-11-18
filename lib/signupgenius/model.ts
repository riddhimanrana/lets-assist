import { z } from "zod";
import type { EventFormState } from "@/hooks/use-event-form";
import { canonicalSignUpGeniusUrl } from "./url";
import { readSourceDateTime } from "./timing";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((s) => {
    const parsed = new Date(`${s}T12:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === s
    );
  });
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (s) =>
        !/[<>]/u.test(s) &&
        ![...s].some(
          (c) => c.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(c),
        ),
    );
export const importPreviewSchema = z
  .object({
    sourceUrl: z.string().refine((s) => {
      try {
        return canonicalSignUpGeniusUrl(s) === s;
      } catch {
        return false;
      }
    }),
    title: text(200).min(1),
    description: text(10000),
    location: text(500),
    timezone: z
      .string()
      .max(100)
      .refine(
        (s) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: s });
            return true;
          } catch {
            return false;
          }
        },
        {
          message: "Enter a valid event timezone, such as America/Los_Angeles.",
        },
      )
      .nullable(),
    slots: z
      .array(
        z
          .object({
            name: text(200).min(1),
            date,
            startTime: time,
            endTime: time,
            capacity: z.number().int().min(1).max(10000),
            sourceTiming: z
              .object({
                start: z
                  .string()
                  .max(40)
                  .refine((s) => readSourceDateTime(s) !== null),
                end: z
                  .string()
                  .max(40)
                  .refine((s) => readSourceDateTime(s) !== null),
              })
              .strict()
              .optional(),
          })
          .strict()
          .refine((s) => s.endTime > s.startTime, {
            path: ["endTime"],
            message: "End time must be after start time",
          }),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export function isHistoricalImport(
  preview: ImportPreview,
  now = new Date(),
): boolean {
  let timezone = preview.timezone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    timezone = "UTC";
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return preview.slots.some((slot) => slot.date < today);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Projection into the existing editor only; this never creates or publishes a project. */
export function importPreviewToDraft(
  input: unknown,
  organizationId: string | null = null,
): Partial<EventFormState> {
  const p = importPreviewSchema.parse(input);
  if (!p.timezone)
    throw new Error("Choose the event timezone before continuing.");
  const days = [...new Set(p.slots.map((s) => s.date))].sort();
  return {
    step: 1,
    eventType: "multiDay",
    visibility: "unlisted",
    requireLogin: true,
    showAttendeesPublicly: false,
    enableVolunteerComments: false,
    basicInfo: {
      title: p.title,
      description: `<p>${escapeHtml(p.description).replaceAll("\n", "<br>")}</p>`,
      location: p.location,
      organizationId,
      projectTimezone: p.timezone,
    },
    schedule: {
      oneTime: { date: "", startTime: "", endTime: "", volunteers: 1 },
      sameDayMultiArea: {
        date: "",
        overallStart: "",
        overallEnd: "",
        roles: [],
      },
      multiDay: days.map((d) => ({
        date: d,
        slots: p.slots
          .filter((s) => s.date === d)
          .map((s) => ({
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            volunteers: s.capacity,
          })),
      })),
    },
  };
}
