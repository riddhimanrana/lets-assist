import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceExportError } from "./attendance-export";
import {
  readAllExportPages,
  type ExportReadBudget,
} from "./attendance-export-pagination";
import {
  loadAttendanceExportSources,
  type AttendanceExportReaders,
  type AttendanceExportSources,
} from "./attendance-export-sources";

const fixture: AttendanceExportSources = {
  project: {
    id: "project-a",
    title: "Fictional cleanup",
    creator_id: "organizer-a",
    organization_id: "org-a",
    can_be_managed_by_staff: true,
    project_timezone: "America/Los_Angeles",
    event_type: "oneTime",
    schedule: {
      oneTime: {
        date: "2026-09-19",
        startTime: "09:00",
        endTime: "11:00",
        volunteers: 10,
      },
    },
    published: { oneTime: true },
  },
  signups: [
    {
      id: "signup-a",
      schedule_id: "oneTime",
      user_id: "volunteer-a",
      anonymous_id: null,
      status: "attended",
      attendance_revision: 1,
      check_in_time: "2026-09-19T16:00:00Z",
      check_out_time: "2026-09-19T17:00:00Z",
      profile: {
        full_name: "Fictional volunteer",
        email: "volunteer@example.test",
      },
      guest: { name: "Fictional guest", email: "guest@example.test" },
    },
  ],
  certificates: [
    {
      id: "cert-a",
      signup_id: "signup-a",
      schedule_id: "oneTime",
      user_id: "volunteer-a",
      volunteer_name: "Fictional volunteer",
      volunteer_email: "volunteer@example.test",
      event_start: "2026-09-19T16:00:00Z",
      event_end: "2026-09-19T17:00:00Z",
      credited_minutes: 60,
      attendance_revision: 1,
      type: "verified",
    },
  ],
  intervals: [
    {
      id: "interval-a",
      signup_id: "signup-a",
      check_in_time: "2026-09-19T16:00:00Z",
      check_out_time: "2026-09-19T17:00:00Z",
    },
  ],
  roster: [
    {
      id: "roster-a",
      scan_row_id: null,
      schedule_id: "oneTime",
      name: "Fictional walk-in",
      check_in_time: null,
      check_out_time: null,
      attendance_intervals: [],
    },
  ],
  review: [
    {
      id: "review-a",
      name: "Fictional review",
      email: "review@example.test",
      check_in_time: null,
      check_out_time: null,
      attendance_intervals: [],
      review_revision: 1,
      review_acknowledged: false,
      identity_confirmed: false,
      decision: "exclude",
      outcome: "pending",
      committed_signup_id: null,
      batch: { schedule_id: "oneTime", status: "review" },
    },
  ],
};
const tableKeys = {
  project_signups: "signups",
  certificates: "certificates",
  project_attendance_intervals: "intervals",
  project_paper_roster_entries: "roster",
  project_paper_scan_rows: "review",
} as const;

function readersFor(
  mutate: (sources: AttendanceExportSources[]) => void = () => {},
  initial = [fixture],
) {
  const sources = structuredClone(initial);
  let passes = 0;
  const requested: Array<{
    table: string;
    columns: string;
    projectId: string;
  }> = [];
  const read = async <T extends { id: string }>(
    rows: T[],
    budget: ExportReadBudget,
  ) => {
    const frozen = structuredClone(rows).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    return readAllExportPages(
      async (after) => ({
        data: frozen
          .filter((row) => after === null || row.id > after)
          .slice(0, 1),
        error: null,
      }),
      async () => ({ count: frozen.length, error: null }),
      budget,
    );
  };
  const readers: AttendanceExportReaders = {
    projects: async (budget) => {
      if (++passes === 2) mutate(sources);
      return read(
        sources.map((source) => source.project),
        budget,
      );
    },
    rows: async <T extends { id: string }>(
      table: string,
      columns: string,
      projectId: string,
      budget: ExportReadBudget,
    ) => {
      requested.push({ table, columns, projectId });
      const source = sources.find((item) => item.project.id === projectId);
      assert.ok(source);
      const key = tableKeys[table as keyof typeof tableKeys];
      assert.ok(key);
      return read(source[key] as unknown as T[], budget);
    },
  };
  return { readers, requested };
}
const status = (code: number) => (error: unknown) =>
  error instanceof AttendanceExportError && error.status === code;

test("returns identical complete sources, including excluded review rows", async () => {
  const { readers, requested } = readersFor();
  assert.deepEqual(await loadAttendanceExportSources(readers, true), [fixture]);
  assert.equal(requested.length, 10);
  assert.ok(
    requested.every((request) => request.projectId === fixture.project.id),
  );
  assert.ok(
    requested
      .find((request) => request.table === "project_signups")
      ?.columns.includes("profile:profiles!"),
  );
  assert.ok(
    requested
      .find((request) => request.table === "project_signups")
      ?.columns.includes("guest:anonymous_signups!"),
  );
  assert.ok(
    requested
      .find((request) => request.table === "project_paper_scan_rows")
      ?.columns.includes("batch:project_paper_scan_batches!"),
  );
});

test("published-only exports neither fetch nor retain draft sources", async () => {
  const { readers, requested } = readersFor();
  const [source] = await loadAttendanceExportSources(readers, false);
  assert.deepEqual(source.roster, []);
  assert.deepEqual(source.review, []);
  assert.equal(requested.length, 6);
  assert.ok(
    requested.every((request) => !request.table.startsWith("project_paper")),
  );
});

const changes: Array<[string, (source: AttendanceExportSources) => void]> = [
  [
    "same-count signup replacement",
    (s) => {
      s.signups[0].id = "signup-b";
    },
  ],
  [
    "signup insertion behind the first cursor",
    (s) => {
      s.signups.unshift({ ...s.signups[0], id: "signup-0" });
    },
  ],
  [
    "signup deletion",
    (s) => {
      s.signups = [];
    },
  ],
  [
    "signup revision",
    (s) => {
      s.signups[0].attendance_revision = 2;
    },
  ],
  [
    "joined profile name",
    (s) => {
      s.signups[0].profile!.full_name = "Updated name";
    },
  ],
  [
    "joined profile email",
    (s) => {
      s.signups[0].profile!.email = "updated@example.test";
    },
  ],
  [
    "joined guest name",
    (s) => {
      s.signups[0].guest!.name = "Updated guest";
    },
  ],
  [
    "joined guest email",
    (s) => {
      s.signups[0].guest!.email = "updated@example.test";
    },
  ],
  [
    "joined identity removal",
    (s) => {
      s.signups[0].profile = null;
    },
  ],
  [
    "certificate value",
    (s) => {
      s.certificates[0].credited_minutes = 30;
    },
  ],
  [
    "certificate revision",
    (s) => {
      s.certificates[0].attendance_revision = 2;
    },
  ],
  [
    "interval value",
    (s) => {
      s.intervals[0].check_out_time = "2026-09-19T18:00:00Z";
    },
  ],
  [
    "roster name",
    (s) => {
      s.roster[0].name = "Updated roster";
    },
  ],
  [
    "roster interval",
    (s) => {
      s.roster[0].attendance_intervals = [
        { checkIn: "2026-09-19T16:00:00Z", checkOut: null },
      ];
    },
  ],
  [
    "excluded draft contents",
    (s) => {
      s.review[0].name = "Updated review";
    },
  ],
  [
    "draft email",
    (s) => {
      s.review[0].email = "updated@example.test";
    },
  ],
  [
    "draft decision",
    (s) => {
      s.review[0].decision = "include";
    },
  ],
  [
    "draft revision",
    (s) => {
      s.review[0].review_revision++;
    },
  ],
  [
    "draft intervals",
    (s) => {
      s.review[0].attendance_intervals = [{ checkIn: null, checkOut: null }];
    },
  ],
  [
    "draft confirmation",
    (s) => {
      s.review[0].identity_confirmed = true;
    },
  ],
  [
    "draft acknowledgement",
    (s) => {
      s.review[0].review_acknowledged = true;
    },
  ],
  [
    "batch status",
    (s) => {
      s.review[0].batch!.status = "committed";
    },
  ],
  [
    "batch session",
    (s) => {
      s.review[0].batch!.schedule_id = "other";
    },
  ],
  [
    "batch removal",
    (s) => {
      s.review[0].batch = null;
    },
  ],
  [
    "project reassignment",
    (s) => {
      s.project.organization_id = "org-b";
    },
  ],
  [
    "project schedule",
    (s) => {
      s.project.schedule.oneTime!.startTime = "10:00";
    },
  ],
  [
    "project publication",
    (s) => {
      s.project.published = { oneTime: false };
    },
  ],
];
for (const [name, mutate] of changes) {
  test(`rejects ${name} between raw source reads`, async () => {
    const { readers } = readersFor((sources) => mutate(sources[0]));
    await assert.rejects(
      loadAttendanceExportSources(readers, true),
      status(409),
    );
  });
}

for (const change of ["insert", "delete", "replace"]) {
  test(`rejects project ${change} between passes`, async () => {
    const { readers } = readersFor((sources) => {
      if (change === "delete") sources.pop();
      else if (change === "replace") sources[0].project.id = "project-b";
      else
        sources.push({
          ...structuredClone(fixture),
          project: { ...fixture.project, id: "project-b" },
        });
    });
    await assert.rejects(
      loadAttendanceExportSources(readers, true),
      status(409),
    );
  });
}

test("aggregate limit includes project rows and every source table", async () => {
  const { readers } = readersFor();
  await assert.rejects(
    loadAttendanceExportSources(readers, true, 5),
    status(413),
  );
  assert.deepEqual(
    await loadAttendanceExportSources(readersFor().readers, true, 6),
    [fixture],
  );
});

test("aggregate limit spans all projects rather than resetting per project", async () => {
  const second = {
    ...structuredClone(fixture),
    project: { ...fixture.project, id: "project-b" },
  };
  await assert.rejects(
    loadAttendanceExportSources(
      readersFor(undefined, [fixture, second]).readers,
      true,
      11,
    ),
    status(413),
  );
  assert.equal(
    (
      await loadAttendanceExportSources(
        readersFor(undefined, [fixture, second]).readers,
        true,
        12,
      )
    ).length,
    2,
  );
});
