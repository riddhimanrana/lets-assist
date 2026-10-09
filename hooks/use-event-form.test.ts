import { describe, expect, test } from "bun:test";

import {
  createInitialEventFormState,
  eventFormReducer,
} from "./use-event-form";

const recurring = {
  enabled: true,
  frequency: "weekly" as const,
  interval: 1,
  endType: "never" as const,
  weekdays: ["monday" as const],
};

describe("a multi-day project never has a repeat schedule", () => {
  test("choosing multi-day turns the repeat schedule off", () => {
    const repeating = eventFormReducer(createInitialEventFormState(), {
      type: "UPDATE_RECURRENCE",
      payload: { field: "enabled", value: true },
    });
    expect(repeating.recurrence.enabled).toBe(true);

    const multiDay = eventFormReducer(repeating, {
      type: "SET_EVENT_TYPE",
      payload: "multiDay",
    });
    expect(multiDay.recurrence.enabled).toBe(false);
  });

  test("it cannot be turned back on while the project is multi-day", () => {
    // The AI auto-fill sets the event type and then applies its recurrence.
    const multiDay = eventFormReducer(createInitialEventFormState(), {
      type: "SET_EVENT_TYPE",
      payload: "multiDay",
    });
    const afterAutoFill = eventFormReducer(multiDay, {
      type: "UPDATE_RECURRENCE",
      payload: { field: "enabled", value: true },
    });

    expect(afterAutoFill.recurrence.enabled).toBe(false);
    // Its other repeat fields can still be written without enabling it.
    expect(
      eventFormReducer(afterAutoFill, {
        type: "UPDATE_RECURRENCE",
        payload: { field: "frequency", value: "monthly" },
      }).recurrence,
    ).toMatchObject({ enabled: false, frequency: "monthly" });
  });

  test("a restored multi-day draft drops a saved repeat schedule", () => {
    const restored = createInitialEventFormState({
      draft: { eventType: "multiDay", recurrence: recurring },
    });

    expect(restored.eventType).toBe("multiDay");
    expect(restored.recurrence).toMatchObject({
      enabled: false,
      frequency: "weekly",
    });
  });

  test("a restored one-time draft keeps its repeat schedule", () => {
    const restored = createInitialEventFormState({
      draft: { eventType: "oneTime", recurrence: recurring },
    });

    expect(restored.recurrence.enabled).toBe(true);
  });

  test("switching back from multi-day lets the user turn it on again", () => {
    const multiDay = eventFormReducer(createInitialEventFormState(), {
      type: "SET_EVENT_TYPE",
      payload: "multiDay",
    });
    const oneTime = eventFormReducer(multiDay, {
      type: "SET_EVENT_TYPE",
      payload: "oneTime",
    });

    expect(
      eventFormReducer(oneTime, {
        type: "UPDATE_RECURRENCE",
        payload: { field: "enabled", value: true },
      }).recurrence.enabled,
    ).toBe(true);
  });
});
