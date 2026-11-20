import {
  basicInfoSchema,
  createMultiDaySchema,
} from "@/schemas/event-form-schema";
import { isDateTimeInPast } from "@/schemas/event-form-helpers";
import {
  importPreviewSchema,
  importPreviewToDraft,
  type ImportPreview,
} from "./model";
import { readSourceDateTime } from "./timing";

export type ImportReadinessIssues = Record<string, string>;

/** Destination validation is separate from bounded source preservation. Never truncate source facts. */
export function getImportReadinessIssues(
  input: ImportPreview,
  now = new Date(),
): ImportReadinessIssues {
  const issues: ImportReadinessIssues = {};
  const parsed = importPreviewSchema.safeParse(input);
  if (!parsed.success) {
    for (const error of parsed.error.issues)
      issues[error.path.join(".") || "form"] ??= error.message;
    return issues;
  }
  const preview = parsed.data;
  if (!preview.timezone)
    issues.timezone = "Choose the event timezone before continuing.";
  // This placeholder inspects text limits only. It is never emitted or saved.
  const draft = importPreviewToDraft({
    ...preview,
    timezone: preview.timezone ?? "UTC",
  });
  const basic = basicInfoSchema.safeParse(draft.basicInfo);
  if (!basic.success)
    for (const error of basic.error.issues)
      issues[error.path.join(".")] ??= error.message;
  const days = [...new Set(preview.slots.map((s) => s.date))].sort();
  const schedule = createMultiDaySchema({
    timeZone: preview.timezone ?? "UTC",
    now: () => now,
  }).safeParse(draft.schedule?.multiDay);
  if (!schedule.success) {
    for (const error of schedule.error.issues) {
      const [dayIndex, , slotIndex, field] = error.path;
      if (
        typeof dayIndex === "number" &&
        typeof slotIndex === "number" &&
        typeof field === "string"
      ) {
        const matching = preview.slots
          .map((slot, index) => ({ slot, index }))
          .filter(({ slot }) => slot.date === days[dayIndex]);
        const original = matching[slotIndex]?.index;
        if (original !== undefined)
          issues[
            `slots.${original}.${field === "volunteers" ? "capacity" : field}`
          ] ??= error.message;
      }
    }
  }
  preview.slots.forEach((slot, index) => {
    if (!preview.timezone) return;
    if (
      isDateTimeInPast(slot.date, slot.startTime, preview.timezone!, now) ||
      isDateTimeInPast(slot.date, slot.endTime, preview.timezone!, now)
    )
      issues[`slots.${index}.date`] =
        "This event is in the past. Correct its date explicitly to create a future project.";
    for (const edge of ["start", "end"] as const) {
      const source = readSourceDateTime(slot.sourceTiming?.[edge]);
      const wallTime = edge === "start" ? slot.startTime : slot.endTime;
      // An explicit edit intentionally replaces the source timing. Retain its provenance in the preview.
      if (
        !source?.offset ||
        source.date !== slot.date ||
        source.time !== wallTime ||
        source.instant === null
      )
        continue;
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: preview.timezone!,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(source.instant));
      const part = (name: string) =>
        parts.find((p) => p.type === name)?.value ?? "";
      if (
        `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}` !==
        `${slot.date}T${wallTime}`
      )
        issues.timezone = `The chosen timezone conflicts with the source offset (${source.offset}) for slot ${index + 1}. Choose a matching event timezone or explicitly correct its timing.`;
    }
  });
  if (!schedule.success && !Object.keys(issues).length)
    issues.form =
      schedule.error.issues[0]?.message ?? "Review the imported schedule.";
  return issues;
}
