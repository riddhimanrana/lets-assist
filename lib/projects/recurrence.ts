import type {
  RecurrenceEndType,
  RecurrenceFrequency,
  RecurrenceWeekday,
} from "@/types";
import type { Project } from "@/types";

export type RecurrenceFormState = {
  enabled: boolean;
  frequency: RecurrenceFrequency;
  interval: number;
  endType: RecurrenceEndType;
  endDate?: string;
  endOccurrences?: number;
  weekdays: RecurrenceWeekday[];
};

export function buildRecurrenceRuleFromState(
  recurrenceState: RecurrenceFormState
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
    weekdays: recurrenceState.weekdays || [],
  };
}
