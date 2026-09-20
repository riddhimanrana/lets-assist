import { expect, mock, test } from "bun:test";
import * as React from "react";
import type { PaperScanRowView } from "./PaperSignupsClient";

// The root test runner isolates files that replace global modules.
mock.module("react", () => ({
  ...React,
  useEffect: () => {},
  useMemo: (compute: () => unknown) => compute(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => [
    typeof initial === "function" ? initial() : initial,
    () => {},
  ],
}));
const patches: Array<Record<string, unknown>> = [];
mock.module("./actions", () => ({
  commitPaperScanBatch: async () => ({}),
  getPaperScanImageUrls: async () => ({ urls: [] }),
  updatePaperScanRow: async ({ patch }: { patch: Record<string, unknown> }) => {
    patches.push(patch);
    return { success: true };
  },
}));
mock.module("./manual-actions", () => ({
  addAttendanceReviewRow: async () => ({}),
  combineAttendanceReviewRows: async () => ({}),
  loadAttendanceReview: async () => ({ rows: [] }),
  loadAttendanceCandidates: async () => ({ candidates: [] }),
}));
const { ReviewTable } = await import("./ReviewTable");

const baseRow: PaperScanRowView = {
  id: "fictional-row",
  sheetRowNumber: 1,
  imageId: null,
  name: "Fictional Volunteer",
  email: null,
  phone: null,
  checkInTime: "2020-09-18T09:00:00Z",
  checkOutTime: "2020-09-18T10:00:00Z",
  signaturePresent: false,
  overallConfidence: 1,
  fieldConfidence: { name: 1, email: 1, phone: 1, timeIn: 1, timeOut: 1 },
  matchKind: "none",
  matchSignupId: null,
  matchScore: null,
  matchReasons: [],
  decision: "include",
  outcome: "pending",
  outcomeDetail: null,
  attendanceIntervals: [
    { checkIn: "2020-09-18T09:00:00Z", checkOut: "2020-09-18T10:00:00Z" },
  ],
  reviewAcknowledged: true,
  identityConfirmed: true,
  timeExceptionReason: null,
  reviewRevision: 4,
};

type Element = { props: Record<string, unknown> };
function render(row: PaperScanRowView) {
  patches.length = 0;
  const elements: Element[] = [];
  const tree = ReviewTable({
    projectId: "fictional-project",
    batch: {
      id: "fictional-batch",
      scheduleId: "oneTime",
      status: "review",
      imageCount: 0,
    },
    initialRows: [row],
    timezone: "UTC",
    window: null,
    sessionPublished: false,
    discarding: false,
    onDiscard: () => {},
    onCommitted: () => {},
  });
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

for (const saved of [
  { outcome: "roster_only", savedAttendance: false },
  { outcome: "pending", savedAttendance: true },
]) {
  test(`saved ${saved.outcome} attendance cannot be excluded while identity review remains available`, async () => {
    const elements = render({ ...baseRow, ...saved });
    const include = elements.find(
      ({ props }) => props.type === "checkbox" && props.checked === true,
    )!;
    expect(include.props.disabled).toBe(true);
    (
      include.props.onChange as (event: {
        target: { checked: boolean };
      }) => void
    )({
      target: { checked: false },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(patches).toEqual([]);
    const review = elements.find(
      ({ props }) =>
        Array.isArray(props.children) && props.children[0] === "Review row ",
    )!;
    expect(review.props.disabled).toBe(false);
  });
}

test("unsaved attendance can still be excluded with its expected revision", async () => {
  const elements = render(baseRow);
  const include = elements.find(
    ({ props }) => props.type === "checkbox" && props.checked === true,
  )!;
  expect(include.props.disabled).toBe(false);
  (include.props.onChange as (event: { target: { checked: boolean } }) => void)(
    {
      target: { checked: false },
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  expect(patches).toEqual([{ decision: "exclude", expectedRevision: 4 }]);
});

test("a reconciled reference is clearly recorded and cannot reopen ordinary review", () => {
  const elements = render({
    ...baseRow,
    outcome: "skipped",
    outcomeDetail: "reconciled_existing_attendance",
    savedAttendance: true,
  });
  expect(
    elements.some(({ props }) => props.children === "Already recorded"),
  ).toBe(true);
  expect(
    elements.some(
      ({ props }) =>
        Array.isArray(props.children) && props.children[0] === "Review row ",
    ),
  ).toBe(false);
  expect(
    elements.find(({ props }) => props.children === "Discard draft")!.props
      .disabled,
  ).toBe(true);
});
