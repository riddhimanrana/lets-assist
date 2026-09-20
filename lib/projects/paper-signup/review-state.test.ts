import { expect, test } from "bun:test";
import {
  isAttendanceRowReady,
  isFinalAttendanceRow,
  isSavedAttendanceRow,
} from "./review-state";

const window = {
  startsAt: Date.parse("2026-09-20T16:00:00Z"),
  endsAt: Date.parse("2026-09-20T19:00:00Z"),
};
const roster = {
  outcome: "roster_only",
  decision: "include",
  reviewAcknowledged: true,
  identityConfirmed: true,
  attendanceIntervals: [
    { checkIn: "2026-09-20T16:15:00Z", checkOut: "2026-09-20T18:00:00Z" },
  ],
  timeExceptionReason: null,
};

test("saved name-only attendance is not ready again but remains editable for identity resolution", () => {
  expect(isSavedAttendanceRow(roster)).toBe(true);
  expect(isAttendanceRowReady(roster, window)).toBe(false);
  expect(isFinalAttendanceRow(roster)).toBe(false);
  expect([roster].filter((row) => isAttendanceRowReady(row, window))).toEqual(
    [],
  );
});

test("an edited roster row can be saved again only after renewed review", () => {
  // The update RPC resets outcome to pending and invalidates changed identity
  // confirmation unless the coordinator explicitly supplies it in the patch.
  const edited = {
    ...roster,
    outcome: "pending",
    reviewAcknowledged: false,
    identityConfirmed: false,
  };
  expect(isSavedAttendanceRow(edited)).toBe(false);
  expect(isAttendanceRowReady(edited, window)).toBe(false);
  expect(
    isAttendanceRowReady({ ...edited, reviewAcknowledged: true }, window),
  ).toBe(false);
  expect(
    isAttendanceRowReady(
      { ...edited, reviewAcknowledged: true, identityConfirmed: true },
      window,
    ),
  ).toBe(true);
});

test("partial completion retains unresolved rows without resubmitting saved roster entries", () => {
  const unresolved = {
    ...roster,
    outcome: "pending",
    identityConfirmed: false,
  };
  const ready = { ...roster, outcome: "pending" };
  const awarded = { ...roster, outcome: "signup_created" };
  const rows = [roster, unresolved, ready, awarded];
  expect(rows.filter((row) => isAttendanceRowReady(row, window))).toEqual([
    ready,
  ]);
  expect(rows.filter((row) => !isFinalAttendanceRow(row))).toEqual([
    roster,
    unresolved,
    ready,
  ]);
  expect(
    rows.every(
      (row) => isFinalAttendanceRow(row) || row.decision === "exclude",
    ),
  ).toBe(false);
  expect(rows.filter((row) => !isSavedAttendanceRow(row))).toEqual([
    unresolved,
    ready,
  ]);
  expect(
    [awarded, { ...awarded, outcome: "skipped" }].every(isFinalAttendanceRow),
  ).toBe(true);
});

test("readiness still requires included, complete reviewed times and an outside-session explanation", () => {
  const pending = { ...roster, outcome: "pending" };
  expect(
    isAttendanceRowReady({ ...pending, decision: "exclude" }, window),
  ).toBe(false);
  expect(
    isAttendanceRowReady(
      { ...pending, attendanceIntervals: [{ checkIn: null, checkOut: null }] },
      window,
    ),
  ).toBe(false);
  const outside = {
    ...pending,
    attendanceIntervals: [
      { checkIn: "2026-09-20T15:00:00Z", checkOut: "2026-09-20T18:00:00Z" },
    ],
  };
  expect(isAttendanceRowReady(outside, window)).toBe(false);
  expect(
    isAttendanceRowReady(
      { ...outside, timeExceptionReason: "Coordinator confirmed early setup" },
      window,
    ),
  ).toBe(true);
});
