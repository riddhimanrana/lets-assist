import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceExportCsv,
  buildAttendanceExportRecords,
  parseAttendanceExportFilters,
  serviceDate,
  type ExportProject,
  type ExportSignup,
} from "./attendance-export";
import { buildUnpublishedAttendanceRecords } from "./attendance-export-unpublished";

const date = "2026-09-19";
const slot = { startTime: "09:00", endTime: "12:00", volunteers: 10 };
const base: ExportProject = {
  id: "fictional-project",
  title: "Fictional attendance",
  creator_id: "fictional-organizer",
  organization_id: null,
  can_be_managed_by_staff: false,
  project_timezone: "America/Los_Angeles",
  event_type: "oneTime",
  schedule: { oneTime: { date, ...slot } },
  published: null,
};
const cases: Array<{
  project: ExportProject;
  selected: string;
  aliases: string[];
  excluded: string[];
}> = [
  {
    project: base,
    selected: "oneTime",
    aliases: ["oneTime", "0", "default"],
    excluded: ["other", "oneTime0", "role-0", "day-0-slot-0"],
  },
  {
    project: {
      ...base,
      event_type: "multiDay",
      schedule: {
        multiDay: [
          { date, slots: [slot, slot] },
          { date: "2026-09-20", slots: [slot] },
        ],
      },
    },
    selected: `${date}-0`,
    aliases: [`${date}-0-0`, "day-0-slot-0", "0-0", `${date}-0`],
    excluded: ["0-1", "1-0", "day-0-slot-9", `${date}-9-0`, "other"],
  },
  {
    project: {
      ...base,
      event_type: "sameDayMultiArea",
      schedule: {
        sameDayMultiArea: {
          date,
          overallStart: "09:00",
          overallEnd: "12:00",
          roles: [
            { name: "Welcome", ...slot },
            { name: "Cleanup", ...slot },
          ],
        },
      },
    },
    selected: "Welcome",
    aliases: ["Welcome", "role-0"],
    excluded: ["Cleanup", "role-1", "role-9", "other", "0-0"],
  },
];

for (const { project, selected, aliases, excluded } of cases) {
  const sessions = [...aliases, ...excluded];
  const filters = {
    ...parseAttendanceExportFilters(new URLSearchParams(), "project"),
    sessionId: selected,
    from: date,
    to: date,
  };
  const signups: ExportSignup[] = sessions.map((session, index) => ({
    id: `signup-${index}`,
    schedule_id: session,
    user_id: `account-${index}`,
    anonymous_id: null,
    status: "attended",
    attendance_revision: 1,
    // The next UTC day is intentional: service-date filtering uses the session date.
    check_in_time: "2026-09-21T00:00:00Z",
    check_out_time: "2026-09-21T01:00:00Z",
    profile: {
      full_name: "Fictional volunteer",
      email: "volunteer@example.test",
    },
    guest: null,
  }));

  test(`${project.event_type} published exports include every session alias and preserve stored IDs`, () => {
    const certificates = signups.map((signup, index) => ({
      id: `certificate-${index}`,
      signup_id: signup.id,
      schedule_id: signup.schedule_id,
      user_id: signup.user_id,
      volunteer_name: signup.profile!.full_name,
      volunteer_email: signup.profile!.email,
      event_start: signup.check_in_time!,
      event_end: signup.check_out_time!,
      credited_minutes: 60,
      attendance_revision: 1,
      type: "verified",
    }));
    const records = buildAttendanceExportRecords(
      project,
      signups,
      certificates,
      [],
      filters,
    );
    assert.deepEqual(
      records.map((row) => row.sessionId),
      aliases,
    );
    assert.ok(
      records.every(
        (row) =>
          row.serviceDate === date &&
          row.creditedMinutes === 60 &&
          row.publicationState === "published",
      ),
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(records)).map(
        (row: { sessionId: string }) => row.sessionId,
      ),
      aliases,
    );
    for (const alias of aliases) {
      assert.ok(attendanceExportCsv(records).includes(`"${alias}"`));
      assert.equal(serviceDate(project, alias), date);
    }
    assert.equal(serviceDate(project, "invalid-session"), null);
    assert.deepEqual(
      buildAttendanceExportRecords(project, signups, certificates, [], {
        ...filters,
        sessionId: aliases.at(-1)!,
      }).map((row) => row.sessionId),
      aliases,
    );
    const orphanRecords = buildAttendanceExportRecords(
      project,
      [],
      certificates.map((cert) => ({ ...cert, signup_id: null })),
      [],
      filters,
    );
    assert.deepEqual(
      orphanRecords.map((row) => row.sessionId),
      aliases,
    );
  });

  test(`${project.event_type} explicit unpublished exports filter signup, roster and incomplete review aliases`, () => {
    const unpublished = { ...filters, includeUnpublished: true };
    assert.equal(
      buildAttendanceExportRecords(project, signups, [], [], filters).length,
      0,
    );
    const pending = buildAttendanceExportRecords(
      project,
      signups,
      [],
      [],
      unpublished,
    );
    assert.deepEqual(
      pending.map((row) => row.sessionId),
      aliases,
    );
    assert.ok(
      pending.every(
        (row) =>
          row.creditedMinutes === null && row.publicationState === "pending",
      ),
    );
    const roster = sessions.map((session, index) => ({
      id: `roster-${index}`,
      scan_row_id: null,
      schedule_id: session,
      name: "Fictional walk-in",
      check_in_time: null,
      check_out_time: null,
      attendance_intervals: [],
    }));
    const reviews = sessions.map((session, index) => ({
      id: `review-${index}`,
      name: "Fictional transcription",
      email: null,
      check_in_time: null,
      check_out_time: null,
      attendance_intervals: [],
      review_revision: 1,
      review_acknowledged: false,
      identity_confirmed: false,
      decision: "include",
      outcome: "pending",
      committed_signup_id: null,
      batch: { schedule_id: session, status: "review" },
    }));
    assert.equal(
      buildUnpublishedAttendanceRecords(project, roster, reviews, filters)
        .length,
      0,
    );
    const records = buildUnpublishedAttendanceRecords(
      project,
      roster,
      reviews,
      unpublished,
    );
    assert.deepEqual(
      records.map((row) => row.sessionId),
      [...aliases, ...aliases],
    );
    assert.ok(
      records.every(
        (row) =>
          row.serviceDate === date &&
          row.publicationState === "unresolved" &&
          row.creditedMinutes === null,
      ),
    );
  });
}
