import { describe, expect, test } from "bun:test";

import { createInitialEventFormState } from "@/hooks/use-event-form";
import { RECURRENCE_WAIVER_CONFLICT_MESSAGE } from "@/lib/projects/recurrence";

import {
  WAIVER_DEFINITION_REQUIRED_MESSAGE,
  getRecurrenceStepErrors,
  getWaiverStepError,
} from "./create-blockers";

const definition = { signers: [], fields: [] } as never;
const pdf = {} as never;

function waiverState(overrides: Record<string, unknown> = {}) {
  return {
    ...createInitialEventFormState(),
    waiverRequired: true,
    waiverPdfFile: pdf,
    waiverDefinition: definition,
    ...overrides,
  };
}

describe("what blocks a waiver project on the settings step", () => {
  test("a project without a waiver is never blocked", () => {
    expect(getWaiverStepError(createInitialEventFormState())).toBeNull();
  });

  test("a complete waiver setup passes", () => {
    expect(getWaiverStepError(waiverState())).toBeNull();
  });

  test("a required waiver with no PDF names the PDF", () => {
    expect(getWaiverStepError(waiverState({ waiverPdfFile: null }))).toBe(
      "A waiver PDF is required before you can continue.",
    );
  });

  test("both signing modes off is refused before the project is saved", () => {
    expect(
      getWaiverStepError(
        waiverState({
          waiverDisableEsignature: true,
          waiverAllowUpload: false,
        }),
      ),
    ).toMatch(/e-signatures/u);
  });

  test("e-signatures with no signature placements is refused", () => {
    expect(getWaiverStepError(waiverState({ waiverDefinition: null }))).toBe(
      WAIVER_DEFINITION_REQUIRED_MESSAGE,
    );
  });

  test("print and upload alone needs no signature placements", () => {
    expect(
      getWaiverStepError(
        waiverState({
          waiverDefinition: null,
          waiverDisableEsignature: true,
          waiverAllowUpload: true,
        }),
      ),
    ).toBeNull();
  });

  test("a repeat schedule and a required waiver cannot be combined", () => {
    const state = waiverState();
    state.recurrence = { ...state.recurrence, enabled: true };

    expect(getWaiverStepError(state)).toBe(RECURRENCE_WAIVER_CONFLICT_MESSAGE);
    expect(getRecurrenceStepErrors(state).enabled).toBe(
      RECURRENCE_WAIVER_CONFLICT_MESSAGE,
    );
  });
});

describe("repeat settings on the schedule step", () => {
  test("the series cannot end on or before its first date", () => {
    const state = createInitialEventFormState();
    state.schedule.oneTime.date = "2099-06-10";
    state.recurrence = {
      ...state.recurrence,
      enabled: true,
      weekdays: ["monday"],
      endType: "on_date",
      endDate: "2099-06-10",
    };

    expect(getRecurrenceStepErrors(state)).toEqual({
      endDate: "The end date must be after the first event date.",
    });

    state.recurrence.endDate = "2099-06-17";
    expect(getRecurrenceStepErrors(state)).toEqual({});
  });

  test("a hidden occurrence count does not fail an ongoing series", () => {
    const state = createInitialEventFormState();
    state.recurrence = {
      ...state.recurrence,
      enabled: true,
      weekdays: ["monday"],
      endType: "never",
      endOccurrences: 100,
    };

    expect(getRecurrenceStepErrors(state)).toEqual({});
  });
});
