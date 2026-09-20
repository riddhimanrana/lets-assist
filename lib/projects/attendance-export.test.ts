import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  attendanceExportCsv,
  buildAttendanceExportRecords,
  canExportAttendance,
  parseAttendanceExportFilters,
  serviceDate,
  type ExportCertificate,
  type ExportProject,
  type ExportSignup,
} from "./attendance-export";
import { readAllExportPages } from "./attendance-export-pagination";
import { certificateHours } from "./certificate-duration";

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
const signup: ExportSignup = {
  id: "signup-a",
  schedule_id: "oneTime",
  user_id: null,
  anonymous_id: "guest-a",
  status: "attended",
  attendance_revision: 2,
  check_in_time: "2026-09-19T16:00:00Z",
  check_out_time: "2026-09-19T22:00:00Z",
  profile: null,
  guest: { name: "Guest Example", email: "guest@example.test" },
};
const certificate: ExportCertificate = {
  id: "cert-a",
  signup_id: "signup-a",
  schedule_id: "oneTime",
  user_id: null,
  volunteer_name: "Guest Example",
  volunteer_email: "guest@example.test",
  event_start: signup.check_in_time!,
  event_end: signup.check_out_time!,
  credited_minutes: 120,
  attendance_revision: 2,
  type: "verified",
};
const filters = parseAttendanceExportFilters(new URLSearchParams(), "project");

test("only creators and currently active eligible managers can export projects", () => {
  assert.equal(canExportAttendance("project", project, "creator", null), true);
  assert.equal(
    canExportAttendance("project", project, "other", {
      role: "admin",
      status: "active",
    }),
    true,
  );
  assert.equal(
    canExportAttendance("project", project, "other", {
      role: "staff",
      status: "active",
    }),
    true,
  );
  assert.equal(
    canExportAttendance(
      "project",
      { ...project, can_be_managed_by_staff: false },
      "other",
      { role: "staff", status: "active" },
    ),
    false,
  );
  for (const status of ["inactive", "invited", "pending", null]) {
    assert.equal(
      canExportAttendance("project", project, "other", {
        role: "admin",
        status,
      }),
      false,
    );
  }
  assert.equal(
    canExportAttendance("project", project, "other", {
      role: "member",
      status: "active",
    }),
    false,
  );
  assert.equal(canExportAttendance("project", null, "creator", null), false);
});

test("organization scope requires an active admin even for project creators or staff", () => {
  assert.equal(
    canExportAttendance("organization", project, "creator", null),
    false,
  );
  assert.equal(
    canExportAttendance("organization", project, "creator", {
      role: "staff",
      status: "active",
    }),
    false,
  );
  assert.equal(
    canExportAttendance("organization", project, "other", {
      role: "admin",
      status: "active",
    }),
    true,
  );
  assert.equal(
    canExportAttendance("organization", project, "other", {
      role: "admin",
      status: "inactive",
    }),
    false,
  );
});

test("dates, duplicate filters, unknown scopes, and publication flags fail closed", () => {
  for (const query of [
    "from=2026-02-30",
    "from=2026-09-20&to=2026-09-19",
    "format=xml",
    "from=2026-01-01&from=2026-02-02",
    "includeUnpublished=yes",
    "token=secret",
    "sessionId=",
  ]) {
    assert.throws(() =>
      parseAttendanceExportFilters(new URLSearchParams(query), "project"),
    );
  }
  assert.throws(() =>
    parseAttendanceExportFilters(
      new URLSearchParams("sessionId=oneTime"),
      "organization",
    ),
  );
  assert.equal(filters.includeUnpublished, false);
});

test("organization project filters validate UUIDs and cannot change project scope", () => {
  const projectId = "40000000-0000-4000-8000-000000000001";
  assert.equal(
    parseAttendanceExportFilters(
      new URLSearchParams({ projectId }),
      "organization",
    ).projectId,
    projectId,
  );
  assert.throws(() =>
    parseAttendanceExportFilters(new URLSearchParams({ projectId }), "project"),
  );
  assert.throws(() =>
    parseAttendanceExportFilters(
      new URLSearchParams({ projectId: "bad" }),
      "organization",
    ),
  );
});

test("guests outside membership are included with split intervals and canonical minutes", () => {
  const intervals = [
    {
      id: "i1",
      signup_id: signup.id,
      check_in_time: "2026-09-19T16:00:00Z",
      check_out_time: "2026-09-19T17:00:00Z",
    },
    {
      id: "i2",
      signup_id: signup.id,
      check_in_time: "2026-09-19T21:00:00Z",
      check_out_time: "2026-09-19T22:00:00Z",
    },
  ];
  const [record] = buildAttendanceExportRecords(
    project,
    [signup],
    [certificate],
    intervals,
    filters,
  );
  assert.equal(record.creditedMinutes, 120);
  assert.equal(record.intervals.length, 2);
  assert.equal(record.participantId, "guest-a");
  assert.equal(record.participantType, "guest");
  assert.equal(record.publicationState, "published");
  assert.equal(record.serviceDate, "2026-09-19");
  assert.equal(record.email, "guest@example.test");
  assert.equal("token" in record, false);
});

test("pending, unresolved, and stale certificate rows never receive credited minutes", () => {
  assert.equal(
    buildAttendanceExportRecords(project, [signup], [], [], filters).length,
    0,
  );
  const pendingFilters = { ...filters, includeUnpublished: true };
  const [pending] = buildAttendanceExportRecords(
    project,
    [signup],
    [],
    [],
    pendingFilters,
  );
  assert.equal(pending.publicationState, "pending");
  assert.equal(pending.creditedMinutes, null);
  const [unresolved] = buildAttendanceExportRecords(
    project,
    [{ ...signup, check_out_time: null }],
    [],
    [],
    pendingFilters,
  );
  assert.equal(unresolved.publicationState, "unresolved");
  assert.equal(unresolved.creditedMinutes, null);
  const [stale] = buildAttendanceExportRecords(
    project,
    [{ ...signup, attendance_revision: 3 }],
    [certificate],
    [],
    pendingFilters,
  );
  assert.equal(stale.publicationState, "pending");
  assert.equal(stale.creditedMinutes, null);
});

test("date filtering follows service dates and project timezones rather than issuance date", () => {
  const dated = { ...filters, from: "2026-09-19", to: "2026-09-19" };
  assert.equal(
    buildAttendanceExportRecords(project, [signup], [certificate], [], dated)
      .length,
    1,
  );
  assert.equal(
    buildAttendanceExportRecords(project, [signup], [certificate], [], {
      ...dated,
      from: "2026-09-20",
      to: "2026-09-20",
    }).length,
    0,
  );
  assert.equal(
    serviceDate({ ...project, schedule: {} }, "old", "2026-09-20T02:00:00Z"),
    "2026-09-19",
  );
  const multi = {
    ...project,
    schedule: {
      multiDay: [
        {
          date: "2026-09-19",
          slots: [{ startTime: "09:00", endTime: "15:00", volunteers: 10 }],
        },
      ],
    },
  };
  assert.equal(serviceDate(multi, "2026-09-19-0-0"), "2026-09-19");
  assert.equal(serviceDate(multi, "2026-09-19-0"), "2026-09-19");
});

test("historical and orphan certificates keep their original envelope total", () => {
  const [record] = buildAttendanceExportRecords(
    project,
    [],
    [{ ...certificate, signup_id: null, credited_minutes: null }],
    [],
    filters,
  );
  assert.equal(record.creditedMinutes, 360);
  assert.equal(record.certificateId, certificate.id);
  assert.equal(
    certificateHours({ credited_minutes: null }, () => 1.2),
    1.2,
  );
  assert.equal(
    certificateHours({ credited_minutes: 61 }, () => {
      throw new Error("legacy calculation must not run");
    }),
    61 / 60,
  );
  assert.equal(
    certificateHours({ credited_minutes: 0 }, () => 99),
    0,
  );
});

test("CSV quotes commas, quotes, and newlines and neutralizes spreadsheet formulas", () => {
  const [record] = buildAttendanceExportRecords(
    project,
    [signup],
    [certificate],
    [],
    filters,
  );
  const csv = attendanceExportCsv([
    {
      ...record,
      name: '\n=HYPERLINK("x")',
      email: "a,b@example.test",
      projectTitle: 'One\n"two"',
    },
  ]);
  assert.ok(csv.includes('"\'\n=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"a,b@example.test"'));
  assert.ok(csv.includes('"One\n""two"""'));
  assert.ok(csv.includes('"[{""checkIn"":'));
  assert.ok(csv.endsWith("\r\n"));
});

test("keyset pagination continues beyond server row caps and exact page boundaries", async () => {
  const rows = Array.from({ length: 1200 }, (_, n) => ({
    id: String(n).padStart(5, "0"),
  }));
  let calls = 0;
  const loaded = await readAllExportPages(async (after, requestedLimit) => {
    calls++;
    assert.equal(requestedLimit, 500);
    return {
      data: rows.filter((row) => !after || row.id > after).slice(0, 100),
      error: null,
    };
  });
  assert.equal(loaded.length, 1200);
  assert.equal(calls, 13);
  assert.deepEqual(loaded, rows);
});

test("pagination never returns partial data on query failures, duplicates, or limits", async () => {
  await assert.rejects(
    readAllExportPages(async () => ({
      data: null,
      error: { message: "failure" },
    })),
    /complete export/,
  );
  await assert.rejects(
    readAllExportPages(async () => ({ data: [{ id: "a" }], error: null })),
    /changed while loading/,
  );
  await assert.rejects(
    readAllExportPages(
      async () => ({ data: [{ id: "a" }, { id: "b" }], error: null }),
      1,
    ),
    /row limit/,
  );
});

test("server transport revalidates authorization, scopes every table, and blocks caching", () => {
  const source = readFileSync(
    new URL("./attendance-export-service.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.startsWith('import "server-only"'));
  assert.equal((source.match(/session.auth.getUser\(\)/g) ?? []).length, 2);
  assert.equal((source.match(/await assertAccess\(/g) ?? []).length, 2);
  assert.ok(source.includes('.eq("project_id", projectId)'));
  assert.ok(source.includes('.eq("organization_id", scopeId)'));
  assert.ok(source.includes('"private, no-store, max-age=0"'));
  assert.ok(!source.includes("token,"));
});

test("unverified organizations still publish awards, self-reported records do not", () => {
  assert.equal(
    buildAttendanceExportRecords(project, [signup], [certificate], [], filters)
      .length,
    1,
  );
  assert.equal(
    buildAttendanceExportRecords(
      project,
      [signup],
      [{ ...certificate, type: "self-reported" }],
      [],
      filters,
    ).length,
    0,
  );
  assert.equal(
    buildAttendanceExportRecords(
      project,
      [signup],
      [{ ...certificate, type: null, credited_minutes: null }],
      [],
      filters,
    ).length,
    1,
  );
});

test("historical account certificates without signup IDs appear once per account and session", () => {
  const records = buildAttendanceExportRecords(
    project,
    [{ ...signup, user_id: "account-a", anonymous_id: null }],
    [
      {
        ...certificate,
        signup_id: null,
        user_id: "account-a",
        credited_minutes: null,
      },
    ],
    [],
    { ...filters, includeUnpublished: true },
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].publicationState, "published");
  assert.equal(records[0].participantId, "account-a");
});

test("corrected legacy certificates retain published canonical minutes in JSON and CSV", () => {
  for (const creditedMinutes of [120, 0]) {
    const correctedLegacy = {
      ...certificate,
      type: null,
      credited_minutes: creditedMinutes,
    };
    const records = buildAttendanceExportRecords(
      project,
      [signup],
      [correctedLegacy],
      [],
      filters,
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].publicationState, "published");
    assert.equal(records[0].creditedMinutes, creditedMinutes);
    assert.equal(records[0].certificateId, certificate.id);
    assert.equal(records[0].attendanceRevision, signup.attendance_revision);
    const json = JSON.parse(JSON.stringify({ schemaVersion: 1, records }));
    assert.equal(json.records[0].creditedMinutes, creditedMinutes);
    const csv = attendanceExportCsv(records);
    assert.ok(
      csv.endsWith(`,"${creditedMinutes}","published","cert-a","2"\r\n`),
    );
    assert.ok(
      csv
        .split("\r\n")[0]
        .endsWith(
          '"creditedMinutes","publicationState","certificateId","attendanceRevision"',
        ),
    );
  }
});

test("a corrected legacy certificate with a stale revision stays unpublished", () => {
  const stale = {
    ...certificate,
    type: null,
    attendance_revision: 1,
  };
  assert.deepEqual(
    buildAttendanceExportRecords(project, [signup], [stale], [], filters),
    [],
  );
  const [record] = buildAttendanceExportRecords(
    project,
    [signup],
    [stale],
    [],
    { ...filters, includeUnpublished: true },
  );
  assert.equal(record.publicationState, "pending");
  assert.equal(record.creditedMinutes, null);
  assert.equal(record.certificateId, certificate.id);
});
