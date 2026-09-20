import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUnpublishedAttendanceRecords,
  type ExportReviewRow,
  type ExportRosterEntry,
} from "./attendance-export-unpublished";
import {
  parseAttendanceExportFilters,
  type ExportProject,
} from "./attendance-export";
import { summarizeAttendanceHours } from "./attendance-hours-summary";

const project: ExportProject = {
  id: "project-a",
  title: "Community cleanup",
  organization_id: "org-a",
  creator_id: "creator",
  can_be_managed_by_staff: true,
  project_timezone: "America/Los_Angeles",
  published: { oneTime: true },
  schedule: {
    oneTime: {
      date: "2026-09-19",
      startTime: "09:00",
      endTime: "15:00",
      volunteers: 10,
    },
  },
};
const filters = parseAttendanceExportFilters(
  new URLSearchParams("includeUnpublished=true"),
  "project",
);
const review: ExportReviewRow = {
  id: "review-a",
  name: "Walk-in Example",
  email: null,
  check_in_time: "2026-09-19T16:00:00Z",
  check_out_time: null,
  attendance_intervals: [{ checkIn: "2026-09-19T16:00:00Z", checkOut: null }],
  review_revision: 3,
  review_acknowledged: false,
  identity_confirmed: false,
  decision: "include",
  outcome: "pending",
  committed_signup_id: null,
  batch: { schedule_id: "oneTime", status: "review" },
};
const roster: ExportRosterEntry = {
  id: "roster-a",
  scan_row_id: "review-a",
  schedule_id: "oneTime",
  name: "Walk-in Example",
  check_in_time: "2026-09-19T16:00:00Z",
  check_out_time: "2026-09-19T17:00:00Z",
  attendance_intervals: [
    { checkIn: "2026-09-19T16:00:00Z", checkOut: "2026-09-19T17:00:00Z" },
  ],
};

test("roster-only attendance remains unresolved and uncredited even for a published session", () => {
  const [row] = buildUnpublishedAttendanceRecords(
    project,
    [roster],
    [],
    filters,
  );
  assert.equal(row.publicationState, "unresolved");
  assert.equal(row.creditedMinutes, null);
  assert.equal(row.sourceType, "roster");
  assert.equal(row.sourceId, roster.id);
  assert.equal(row.email, "");
  assert.equal(row.certificateId, null);
  assert.equal(row.intervals.length, 1);
});

test("draft review rows retain missing times and have no asserted participant identity", () => {
  const [row] = buildUnpublishedAttendanceRecords(
    project,
    [],
    [review],
    filters,
  );
  assert.equal(row.publicationState, "unresolved");
  assert.equal(row.participantId, null);
  assert.equal(row.participantType, "unresolved");
  assert.equal(row.sourceType, "review");
  assert.equal(row.sourceId, review.id);
  assert.deepEqual(row.intervals, review.attendance_intervals);
  assert.equal(row.creditedMinutes, null);
  const [ready] = buildUnpublishedAttendanceRecords(
    project,
    [],
    [
      {
        ...review,
        review_acknowledged: true,
        identity_confirmed: true,
        attendance_intervals: [
          { checkIn: review.check_in_time, checkOut: "2026-09-19T17:00:00Z" },
        ],
      },
    ],
    filters,
  );
  assert.equal(ready.publicationState, "pending");
  assert.equal(ready.creditedMinutes, null);
});

test("committed or excluded scan rows do not duplicate persisted attendance", () => {
  assert.equal(
    buildUnpublishedAttendanceRecords(project, [roster], [review], filters)
      .length,
    1,
  );
  for (const outcome of [
    "signup_created",
    "signup_updated",
    "roster_only",
    "skipped",
  ])
    assert.equal(
      buildUnpublishedAttendanceRecords(
        project,
        [],
        [{ ...review, outcome }],
        filters,
      ).length,
      0,
    );
  assert.equal(
    buildUnpublishedAttendanceRecords(
      project,
      [],
      [{ ...review, committed_signup_id: "signup-a" }],
      filters,
    ).length,
    0,
  );
  assert.equal(
    buildUnpublishedAttendanceRecords(
      project,
      [],
      [{ ...review, decision: "exclude" }],
      filters,
    ).length,
    0,
  );
  assert.equal(
    buildUnpublishedAttendanceRecords(
      project,
      [],
      [{ ...review, batch: { schedule_id: "oneTime", status: "extracting" } }],
      filters,
    ).length,
    0,
  );
});

test("unpublished records honor explicit opt-in and project service-date filters", () => {
  assert.equal(
    buildUnpublishedAttendanceRecords(project, [roster], [review], {
      ...filters,
      includeUnpublished: false,
    }).length,
    0,
  );
  assert.equal(
    buildUnpublishedAttendanceRecords(project, [roster], [], {
      ...filters,
      from: "2026-09-20",
    }).length,
    0,
  );
  assert.equal(
    buildUnpublishedAttendanceRecords(project, [roster], [], {
      ...filters,
      sessionId: "different",
    }).length,
    0,
  );
});

test("awarded session totals never include pending or unresolved attendance", () => {
  assert.deepEqual(
    summarizeAttendanceHours([
      { creditedMinutes: 60, recordedMinutes: 90 },
      { creditedMinutes: null, recordedMinutes: 120 },
      { creditedMinutes: null, recordedMinutes: null },
    ]),
    {
      awardedMinutes: 60,
      recordedMinutes: 120,
      awardedCount: 1,
      pendingCount: 1,
      unresolvedCount: 1,
    },
  );
});

test("empty, zero, and invalid attendance have explicit summary counts", () => {
  assert.deepEqual(summarizeAttendanceHours([]), {
    awardedMinutes: 0,
    recordedMinutes: 0,
    awardedCount: 0,
    pendingCount: 0,
    unresolvedCount: 0,
  });
  assert.deepEqual(
    summarizeAttendanceHours([
      { creditedMinutes: 0, recordedMinutes: 30 },
      { creditedMinutes: null, recordedMinutes: 0 },
      { creditedMinutes: null, recordedMinutes: NaN },
    ]),
    {
      awardedMinutes: 0,
      recordedMinutes: 0,
      awardedCount: 1,
      pendingCount: 0,
      unresolvedCount: 2,
    },
  );
});

test("saved roster exports preserve reviewed visits while the linked draft changes", () => {
  const snapshot = [
    { checkIn: "2026-09-19T16:00:00Z", checkOut: "2026-09-19T17:00:00Z" },
    { checkIn: "2026-09-19T18:00:00Z", checkOut: "2026-09-19T19:00:00Z" },
  ];
  for (const draftIntervals of [
    [{ checkIn: "2026-09-19T16:00:00Z", checkOut: "2026-09-19T22:00:00Z" }],
    [{ checkIn: "2026-09-19T16:00:00Z", checkOut: null }],
  ]) {
    const persisted = {
      ...roster,
      attendance_intervals: snapshot,
      check_out_time: "2026-09-19T19:00:00Z",
      // Even an old joined response must not override the committed snapshot.
      scan_row: { attendance_intervals: draftIntervals },
    };
    const records = buildUnpublishedAttendanceRecords(
      project,
      [persisted],
      [
        {
          ...review,
          name: "Unreviewed changed name",
          attendance_intervals: draftIntervals,
        },
      ],
      filters,
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].sourceType, "roster");
    assert.equal(records[0].name, roster.name);
    assert.deepEqual(records[0].intervals, snapshot);
    assert.equal(records[0].publicationState, "unresolved");
    assert.equal(records[0].creditedMinutes, null);
  }
});

test("legacy roster entries use their saved envelope when the snapshot is empty", () => {
  const legacy = {
    ...roster,
    attendance_intervals: [],
    scan_row: { attendance_intervals: [{ checkIn: null, checkOut: null }] },
  };
  const [record] = buildUnpublishedAttendanceRecords(
    project,
    [legacy],
    [review],
    filters,
  );
  assert.deepEqual(record.intervals, [
    { checkIn: roster.check_in_time, checkOut: roster.check_out_time },
  ]);
  assert.equal(record.creditedMinutes, null);
  assert.equal(record.sourceId, roster.id);
});
