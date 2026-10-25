import "server-only";

import { safeConsole } from "@/lib/safe-console";
import type { ValidatedProjectSchedule } from "@/lib/projects/schedule-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type DatabaseErrorLike = { code?: unknown; message?: unknown };

function readDatabaseError(error: unknown): DatabaseErrorLike {
  return error && typeof error === "object" ? error : {};
}

export function isDuplicateKeyError(error: unknown): boolean {
  return readDatabaseError(error).code === "23505";
}

export function normalizeIdempotencyKey(key: unknown): string | null {
  return typeof key === "string" && UUID_PATTERN.test(key.trim())
    ? key.trim().toLowerCase()
    : null;
}

/**
 * Every session of a new project starts with its hours unpublished. Keys match
 * the ones the hours-publication flow reads: "oneTime", a role name, or
 * "date-dayIndex-slotIndex" (unique even when two days share a date).
 */
export function buildInitialPublishedState(
  schedule: ValidatedProjectSchedule,
): Record<string, boolean> {
  const publishedState: Record<string, boolean> = {};

  if ("oneTime" in schedule) {
    publishedState.oneTime = false;
  } else if ("multiDay" in schedule) {
    schedule.multiDay.forEach((day, dayIndex) => {
      day.slots.forEach((_slot, slotIndex) => {
        publishedState[`${day.date}-${dayIndex}-${slotIndex}`] = false;
      });
    });
  } else {
    for (const role of schedule.sameDayMultiArea.roles) {
      publishedState[role.name] = false;
    }
  }

  return publishedState;
}

/**
 * Turns a database refusal the user can fix into a sentence about what to
 * fix. Returns null for everything else, which stays a generic failure.
 *
 * 23514 is the published-schedule guard (and any check constraint); 22023 is
 * the timezone and recurrence-rule contract.
 */
export function describeProjectWriteError(error: unknown): string | null {
  const { code, message } = readDatabaseError(error);
  const text = typeof message === "string" ? message : "";

  if (code === "23514") {
    return "This project's schedule could not be saved. Check that every date and time is valid for the project's time zone, then try again.";
  }

  if (code === "22023") {
    if (text.includes("project_timezone")) {
      return "The project time zone is not valid. Choose a time zone from the list and try again.";
    }
    if (text.includes("recurrence")) {
      return "The repeat schedule is not valid. Check how often the project repeats and when it ends, then try again.";
    }
    return "Some schedule settings are not valid. Check the dates, time zone and repeat schedule, then try again.";
  }

  return null;
}

/**
 * Logs the database's own code and message. The row detail a constraint
 * failure carries is left out: it holds the project's content.
 */
export function logProjectWriteError(context: string, error: unknown): void {
  const { code, message } = readDatabaseError(error);
  safeConsole.error(context, {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  });
}
