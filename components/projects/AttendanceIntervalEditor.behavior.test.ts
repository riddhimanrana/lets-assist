import { expect, mock, test } from "bun:test";
import * as React from "react";

const state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in state))
      state[index] = typeof initial === "function" ? initial() : initial;
    return [
      state[index],
      (value: unknown) => {
        state[index] = value;
      },
    ];
  },
}));
const { AttendanceIntervalEditor } = await import("./AttendanceIntervalEditor");
type Element = { props: Record<string, unknown> };

for (const correction of [true, false]) {
  test(`editing the ${correction ? "correction" : "exception"} reason requires renewed confirmation before saving`, async () => {
    state.length = 0;
    const saved: string[] = [];
    let elements: Element[] = [];
    const render = () => {
      cursor = 0;
      elements = [];
      const tree = AttendanceIntervalEditor({
        name: "Fictional volunteer",
        timezone: "UTC",
        initialIntervals: [
          { checkIn: "2020-01-01T08:30:00Z", checkOut: "2020-01-01T10:00:00Z" },
        ],
        window: {
          startsAt: Date.parse("2020-01-01T09:00:00Z"),
          endsAt: Date.parse("2020-01-01T12:00:00Z"),
        },
        correction,
        onClose: () => {},
        onSave: async (_intervals, reason) => {
          saved.push(reason);
          return true;
        },
      });
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (!value || typeof value !== "object" || !("props" in value)) return;
        const element = value as Element;
        elements.push(element);
        Object.values(element.props).forEach(visit);
      };
      visit(tree);
    };
    const reason = () =>
      elements.find(({ props }) => props.id === "hours-reason")!;
    const review = () =>
      elements.find(({ props }) => props.type === "checkbox")!;
    const save = () =>
      elements.find(
        ({ props }) =>
          props.children ===
          (correction ? "Save correction" : "Use reviewed times"),
      )!;
    const changeReason = (value: string) => {
      (
        reason().props.onChange as (event: {
          target: { value: string };
        }) => void
      )({ target: { value } });
      render();
    };
    const confirm = () => {
      (
        review().props.onChange as (event: {
          target: { checked: boolean };
        }) => void
      )({ target: { checked: true } });
      render();
    };
    render();
    changeReason("Early setup confirmed");
    confirm();
    expect(save().props.disabled).toBe(false);
    changeReason("Earlier safety briefing confirmed");
    expect(review().props.checked).toBe(false);
    expect(save().props.disabled).toBe(true);
    await (save().props.onClick as () => Promise<void>)();
    expect(saved).toEqual([]);
    confirm();
    expect(save().props.disabled).toBe(false);
    await (save().props.onClick as () => Promise<void>)();
    expect(saved).toEqual(["Earlier safety briefing confirmed"]);
  });
}
