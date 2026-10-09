import type { EventFormState } from "@/hooks/use-event-form";
import {
  RECURRENCE_WAIVER_CONFLICT_MESSAGE,
  validateRecurrenceFormState,
  type RecurrenceFieldErrors,
} from "@/lib/projects/recurrence";
import { getWaiverConfigurationError } from "@/lib/projects/waiver-validation";

export const WAIVER_DEFINITION_REQUIRED_MESSAGE =
  "Configure the waiver signers and signature fields before you continue, or turn off e-signatures.";

type WaiverStepState = Pick<
  EventFormState,
  | "waiverRequired"
  | "waiverAllowUpload"
  | "waiverDisableEsignature"
  | "waiverPdfFile"
  | "waiverPdfUrl"
  | "waiverDefinition"
  | "recurrence"
>;

/**
 * What still stops a waiver project from being created, or null. The server
 * refuses the same states; this says so on the step where they are fixed.
 */
export function getWaiverStepError(state: WaiverStepState): string | null {
  if (!state.waiverRequired) return null;
  if (state.recurrence.enabled) return RECURRENCE_WAIVER_CONFLICT_MESSAGE;

  const configurationError = getWaiverConfigurationError(state);
  if (configurationError) return configurationError;

  // An e-signature waiver is only publishable once its signature placements
  // exist. Without them the project would be saved and then refuse to publish.
  if (!state.waiverDisableEsignature && !state.waiverDefinition) {
    return WAIVER_DEFINITION_REQUIRED_MESSAGE;
  }

  return null;
}

/** The first date of the series, for the event types that can repeat. */
function getSeriesStartDate(
  state: Pick<EventFormState, "eventType" | "schedule">,
): string | null {
  if (state.eventType === "oneTime") return state.schedule.oneTime.date || null;
  if (state.eventType === "sameDayMultiArea") {
    return state.schedule.sameDayMultiArea.date || null;
  }
  return null;
}

/** Field-level problems with the repeat settings, as the server judges them. */
export function getRecurrenceStepErrors(
  state: Pick<
    EventFormState,
    "eventType" | "schedule" | "recurrence" | "waiverRequired"
  >,
): RecurrenceFieldErrors {
  return validateRecurrenceFormState(state.recurrence, {
    eventType: state.eventType,
    startDate: getSeriesStartDate(state),
    waiverRequired: state.waiverRequired,
  });
}
