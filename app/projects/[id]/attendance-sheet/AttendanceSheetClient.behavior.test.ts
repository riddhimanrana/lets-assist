import { beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";
import type { AttendancePrintSheet } from "@/lib/attendance/print-types";

let states: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in states))
      states[index] = typeof initial === "function" ? initial() : initial;
    return [
      states[index],
      (value: unknown) => {
        states[index] =
          typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
}));
mock.module("@/hooks/useHydrated", () => ({ useHydrated: () => true }));
const requests: Array<Record<string, unknown>> = [];
let fail = true;
let loseResponse = false;
const sheet: AttendancePrintSheet = {
  sheetReference: "a1400000-0000-4000-8000-000000000001",
  projectTitle: "Fictional project",
  sessionLabel: "Main session",
  timezone: "UTC",
  startsAt: "2020-09-18T09:00:00Z",
  endsAt: "2020-09-18T12:00:00Z",
  rows: [],
};
mock.module("./actions", () => ({
  createAttendancePrintSheets: async (input: Record<string, unknown>) => {
    requests.push(input);
    if (loseResponse) throw new Error("Transport response lost");
    return fail ? { error: "Read temporarily failed" } : { sheets: [sheet] };
  },
}));
const { AttendanceSheetClient } = await import("./AttendanceSheetClient");
type Element = { props: Record<string, unknown> };
function render() {
  cursor = 0;
  const tree = AttendanceSheetClient({
    projectId: "fictional-project",
    projectTitle: "Fictional project",
    timezone: "UTC",
    sessions: [
      {
        id: "oneTime",
        label: "Main session",
        startsAt: Date.parse(sheet.startsAt),
        endsAt: Date.parse(sheet.endsAt),
      },
    ],
  });
  const elements: Element[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const element = value as Element;
    elements.push(element);
    Object.values(element.props).forEach(visit);
  }
  visit(tree);
  return elements;
}
async function prepare() {
  const button = render().find(
    ({ props }) =>
      props.children === "Prepare sheets" ||
      props.children === "Retry preparation",
  )!;
  await (button.props.onClick as () => Promise<void>)();
}
beforeEach(() => {
  states = [];
  requests.length = 0;
  fail = true;
  loseResponse = false;
});

test("a failed preparation keeps its request key until recovery succeeds", async () => {
  await prepare();
  expect(
    render().some(({ props }) => props.children === "Retry preparation"),
  ).toBe(true);
  fail = false;
  await prepare();
  expect(requests[1].requestId).toBe(requests[0].requestId);
  expect(
    render().some(({ props }) => props.children === "Print / Save PDF"),
  ).toBe(true);
  await prepare();
  expect(requests[2].requestId).not.toBe(requests[1].requestId);
});
test("changing roster options starts a different request and clears an old preview", async () => {
  fail = false;
  await prepare();
  const input = render().find(
    ({ props }) => props.type === "number" && props.max === 100,
  )!;
  (
    input.props.onChange as (event: {
      target: { valueAsNumber: number };
    }) => void
  )({ target: { valueAsNumber: 15 } });
  expect(
    render().some(({ props }) => props.children === "Print / Save PDF"),
  ).toBe(false);
  await prepare();
  expect(requests[1].requestId).not.toBe(requests[0].requestId);
  expect(requests[1].blankRows).toBe(15);
});
test("a later preparation error preserves the last complete preview", async () => {
  fail = false;
  await prepare();
  fail = true;
  await prepare();
  const elements = render();
  expect(
    elements.some(({ props }) => props.children === "Print / Save PDF"),
  ).toBe(true);
  expect(
    elements.find(({ props }) => Array.isArray(props.sheets))!.props.sheets,
  ).toEqual([sheet]);
  expect(elements.some(({ props }) => props.role === "alert")).toBe(true);
});

test("a lost response retries the same request even after changing paper size", async () => {
  loseResponse = true;
  await prepare();
  const paper = render().find(({ props }) => props.value === "letter")!;
  (paper.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: "a4" },
  });
  loseResponse = false;
  fail = false;
  await prepare();
  expect(requests[1].requestId).toBe(requests[0].requestId);
  expect(
    render().some(({ props }) => props.children === "Print / Save PDF"),
  ).toBe(true);
});
