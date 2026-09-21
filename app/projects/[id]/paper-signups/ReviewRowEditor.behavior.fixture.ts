// The child process isolates hook state and Server Action mocks from other tests.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as React from "react";
import type { PaperScanRowView } from "./PaperSignupsClient";
import { isAttendanceRowReady } from "@/lib/projects/paper-signup/review-state";

const state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...React,
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in state))
      state[index] = typeof initial === "function" ? initial() : initial;
    return [
      state[index],
      (value: unknown) => {
        state[index] =
          typeof value === "function" ? value(state[index]) : value;
      },
    ];
  },
}));
const patches: Array<Record<string, unknown>> = [];
const saved: PaperScanRowView[] = [];
mock.module("./actions", () => ({
  updatePaperScanRow: async ({ patch }: { patch: Record<string, unknown> }) => {
    patches.push(patch);
    return { success: true };
  },
}));
mock.module("./manual-actions", () => ({
  loadAttendanceCandidates: async () => ({ candidates: [] }),
}));
mock.module("sonner", () => ({
  toast: {
    error: (message: string) => {
      throw new Error(message);
    },
  },
}));
const { ReviewRowEditor } = await import("./ReviewRowEditor");
const row: PaperScanRowView = {
  id: "fictional-row",
  sheetRowNumber: 1,
  imageId: null,
  name: "Fictional Volunteer",
  email: "volunteer@example.test",
  phone: null,
  checkInTime: "2020-09-18T08:30:00Z",
  checkOutTime: "2020-09-18T10:00:00Z",
  signaturePresent: false,
  overallConfidence: 1,
  fieldConfidence: { name: 1, email: 1, phone: 1, timeIn: 1, timeOut: 1 },
  matchKind: "existing_signup",
  matchSignupId: "fictional-signup",
  matchScore: 1,
  matchReasons: [],
  decision: "include",
  outcome: "pending",
  outcomeDetail: null,
  attendanceIntervals: [
    { checkIn: "2020-09-18T08:30:00Z", checkOut: "2020-09-18T10:00:00Z" },
  ],
  reviewAcknowledged: true,
  identityConfirmed: true,
  timeExceptionReason: "Coordinator confirmed early setup",
  reviewRevision: 4,
};
type Element = { props: Record<string, unknown> };
let elements: Element[] = [];
function render() {
  cursor = 0;
  elements = [];
  const tree = ReviewRowEditor({
    projectId: "fictional-project",
    batchId: "fictional-batch",
    row,
    timezone: "UTC",
    window: {
      startsAt: Date.parse("2020-09-18T09:00:00Z"),
      endsAt: Date.parse("2020-09-18T12:00:00Z"),
    },
    onClose: () => {},
    onSaved: (result) => saved.push(result),
  });
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const element = value as Element;
    elements.push(element);
    Object.values(element.props).forEach(visit);
  }
  visit(tree);
}
function change(id: string, value: string) {
  const element = elements.find((element) => element.props.id === id);
  assert.ok(element, `Missing input ${id}`);
  (element.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });
  render();
}
function checkbox(id: string) {
  const element = elements.find((element) => element.props.id === id);
  assert.ok(element, `Missing checkbox ${id}`);
  return element;
}
async function save() {
  const button = elements.find(
    (element) => element.props.children === "Save review",
  );
  assert.ok(button);
  await (button.props.onClick as () => Promise<void>)();
  render();
}
const scenario = process.argv[2];
if (scenario === "roster")
  Object.assign(row, {
    outcome: "roster_only",
    outcomeDetail: "saved without email",
    savedAttendance: true,
  });
if (scenario === "signature") {
  row.signaturePresent = true;
  row.email = null;
  row.matchSignupId = null;
}
if (scenario === "phone") row.phone = "+1 202-555-0100";
render();
if (scenario === "signature") {
  assert.equal(checkbox("attendance-signature").props.checked, true);
  for (const checked of [false, true]) {
    (
      checkbox("attendance-signature").props.onChange as (event: {
        target: { checked: boolean };
      }) => void
    )({ target: { checked } });
    render();
    assert.equal(checkbox("attendance-signature").props.checked, checked);
    assert.equal(
      checkbox("attendance-review-acknowledged").props.checked,
      false,
    );
    assert.equal(checkbox("attendance-identity-confirmed").props.checked, true);
    await save();
    assert.equal(patches.at(-1)?.signaturePresent, checked);
    assert.equal(saved.at(-1)?.signaturePresent, checked);
    assert.equal(patches.at(-1)?.reviewAcknowledged, false);
    assert.equal(patches.at(-1)?.email, null);
    assert.equal(patches.at(-1)?.expectedRevision, 4);
  }
} else if (scenario === "phone") {
  assert.equal(
    elements.find((element) => element.props.id === "attendance-phone")?.props
      .value,
    row.phone,
  );
  change("attendance-phone", "+1 202-555-0111");
  assert.equal(checkbox("attendance-review-acknowledged").props.checked, false);
  assert.equal(checkbox("attendance-identity-confirmed").props.checked, true);
  await save();
  assert.equal(patches[0].phone, "+1 202-555-0111");
  assert.equal(saved[0].phone, "+1 202-555-0111");
  assert.equal(patches[0].reviewAcknowledged, false);
  change("attendance-phone", "");
  await save();
  assert.equal(patches[1].phone, null);
  assert.equal(saved[1].phone, null);
} else if (scenario === "reason" || scenario === "roster") {
  assert.equal(checkbox("attendance-review-acknowledged").props.checked, true);
  change(
    "attendance-reason",
    "Coordinator confirmed an earlier safety briefing",
  );
  assert.equal(
    checkbox("attendance-review-acknowledged").props.checked,
    false,
    "Changed reason requires renewed review",
  );
  assert.equal(
    checkbox("attendance-identity-confirmed").props.checked,
    true,
    "Time explanation does not change reviewed identity",
  );
  await save();
  assert.equal(patches[0].reviewAcknowledged, false);
  assert.equal(saved[0].reviewAcknowledged, false);
  assert.equal(
    patches[0].timeExceptionReason,
    "Coordinator confirmed an earlier safety briefing",
  );
  assert.equal(patches[0].expectedRevision, 4);
  assert.deepEqual(
    patches[0].attendanceIntervals,
    row.attendanceIntervals.map((interval) => ({
      checkIn: new Date(interval.checkIn!).toISOString(),
      checkOut: new Date(interval.checkOut!).toISOString(),
    })),
  );
  (
    checkbox("attendance-review-acknowledged").props.onChange as (event: {
      target: { checked: boolean };
    }) => void
  )({ target: { checked: true } });
  render();
  await save();
  assert.equal(
    patches[1].reviewAcknowledged,
    true,
    "Explicit reconfirmation permits reviewed save",
  );
  if (scenario === "roster") {
    const window = {
      startsAt: Date.parse("2020-09-18T09:00:00Z"),
      endsAt: Date.parse("2020-09-18T12:00:00Z"),
    };
    assert.equal(saved[0].outcome, "pending");
    assert.equal(saved[0].outcomeDetail, null);
    assert.equal(saved[0].reviewRevision, row.reviewRevision + 1);
    assert.equal(isAttendanceRowReady(saved[0], window), false);
    assert.equal(saved[1].outcome, "pending");
    assert.equal(saved[1].outcomeDetail, null);
    assert.equal(
      isAttendanceRowReady(saved[1], window),
      true,
      "Reviewed edited roster row is ready without a refresh",
    );
    assert.equal(
      "savedAttendance" in saved[1] && saved[1].savedAttendance,
      true,
      "Editing retains persisted-attendance protection",
    );
  }
} else if (scenario === "unchanged") {
  await save();
  assert.equal(patches[0].reviewAcknowledged, true);
  assert.equal(patches[0].identityConfirmed, true);
  assert.equal(patches[0].timeExceptionReason, row.timeExceptionReason);
} else if (scenario === "interval") {
  change("visit-0-start", "2020-09-18T08:45");
  assert.equal(checkbox("attendance-review-acknowledged").props.checked, false);
  await save();
  assert.equal(patches[0].reviewAcknowledged, false);
  assert.equal(patches[0].timeExceptionReason, row.timeExceptionReason);
} else {
  throw new Error(`Unknown scenario: ${scenario}`);
}
