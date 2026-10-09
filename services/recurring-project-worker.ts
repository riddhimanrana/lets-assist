import { safeConsole } from "@/lib/safe-console";
import { createClient } from "@supabase/supabase-js";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
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
/** Upper bound on the occurrence index a search may reach for one parent. */
const MAX_OCCURRENCE_INDEX = 1_000_000;

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
  signup_form_schema?: unknown;
  cover_image_url?: string | null;
  documents?: unknown;
  can_be_managed_by_staff?: boolean | null;
  pause_signups?: boolean | null;
  waiver_required?: boolean | null;
  waiver_allow_upload?: boolean | null;
  waiver_disable_esignature?: boolean | null;
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

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * The date of an occurrence, counted from the series' first date.
 *
 * Index 0 is the first date itself and index N is N steps after it. Every
 * occurrence is computed from the first date, never from the one before it, so
 * a short month only affects its own occurrence: a series that starts on
 * January 31 lands on February 28, March 31, April 30, and a series that
 * starts on February 29 returns to February 29 in the next leap year.
 *
 * A weekly rule with weekdays visits each chosen weekday left in the first
 * date's week (Sunday to Saturday), then every chosen weekday of each
 * `interval`-th week after it.
 */
export function getOccurrenceDate(
  firstDate: Date,
  rule: RecurrenceRule,
  occurrenceIndex: number,
): Date | null {
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) return null;
  if (occurrenceIndex === 0) return firstDate;

  // Validation ensures the interval is a positive integer before this is
  // reached; anything else is treated as 1.
  const interval =
    typeof rule.interval === "number" && rule.interval >= 1 ? rule.interval : 1;

  switch (rule.frequency) {
    case "daily":
      return addDays(firstDate, occurrenceIndex * interval);
    case "weekly": {
      const targetDays = [
        ...new Set(
          (rule.weekdays ?? [])
            .map((day) => WEEKDAY_INDEX[day.toLowerCase()])
            .filter((day) => day !== undefined),
        ),
      ].sort((left, right) => left - right);
      if (targetDays.length === 0) {
        return addWeeks(firstDate, occurrenceIndex * interval);
      }

      const firstDay = firstDate.getDay();
      const weekStart = addDays(firstDate, -firstDay);
      const laterThisWeek = targetDays.filter((day) => day > firstDay);
      if (occurrenceIndex <= laterThisWeek.length) {
        return addDays(weekStart, laterThisWeek[occurrenceIndex - 1]);
      }

      const offset = occurrenceIndex - laterThisWeek.length - 1;
      const week = 1 + Math.floor(offset / targetDays.length);
      return addDays(
        weekStart,
        7 * interval * week + targetDays[offset % targetDays.length],
      );
    }
    case "monthly":
      return addMonths(firstDate, occurrenceIndex * interval);
    case "yearly":
      return addYears(firstDate, occurrenceIndex * interval);
    default:
      return null;
  }
}

/**
 * The first occurrence index, at or above `minimumIndex`, whose date is after
 * `boundary`. Occurrence dates only move forward, so a doubling search finds
 * it without walking years of history one occurrence at a time.
 */
export function firstOccurrenceIndexAfter(
  firstDate: Date,
  rule: RecurrenceRule,
  boundary: Date,
  minimumIndex = 1,
): number | null {
  const isPastBoundary = (index: number): boolean | null => {
    const date = getOccurrenceDate(firstDate, rule, index);
    return date ? isAfter(date, boundary) : null;
  };

  const atMinimum = isPastBoundary(minimumIndex);
  if (atMinimum === null) return null;
  if (atMinimum) return minimumIndex;

  let low = minimumIndex;
  let high = minimumIndex + 1;
  for (let step = 1; ; step *= 2) {
    if (high > MAX_OCCURRENCE_INDEX) return null;
    const past = isPastBoundary(high);
    if (past === null) return null;
    if (past) break;
    low = high;
    high += step * 2;
  }

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (isPastBoundary(middle)) high = middle;
    else low = middle;
  }

  return high;
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

  let occurrenceDateColumnMissing = false;
  if (byDateResult.error && !isNoRowsError(byDateResult.error)) {
    if (!isMissingRecurrenceOccurrenceDateColumnError(byDateResult.error)) {
      return {
        exists: true,
        errorMessage: `Failed date-based dedupe check for ${parent.title}: ${byDateResult.error.message}`,
      };
    }
    occurrenceDateColumnMissing = true;
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

  // The schedule date only identifies an occurrence that predates
  // recurrence_occurrence_date. A newer occurrence whose date an organizer
  // edited must not be mistaken for a different one.
  if (!occurrenceDateColumnMissing) {
    legacyQuery = legacyQuery.is("recurrence_occurrence_date", null);
  }

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
  checkedProjects: number;
  successfulProjects: number;
  failedParents: number;
  /** Series left alone because a repeating project cannot require a waiver. */
  skippedWaiverParents: number;
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
  let checkedProjects = 0;
  let successfulProjects = 0;
  let failedParents = 0;
  let skippedWaiverParents = 0;
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
      checkedProjects++;
      const previousErrors = errors.length;
      try {
        const rawRule = parent.recurrence_rule;
        if (!rawRule) {
          errors.push(`Missing recurrence rule for ${parent.title}`);
          continue;
        }

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
          safeConsole.warn(
            "Application diagnostic from services/recurring-project-worker",
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
        // A generated occurrence is a new project, and a waiver PDF has to
        // live under its own project's prefix. Until occurrences can carry
        // their own copy, generating them would publish events that require
        // no waiver at all, so the series is left alone and reported.
        if (parent.waiver_required === true) {
          skippedWaiverParents++;
          safeConsole.warn(
            "Application diagnostic from services/recurring-project-worker",
            `[recurring-cron] Skipping parent ${parent.id}: a repeating project cannot require a waiver.`,
          );
          errors.push(
            `Skipping parent ${parent.title} (a repeating project cannot require a waiver)`,
          );
          continue;
        }
        parentsProcessed++;

        // The series is anchored to the parent's own date. Every occurrence
        // is that date plus a whole number of steps.
        const firstDate = getProjectDate(parent);
        if (!firstDate) {
          errors.push(`Invalid occurrence date for ${parent.title}`);
          continue;
        }

        // The last generated occurrence is the one with the latest
        // recurrence_occurrence_date. That column is written once by this
        // worker and cannot be edited, unlike the occurrence's schedule.
        const latestOccurrenceResult = await supabase
          .from("projects")
          .select(
            "id, schedule, recurrence_sequence, recurrence_occurrence_date",
          )
          .eq("recurrence_parent_id", parent.id)
          .order("recurrence_occurrence_date", {
            ascending: false,
            nullsFirst: false,
          })
          .order("recurrence_sequence", { ascending: false, nullsFirst: false })
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
        let nextIndex = 1;

        if (latestOccurrence) {
          const lastSequence = latestOccurrence.recurrence_sequence;
          if (typeof lastSequence === "number" && lastSequence >= 1) {
            nextIndex = lastSequence + 1;
          }

          const recordedDate = latestOccurrence.recurrence_occurrence_date;
          // Occurrences generated before the column existed fall back to
          // their schedule date, which is all they ever recorded.
          const lastDate =
            typeof recordedDate === "string" &&
            isStrictCalendarDate(recordedDate)
              ? parseISO(recordedDate)
              : getProjectDate({
                  ...parent,
                  schedule: latestOccurrence.schedule,
                });

          if (lastDate) {
            const indexAfterLast = firstOccurrenceIndexAfter(
              firstDate,
              rule,
              lastDate,
            );
            if (indexAfterLast === null) {
              errors.push(`Invalid recurrence position for ${parent.title}`);
              continue;
            }
            nextIndex = Math.max(nextIndex, indexAfterLast);
          }
        }

        // Occurrences dated today or earlier are never created, so skip
        // straight to the first one after today.
        const firstFutureIndex = firstOccurrenceIndexAfter(
          firstDate,
          rule,
          today,
          nextIndex,
        );
        if (firstFutureIndex === null) {
          errors.push(`Invalid recurrence position for ${parent.title}`);
          continue;
        }

        let iterationCount = 0;

        for (let occurrenceIndex = firstFutureIndex; ; occurrenceIndex++) {
          const occurrenceDate = getOccurrenceDate(
            firstDate,
            rule,
            occurrenceIndex,
          );
          if (
            !occurrenceDate ||
            !isBefore(occurrenceDate, lookAheadDate) ||
            !shouldGenerateOccurrence(rule, occurrenceDate, occurrenceIndex)
          ) {
            break;
          }

          if (++iterationCount > MAX_ITERATIONS_PER_PARENT) {
            errors.push(
              `Iteration cap (${MAX_ITERATIONS_PER_PARENT}) reached for ${parent.title}; skipping remaining occurrences.`,
            );
            break;
          }

          const formattedOccurrenceDate = format(occurrenceDate, "yyyy-MM-dd");

          const existingCheck = await hasExistingOccurrence(
            supabase,
            parent,
            formattedOccurrenceDate,
          );
          if (existingCheck.errorMessage) {
            errors.push(existingCheck.errorMessage);
          }
          if (existingCheck.exists) continue;

          const newSchedule = updateScheduleDate(
            parent.schedule,
            parent.event_type,
            occurrenceDate,
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
            // An occurrence is the same event on another day, so it keeps the
            // sign-up questions, cover image, documents and management
            // settings of its series. The cover image and documents are the
            // parent's own stored files, shared by reference.
            signup_form_schema: parent.signup_form_schema,
            cover_image_url: parent.cover_image_url,
            documents: parent.documents,
            can_be_managed_by_staff: parent.can_be_managed_by_staff,
            pause_signups: parent.pause_signups,
            waiver_allow_upload: parent.waiver_allow_upload,
            waiver_disable_esignature: parent.waiver_disable_esignature,
            status: "upcoming",
            workflow_status: "published",
            published: publishedState,
            recurrence_parent_id: parent.id,
            recurrence_sequence: occurrenceIndex,
            recurrence_occurrence_date: formattedOccurrenceDate,
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
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Error processing ${parent.title}: ${errorMessage}`);
      } finally {
        if (errors.length > previousErrors) failedParents++;
        else successfulProjects++;
      }
    }

    parentCursor = (parentProjects.at(-1) as Project).id;
    if (parentProjects.length < parentPageSize) break;
  }

  return {
    processedProjects: parentsProcessed,
    checkedProjects,
    successfulProjects,
    failedParents,
    skippedWaiverParents,
    createdOccurrences,
    errors,
  };
}
