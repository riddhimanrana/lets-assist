import { describe, expect, test } from "bun:test";

import {
  RECURRENCE_MULTI_DAY_MESSAGE,
  RECURRENCE_WAIVER_COPY_NOTICE,
  buildRecurrenceRuleFromState,
  firstRecurrenceError,
  validateRecurrenceFormState,
  type RecurrenceFormState,
} from "./recurrence";
import { validateRecurrenceRule } from "./schedule-validation";

const weekly: RecurrenceFormState = {
  enabled: true,
  frequency: "weekly",
  interval: 1,
  endType: "never",
  weekdays: ["monday"],
};

const context = { eventType: "oneTime" as const, startDate: "2027-03-01" };

describe("buildRecurrenceRuleFromState", () => {
  test("a disabled schedule has no rule", () => {
    expect(
      buildRecurrenceRuleFromState({ ...weekly, enabled: false }),
    ).toBeNull();
  });

  test("values left over from another end type are not sent", () => {
    const rule = buildRecurrenceRuleFromState({
      ...weekly,
      endType: "never",
      endOccurrences: 100,
      endDate: "2001-01-01",
    });

    expect(rule).toMatchObject({
      end_type: "never",
      end_date: null,
      end_occurrences: null,
    });
    // The stale 100 would have failed the 52-occurrence ceiling.
    expect(validateRecurrenceRule(rule).ok).toBe(true);
  });

  test("each end type sends only its own field", () => {
    expect(
      buildRecurrenceRuleFromState({
        ...weekly,
        endType: "on_date",
        endDate: "2027-06-01",
        endOccurrences: 12,
      }),
    ).toMatchObject({ end_date: "2027-06-01", end_occurrences: null });
    expect(
      buildRecurrenceRuleFromState({
        ...weekly,
        endType: "after_occurrences",
        endDate: "2027-06-01",
        endOccurrences: 12,
      }),
    ).toMatchObject({ end_date: null, end_occurrences: 12 });
  });

  test("weekdays are only sent for a weekly schedule", () => {
    expect(
      buildRecurrenceRuleFromState({ ...weekly, frequency: "monthly" }),
    ).toMatchObject({ frequency: "monthly", weekdays: [] });
    expect(buildRecurrenceRuleFromState(weekly)).toMatchObject({
      weekdays: ["monday"],
    });
  });
});

describe("validateRecurrenceFormState", () => {
  test("a disabled or absent schedule has nothing to report", () => {
    expect(
      validateRecurrenceFormState({ ...weekly, enabled: false }, context),
    ).toEqual({});
    expect(validateRecurrenceFormState(null, context)).toEqual({});
    expect(
      validateRecurrenceFormState(
        { ...weekly, enabled: false, interval: 0, weekdays: [] },
        { eventType: "multiDay" },
      ),
    ).toEqual({});
  });

  test("a valid schedule passes and builds a rule the server accepts", () => {
    for (const recurrence of [
      weekly,
      { ...weekly, frequency: "daily" as const, weekdays: [] },
      {
        ...weekly,
        endType: "on_date" as const,
        endDate: "2027-03-02",
      },
      {
        ...weekly,
        endType: "after_occurrences" as const,
        endOccurrences: 52,
      },
    ]) {
      expect(validateRecurrenceFormState(recurrence, context)).toEqual({});
      expect(
        validateRecurrenceRule(buildRecurrenceRuleFromState(recurrence)).ok,
      ).toBe(true);
    }
  });

  const cases: Array<{
    name: string;
    recurrence: RecurrenceFormState;
    field: "interval" | "weekdays" | "endDate" | "endOccurrences";
    message: string | RegExp;
  }> = [
    {
      name: "an interval of zero",
      recurrence: { ...weekly, interval: 0 },
      field: "interval",
      message: /interval must be a whole number from 1 to 365/u,
    },
    {
      name: "a cleared interval",
      recurrence: { ...weekly, interval: Number.NaN },
      field: "interval",
      message: /interval/u,
    },
    {
      name: "an interval above the ceiling",
      recurrence: { ...weekly, interval: 366 },
      field: "interval",
      message: /interval/u,
    },
    {
      name: "weekly with no weekday selected",
      recurrence: { ...weekly, weekdays: [] },
      field: "weekdays",
      message: "Select at least one day of the week.",
    },
    {
      name: "an end date that was never chosen",
      recurrence: { ...weekly, endType: "on_date" },
      field: "endDate",
      message: "Choose the date the series ends.",
    },
    {
      name: "an end date in the wrong format",
      recurrence: { ...weekly, endType: "on_date", endDate: "12/31/2027" },
      field: "endDate",
      message: "Choose the date the series ends.",
    },
    {
      name: "an end date on the first event date",
      recurrence: { ...weekly, endType: "on_date", endDate: "2027-03-01" },
      field: "endDate",
      message: "The end date must be after the first event date.",
    },
    {
      name: "a missing number of events",
      recurrence: { ...weekly, endType: "after_occurrences" },
      field: "endOccurrences",
      message: "Enter a number of events from 1 to 52.",
    },
    {
      name: "more events than the ceiling",
      recurrence: {
        ...weekly,
        endType: "after_occurrences",
        endOccurrences: 100,
      },
      field: "endOccurrences",
      message: "Enter a number of events from 1 to 52.",
    },
  ];

  for (const { name, recurrence, field, message } of cases) {
    test(`${name} is reported on its own field`, () => {
      const errors = validateRecurrenceFormState(recurrence, context);
      expect(Object.keys(errors)).toEqual([field]);
      if (typeof message === "string") expect(errors[field]).toBe(message);
      else expect(errors[field]).toMatch(message);
      expect(firstRecurrenceError(errors)).toBe(errors[field] ?? null);
    });
  }

  test("a multi-day project cannot repeat", () => {
    expect(
      validateRecurrenceFormState(weekly, { eventType: "multiDay" }),
    ).toEqual({ enabled: RECURRENCE_MULTI_DAY_MESSAGE });
  });

  test("the waiver notice says which events get which waiver, in one sentence", () => {
    expect(RECURRENCE_WAIVER_COPY_NOTICE).toBe(
      "Each new event copies the waiver as it is when that event is created, so events that already exist keep the waiver they have.",
    );
    expect(RECURRENCE_WAIVER_COPY_NOTICE.match(/[.!?]/gu)).toHaveLength(1);
  });
});
