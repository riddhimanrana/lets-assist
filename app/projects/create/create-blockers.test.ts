import { describe, expect, test } from "bun:test";

import { createInitialEventFormState } from "@/hooks/use-event-form";

import {
  WAIVER_DEFINITION_REQUIRED_MESSAGE,
  getRecurrenceStepErrors,
  getWaiverStepError,
} from "./create-blockers";

const definition = {
  signers: [
    {
      roleKey: "participant",
      label: "Participant",
      required: true,
      orderIndex: 0,
    },
  ],
  fields: {
    detected: {},
    custom: [
      {
        id: "participant-signature",
        label: "Participant signature",
        signerRoleKey: "participant",
        fieldType: "signature" as const,
        required: true,
        pageIndex: 0,
        rect: { x: 10, y: 20, width: 180, height: 50 },
      },
    ],
  },
};
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
    expect(
      getWaiverStepError(
        waiverState({
          waiverRequired: false,
          waiverDefinition: { signers: [], fields: [] },
          waiverPdfFile: null,
        }),
      ),
    ).toBeNull();
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

  test.each([
    { signers: [], fields: [] },
    { ...definition, fields: { detected: {}, custom: [] } },
    {
      ...definition,
      fields: {
        detected: {},
        custom: [
          { ...definition.fields.custom[0], signerRoleKey: "stale-role" },
        ],
      },
    },
    {
      ...definition,
      fields: {
        detected: {},
        custom: [{ ...definition.fields.custom[0], fieldType: "initial" }],
      },
    },
    {
      ...definition,
      signers: [{ ...definition.signers[0], required: false }],
      fields: { detected: {}, custom: [] },
    },
  ])(
    "incomplete or stale waiver configuration is blocked before staging (%#)",
    (waiverDefinition) => {
      expect(getWaiverStepError(waiverState({ waiverDefinition }))).toBe(
        WAIVER_DEFINITION_REQUIRED_MESSAGE,
      );
    },
  );

  test("a ready project needs configuration, not a participant signature before publication", () => {
    expect(
      getWaiverStepError(waiverState({ waiverSignatures: [] })),
    ).toBeNull();
    // Old signature metadata never repairs a missing current configuration.
    expect(
      getWaiverStepError(
        waiverState({
          waiverDefinition: null,
          waiverSignatures: [
            {
              id: "fictional-signed-record",
              signed_at: "2026-10-01T12:00:00Z",
            },
          ],
        }),
      ),
    ).toBe(WAIVER_DEFINITION_REQUIRED_MESSAGE);
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

  test("a repeat schedule and a required waiver can be combined", () => {
    const state = waiverState();
    state.recurrence = {
      ...state.recurrence,
      enabled: true,
      weekdays: ["monday"],
    };

    expect(getWaiverStepError(state)).toBeNull();
    expect(getRecurrenceStepErrors(state)).toEqual({});
  });

  test("a repeating waiver project still needs its PDF and placements", () => {
    const state = waiverState({ waiverPdfFile: null });
    state.recurrence = { ...state.recurrence, enabled: true };

    expect(getWaiverStepError(state)).toBe(
      "A waiver PDF is required before you can continue.",
    );
    expect(
      getWaiverStepError({
        ...state,
        waiverPdfFile: pdf,
        waiverDefinition: null,
      }),
    ).toBe(WAIVER_DEFINITION_REQUIRED_MESSAGE);
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
