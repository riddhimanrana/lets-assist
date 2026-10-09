import type {
  EventType,
  RecurrenceEndType,
  RecurrenceFrequency,
  RecurrenceWeekday,
} from "@/types";
import type { Project } from "@/types";

import {
  RECURRENCE_INTERVAL_MAX,
  RECURRENCE_OCCURRENCE_MAX,
  isStrictCalendarDate,
} from "./schedule-validation";

export type RecurrenceFormState = {
  enabled: boolean;
  frequency: RecurrenceFrequency;
  interval: number;
  endType: RecurrenceEndType;
  endDate?: string;
  endOccurrences?: number;
  weekdays: RecurrenceWeekday[];
};

/**
 * A generated occurrence gets a new project id, and a waiver PDF is stored
 * under its own project's prefix. Until occurrences can carry their own copy,
 * a series cannot require a waiver.
 */
export const RECURRENCE_WAIVER_CONFLICT_MESSAGE =
  "Repeating projects cannot require a waiver yet. Turn off the waiver or the repeat schedule.";

export const RECURRENCE_MULTI_DAY_MESSAGE =
  "Multi-day projects cannot repeat. Turn off the repeat schedule or choose a different event type.";

export type RecurrenceField =
  "enabled" | "interval" | "weekdays" | "endDate" | "endOccurrences";

export type RecurrenceFieldErrors = Partial<Record<RecurrenceField, string>>;

/** Only the fields that apply to the chosen frequency and end type are sent. */
export function buildRecurrenceRuleFromState(
  recurrenceState: RecurrenceFormState,
): Project["recurrence_rule"] {
  if (!recurrenceState.enabled) {
    return null;
  }

  return {
    frequency: recurrenceState.frequency,
    interval: recurrenceState.interval || 1,
    end_type: recurrenceState.endType,
    end_date:
      recurrenceState.endType === "on_date"
        ? recurrenceState.endDate || null
        : null,
    end_occurrences:
      recurrenceState.endType === "after_occurrences"
        ? recurrenceState.endOccurrences || null
        : null,
    weekdays:
      recurrenceState.frequency === "weekly"
        ? recurrenceState.weekdays || []
        : [],
  };
}

/**
 * Checks the repeat settings the way the form shows them, one message per
 * field, before a rule is built. The create step and the create action both
 * call this, so the browser and the server refuse the same states.
 */
export function validateRecurrenceFormState(
  recurrence: RecurrenceFormState | null | undefined,
  context: {
    eventType: EventType;
    /** First event date, YYYY-MM-DD. The series cannot end before it. */
    startDate?: string | null;
    waiverRequired?: boolean | null;
  },
): RecurrenceFieldErrors {
  const errors: RecurrenceFieldErrors = {};
  if (!recurrence?.enabled) return errors;

  if (context.eventType === "multiDay") {
    errors.enabled = RECURRENCE_MULTI_DAY_MESSAGE;
    return errors;
  }

  if (context.waiverRequired) {
    errors.enabled = RECURRENCE_WAIVER_CONFLICT_MESSAGE;
  }

  if (
    !Number.isInteger(recurrence.interval) ||
    recurrence.interval < 1 ||
    recurrence.interval > RECURRENCE_INTERVAL_MAX
  ) {
    errors.interval = `Repeat interval must be a whole number from 1 to ${RECURRENCE_INTERVAL_MAX}.`;
  }

  if (
    recurrence.frequency === "weekly" &&
    (recurrence.weekdays ?? []).length === 0
  ) {
    errors.weekdays = "Select at least one day of the week.";
  }

  if (recurrence.endType === "on_date") {
    if (!recurrence.endDate || !isStrictCalendarDate(recurrence.endDate)) {
      errors.endDate = "Choose the date the series ends.";
    } else if (context.startDate && recurrence.endDate <= context.startDate) {
      errors.endDate = "The end date must be after the first event date.";
    }
  }

  if (recurrence.endType === "after_occurrences") {
    const count = recurrence.endOccurrences;
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > RECURRENCE_OCCURRENCE_MAX
    ) {
      errors.endOccurrences = `Enter a number of events from 1 to ${RECURRENCE_OCCURRENCE_MAX}.`;
    }
  }

  return errors;
}

const RECURRENCE_FIELD_ORDER: RecurrenceField[] = [
  "enabled",
  "interval",
  "weekdays",
  "endDate",
  "endOccurrences",
];

/** The first repeat-settings problem, in the order the fields appear. */
export function firstRecurrenceError(
  errors: RecurrenceFieldErrors,
): string | null {
  for (const field of RECURRENCE_FIELD_ORDER) {
    const message = errors[field];
    if (message) return message;
  }
  return null;
}

/**
 * The reason an edit is refused because it would leave a series parent both
 * repeating and requiring a waiver, or null. `undefined` means the edit does
 * not touch that setting. An edit that turns neither on is never refused, so a
 * project already in this state can still have its other details corrected.
 */
export function getRecurrenceWaiverEditError(edit: {
  isOccurrence: boolean;
  currentRule: unknown;
  nextRule: unknown;
  currentWaiverRequired: boolean | null | undefined;
  nextWaiverRequired: boolean | null | undefined;
}): string | null {
  if (edit.isOccurrence) return null;

  const willRepeat =
    edit.nextRule === undefined
      ? edit.currentRule != null
      : edit.nextRule !== null;
  const willRequireWaiver =
    (edit.nextWaiverRequired ?? edit.currentWaiverRequired) === true;

  // The edit form resends both settings on every save. Only a save that
  // turns one of them on is a new conflict.
  const turnsOnRepeat = willRepeat && edit.currentRule == null;
  const turnsOnWaiver =
    willRequireWaiver && edit.currentWaiverRequired !== true;
  if (!turnsOnRepeat && !turnsOnWaiver) return null;

  return willRepeat && willRequireWaiver
    ? RECURRENCE_WAIVER_CONFLICT_MESSAGE
    : null;
}
