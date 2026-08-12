import { createClient } from "@supabase/supabase-js";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  differenceInCalendarDays,
  format,
  isAfter,
  isBefore,
  parseISO,
} from "date-fns";
import {
  isStrictCalendarDate,
  validateProjectTimezone,
  validateRecurrenceRule,
} from "@/lib/projects/schedule-validation";

/** Hard ceiling on while-loop iterations per parent to protect against corrupt legacy rows. */
export const MAX_ITERATIONS_PER_PARENT = 500;
/** Page size, not a per-run prefix: every stable page is visited. */
export const RECURRING_PARENT_PAGE_SIZE = 20;

function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase service credentials are required.");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  end_type: "never" | "on_date" | "after_occurrences";
  end_date?: string | null;
  end_occurrences?: number | null;
  weekdays?: string[];
}

interface Project {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  location: string;
  location_data: unknown;
  event_type: string;
  schedule: Record<string, unknown>;
  verification_method: string;
  require_login: boolean;
  enable_volunteer_comments: boolean;
  show_attendees_publicly: boolean;
  organization_id: string | null;
  visibility: string;
  project_timezone: string;
  restrict_to_org_domains: boolean;
  recurrence_rule: RecurrenceRule;
  recurrence_sequence: number | null;
  recurrence_occurrence_date?: string | null;
}

type RecurringProjectsClient = ReturnType<typeof createServiceClient>;

type PostgrestErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function isNoRowsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as PostgrestErrorLike;
  return pgError.code === "PGRST116";
}

function isMultipleRowsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as PostgrestErrorLike;
  const combined =
    `${pgError.message ?? ""} ${pgError.details ?? ""}`.toLowerCase();
  return combined.includes("multiple") && combined.includes("rows");
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as PostgrestErrorLike;
  return pgError.code === "23505";
}

function isMissingRecurrenceOccurrenceDateColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const pgError = error as PostgrestErrorLike;
  const combined =
    `${pgError.message ?? ""} ${pgError.details ?? ""} ${pgError.hint ?? ""}`.toLowerCase();
  const referencesColumn = combined.includes("recurrence_occurrence_date");
  const missingColumn =
    pgError.code === "42703" ||
    combined.includes("schema cache") ||
    combined.includes("column") ||
    combined.includes("could not find");

  return referencesColumn && missingColumn;
}

function calculateNextDate(
  currentDate: Date,
  rule: RecurrenceRule,
): Date | null {
  // Use the raw interval without a falsy-fallback; validation ensures it is a
  // positive integer before this function is ever reached.
  const interval =
    typeof rule.interval === "number" && rule.interval >= 1 ? rule.interval : 1;

  switch (rule.frequency) {
    case "daily":
      return addDays(currentDate, interval);
    case "weekly":
      if (rule.weekdays && rule.weekdays.length > 0) {
        return findNextWeekday(currentDate, rule.weekdays, interval);
      }
      return addWeeks(currentDate, interval);
    case "monthly":
      return addMonths(currentDate, interval);
    case "yearly":
      return addYears(currentDate, interval);
    default:
      return null;
  }
}

function findNextWeekday(
  currentDate: Date,
  weekdays: string[],
  interval: number,
): Date {
  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const targetDays = weekdays
    .map((d) => dayMap[d.toLowerCase()])
    .filter((d) => d !== undefined);
  const currentDay = currentDate.getDay();

  for (const targetDay of targetDays.sort((a, b) => a - b)) {
    if (targetDay > currentDay) {
      return addDays(currentDate, targetDay - currentDay);
    }
  }

  const firstTargetDay = Math.min(...targetDays);
  const daysUntilNextWeek = 7 * interval - currentDay + firstTargetDay;
  return addDays(currentDate, daysUntilNextWeek);
}

function shouldGenerateOccurrence(
  rule: RecurrenceRule,
  nextDate: Date,
  currentSequence: number,
): boolean {
  if (rule.end_type === "never") {
    return true;
  }

  if (rule.end_type === "on_date" && rule.end_date) {
    const endDate = parseISO(rule.end_date);
    return !isAfter(nextDate, endDate);
  }

  if (rule.end_type === "after_occurrences" && rule.end_occurrences) {
    return currentSequence < rule.end_occurrences;
  }

  return false;
}

function getProjectDate(project: Project): Date | null {
  const schedule = project.schedule as {
    oneTime?: { date?: string };
    sameDayMultiArea?: { date?: string };
  };

  if (project.event_type === "oneTime" && schedule.oneTime?.date) {
    if (!isStrictCalendarDate(schedule.oneTime.date)) return null;
    return parseISO(schedule.oneTime.date);
  }

  if (
    project.event_type === "sameDayMultiArea" &&
    schedule.sameDayMultiArea?.date
  ) {
    if (!isStrictCalendarDate(schedule.sameDayMultiArea.date)) return null;
    return parseISO(schedule.sameDayMultiArea.date);
  }

  return null;
}

export function fastForwardNeverRecurrence(
  lastDate: Date,
  rule: RecurrenceRule,
  currentSequence: number,
  today: Date,
): { nextDate: Date | null; currentSequence: number } {
  let nextDate = calculateNextDate(lastDate, rule);
  if (rule.end_type !== "never" || !nextDate || isAfter(nextDate, today)) {
    return { nextDate, currentSequence };
  }

  // The common fixed-stride rules can jump directly across years of history.
  // currentSequence names nextDate, so it advances by the number of skipped
  // occurrences on or before today.
  if (
    rule.frequency === "daily" ||
    (rule.frequency === "weekly" && !rule.weekdays?.length)
  ) {
    const strideDays =
      rule.frequency === "daily" ? rule.interval : 7 * rule.interval;
    const skipped = Math.max(
      1,
      Math.floor(differenceInCalendarDays(today, lastDate) / strideDays),
    );
    const skippedThrough = addDays(lastDate, skipped * strideDays);
    nextDate = calculateNextDate(skippedThrough, rule);
    return {
      nextDate,
      currentSequence: currentSequence + skipped,
    };
  }

  // Month/year clamping and multi-weekday rules are not fixed-duration. Walk
  // them in memory without database calls or sleeps; the future-generation
  // defense cap below remains reserved for actual writes.
  while (nextDate && !isAfter(nextDate, today)) {
    const previousTime = nextDate.getTime();
    currentSequence += 1;
    nextDate = calculateNextDate(nextDate, rule);
    if (nextDate && nextDate.getTime() <= previousTime) {
      return { nextDate: null, currentSequence };
    }
  }

  return { nextDate, currentSequence };
}

function canLegacyDateCheck(eventType: string): boolean {
  return eventType === "oneTime" || eventType === "sameDayMultiArea";
}

async function hasExistingOccurrence(
  supabase: ReturnType<typeof createServiceClient>,
  parent: Project,
  formattedNextDate: string,
): Promise<{ exists: boolean; errorMessage?: string }> {
  const byDateResult = await supabase
    .from("projects")
    .select("id")
    .eq("recurrence_parent_id", parent.id)
    .eq("recurrence_occurrence_date", formattedNextDate)
    .limit(1)
    .maybeSingle();

  if (byDateResult.error && !isNoRowsError(byDateResult.error)) {
    if (!isMissingRecurrenceOccurrenceDateColumnError(byDateResult.error)) {
      return {
        exists: true,
        errorMessage: `Failed date-based dedupe check for ${parent.title}: ${byDateResult.error.message}`,
      };
    }
  }

  if (byDateResult.data) {
    return { exists: true };
  }

  if (!canLegacyDateCheck(parent.event_type)) {
    return { exists: false };
  }

  let legacyQuery = supabase
    .from("projects")
    .select("id")
    .eq("recurrence_parent_id", parent.id);

  if (parent.event_type === "oneTime") {
    legacyQuery = legacyQuery.filter(
      "schedule->oneTime->>date",
      "eq",
      formattedNextDate,
    );
  } else if (parent.event_type === "sameDayMultiArea") {
    legacyQuery = legacyQuery.filter(
      "schedule->sameDayMultiArea->>date",
      "eq",
      formattedNextDate,
    );
  }

  const legacyResult = await legacyQuery.limit(1).single();

  if (legacyResult.error) {
    if (isNoRowsError(legacyResult.error)) {
      return { exists: false };
    }

    if (isMultipleRowsError(legacyResult.error)) {
      return { exists: true };
    }

    return {
      exists: true,
      errorMessage: `Failed legacy dedupe check for ${parent.title}: ${legacyResult.error.message}`,
    };
  }

  return { exists: !!legacyResult.data };
}

function updateScheduleDate(
  schedule: Record<string, unknown>,
  eventType: string,
  newDate: Date,
) {
  const formattedDate = format(newDate, "yyyy-MM-dd");
  const newSchedule = JSON.parse(JSON.stringify(schedule)) as {
    oneTime?: { date?: string };
    sameDayMultiArea?: { date?: string };
  };

  if (eventType === "oneTime" && newSchedule.oneTime) {
    newSchedule.oneTime.date = formattedDate;
  } else if (eventType === "sameDayMultiArea" && newSchedule.sameDayMultiArea) {
    newSchedule.sameDayMultiArea.date = formattedDate;
  }

  return newSchedule;
}

function initializePublishedState(
  eventType: string,
  schedule: Record<string, unknown>,
): Record<string, boolean> {
  const publishedState: Record<string, boolean> = {};

  if (eventType === "oneTime") {
    publishedState.oneTime = false;
  } else if (eventType === "sameDayMultiArea") {
    const typedSchedule = schedule as {
      sameDayMultiArea?: { roles?: Array<{ name: string }> };
    };
    typedSchedule.sameDayMultiArea?.roles?.forEach((role) => {
      publishedState[role.name] = false;
    });
  }

  return publishedState;
}

export async function processRecurringProjects(
  options: {
    client?: RecurringProjectsClient;
    now?: Date;
    parentPageSize?: number;
  } = {},
): Promise<{
  processedProjects: number;
  createdOccurrences: number;
  errors: string[];
}> {
  const supabase = options.client ?? createServiceClient();
  const errors: string[] = [];
  let createdOccurrences = 0;
  const now = options.now ? new Date(options.now) : new Date();
  const lookAheadDate = addWeeks(now, 4);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let parentsProcessed = 0;
  let parentCursor: string | null = null;
  const parentPageSize = Math.max(
    1,
    Math.min(options.parentPageSize ?? RECURRING_PARENT_PAGE_SIZE, 100),
  );

  while (true) {
    let parentQuery = supabase
      .from("projects")
      .select("*")
      .not("recurrence_rule", "is", null)
      .is("recurrence_parent_id", null)
      .eq("workflow_status", "published")
      .not("status", "eq", "cancelled")
      .order("id", { ascending: true })
      .limit(parentPageSize);
    if (parentCursor) {
      parentQuery = parentQuery.gt("id", parentCursor);
    }

    const { data: parentProjects, error: fetchError } = await parentQuery;
    if (fetchError) {
      errors.push(
        `Failed loading recurring parent page: ${fetchError.message}`,
      );
      break;
    }
    if (!parentProjects || parentProjects.length === 0) break;

    for (const parent of parentProjects as Project[]) {
      try {
        const rawRule = parent.recurrence_rule;
        if (!rawRule) continue;

        // Apply legacy defaults for fields that may be absent in historic rows
        // before calling the strict validator. Cast through `unknown` first
        // because `RecurrenceRule` lacks an index signature.
        const rawRuleRecord = rawRule as unknown as Record<string, unknown>;
        const normalizedRawRule = {
          ...rawRuleRecord,
          interval: rawRuleRecord.interval ?? 1,
          end_type: rawRuleRecord.end_type ?? "never",
        };

        // Validate rule before processing; treat corrupt legacy rows as bounded
        // faults so healthy parents after them are still reached.
        const ruleValidation = validateRecurrenceRule(normalizedRawRule);
        if (!ruleValidation.ok) {
          console.warn(
            `[recurring-cron] Bounded fault — skipping parent ${parent.id} (${parent.title}): ${ruleValidation.error}`,
          );
          errors.push(
            `Skipping parent ${parent.title} (invalid recurrence_rule: ${ruleValidation.error})`,
          );
          continue;
        }
        const rule = ruleValidation.rule;

        const timezoneValidation = validateProjectTimezone(
          parent.project_timezone,
        );
        if (!timezoneValidation.ok) {
          errors.push(
            `Skipping parent ${parent.title} (invalid project_timezone: ${timezoneValidation.error})`,
          );
          continue;
        }
        parentsProcessed++;

        const latestOccurrenceResult = await supabase
          .from("projects")
          .select("id, schedule, recurrence_sequence")
          .eq("recurrence_parent_id", parent.id)
          .order("recurrence_sequence", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (
          latestOccurrenceResult.error &&
          !isNoRowsError(latestOccurrenceResult.error)
        ) {
          errors.push(
            `Failed loading latest occurrence for ${parent.title}: ${latestOccurrenceResult.error.message}`,
          );
          continue;
        }

        const latestOccurrence = latestOccurrenceResult.data;

        let currentSequence = 1;
        let lastDate: Date | null;

        if (!latestOccurrence) {
          lastDate = getProjectDate(parent);
          currentSequence = 1;
        } else {
          lastDate = getProjectDate({
            ...parent,
            schedule: latestOccurrence.schedule,
          } as Project);
          currentSequence = (latestOccurrence.recurrence_sequence || 1) + 1;
        }

        if (!lastDate) {
          continue;
        }

        const fastForwarded = fastForwardNeverRecurrence(
          lastDate,
          rule,
          currentSequence,
          today,
        );
        let { nextDate } = fastForwarded;
        currentSequence = fastForwarded.currentSequence;
        let iterationCount = 0;

        while (
          nextDate &&
          isBefore(nextDate, lookAheadDate) &&
          shouldGenerateOccurrence(rule, nextDate, currentSequence)
        ) {
          if (++iterationCount > MAX_ITERATIONS_PER_PARENT) {
            errors.push(
              `Iteration cap (${MAX_ITERATIONS_PER_PARENT}) reached for ${parent.title}; skipping remaining occurrences.`,
            );
            break;
          }

          if (isBefore(today, nextDate)) {
            const formattedNextDate = format(nextDate, "yyyy-MM-dd");

            const existingCheck = await hasExistingOccurrence(
              supabase,
              parent,
              formattedNextDate,
            );
            if (existingCheck.errorMessage) {
              errors.push(existingCheck.errorMessage);
            }

            if (!existingCheck.exists) {
              const newSchedule = updateScheduleDate(
                parent.schedule,
                parent.event_type,
                nextDate,
              );
              const publishedState = initializePublishedState(
                parent.event_type,
                newSchedule,
              );

              const insertPayload = {
                creator_id: parent.creator_id,
                title: parent.title,
                description: parent.description,
                location: parent.location,
                location_data: parent.location_data,
                event_type: parent.event_type,
                schedule: newSchedule,
                verification_method: parent.verification_method,
                require_login: parent.require_login,
                enable_volunteer_comments: parent.enable_volunteer_comments,
                show_attendees_publicly: parent.show_attendees_publicly,
                organization_id: parent.organization_id,
                visibility: parent.visibility,
                project_timezone: parent.project_timezone,
                restrict_to_org_domains: parent.restrict_to_org_domains,
                status: "upcoming",
                workflow_status: "published",
                published: publishedState,
                recurrence_parent_id: parent.id,
                recurrence_sequence: currentSequence,
                recurrence_occurrence_date: formattedNextDate,
              };

              let insertResult = await supabase
                .from("projects")
                .insert(insertPayload);

              if (
                insertResult.error &&
                isMissingRecurrenceOccurrenceDateColumnError(insertResult.error)
              ) {
                const legacyInsertPayload = { ...insertPayload } as Record<
                  string,
                  unknown
                >;
                delete legacyInsertPayload.recurrence_occurrence_date;
                insertResult = await supabase
                  .from("projects")
                  .insert(legacyInsertPayload);
              }

              const insertError = insertResult.error;

              if (insertError) {
                if (!isUniqueViolation(insertError)) {
                  errors.push(
                    `Failed to create occurrence for ${parent.title}: ${insertError.message}`,
                  );
                }
              } else {
                createdOccurrences++;
              }
            }
          }

          currentSequence++;
          nextDate = calculateNextDate(nextDate, rule);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Error processing ${parent.title}: ${errorMessage}`);
      }
    }

    parentCursor = (parentProjects.at(-1) as Project).id;
    if (parentProjects.length < parentPageSize) break;
  }

  return {
    processedProjects: parentsProcessed,
    createdOccurrences,
    errors,
  };
}
