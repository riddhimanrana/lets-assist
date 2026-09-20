import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const sheetReference = "30000000-0000-4000-8000-000000000001";
const signupId = "40000000-0000-4000-8000-000000000001";
let actor: string | null;
let queried: string[];
let tables: Record<string, Array<Record<string, unknown>>>;
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({
    user: actor ? { id: actor } : null,
    error: null,
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      queried.push(table);
      let rows = tables[table] ?? [];
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        async single() {
          return { data: rows[0] ?? null, error: null };
        },
        async maybeSingle() {
          return { data: rows[0] ?? null, error: null };
        },
      };
      return query;
    },
  }),
}));
const { resolveAttendancePrintReference, attendancePrintSessions } =
  await import("./print-manifest");
const input = {
  projectId,
  scheduleId: "oneTime",
  sheetReference,
  rowReference: "0123456789ab",
};

beforeEach(() => {
  actor = owner;
  queried = [];
  tables = {
    projects: [
      {
        id: projectId,
        creator_id: owner,
        organization_id: "org",
        can_be_managed_by_staff: true,
        event_type: "oneTime",
        title: "Example project",
        project_timezone: "America/Los_Angeles",
        schedule: {
          oneTime: {
            date: "2026-09-20",
            startTime: "10:00",
            endTime: "12:00",
            volunteers: 20,
          },
        },
      },
    ],
    organization_members: [
      {
        organization_id: "org",
        user_id: other,
        role: "staff",
        status: "active",
      },
    ],
    project_attendance_print_sheets: [
      { id: sheetReference, project_id: projectId, schedule_id: "oneTime" },
    ],
    project_attendance_print_rows: [
      {
        sheet_id: sheetReference,
        project_id: projectId,
        row_reference: input.rowReference,
        row_number: 1,
        row_kind: "signup",
        signup_id: signupId,
      },
    ],
    project_signups: [
      {
        id: signupId,
        project_id: projectId,
        schedule_id: "oneTime",
        status: "approved",
      },
    ],
  };
});

describe("attendance print reference authorization", () => {
  test("reference maps only to its stored signup after organizer authorization", async () => {
    expect(await resolveAttendancePrintReference(input)).toEqual({
      signupId,
      rowKind: "signup",
      rowNumber: 1,
    });
  });
  test("signed-out requests cannot read any manifest data", async () => {
    actor = null;
    expect(await resolveAttendancePrintReference(input)).toBeNull();
    expect(queried).toEqual([]);
  });
  test("invalid reference syntax fails before reading data", async () => {
    expect(
      await resolveAttendancePrintReference({
        ...input,
        rowReference: "not-a-reference",
      }),
    ).toBeNull();
    expect(queried).toEqual([]);
  });
  test("active staff can resolve and revoked membership immediately fails", async () => {
    actor = other;
    expect(await resolveAttendancePrintReference(input)).not.toBeNull();
    tables.organization_members[0].status = "inactive";
    queried = [];
    expect(await resolveAttendancePrintReference(input)).toBeNull();
    expect(queried).not.toContain("project_attendance_print_sheets");
  });
  test("staff opt-out prevents roster access", async () => {
    actor = other;
    tables.projects[0].can_be_managed_by_staff = false;
    expect(await resolveAttendancePrintReference(input)).toBeNull();
    expect(queried).not.toContain("project_attendance_print_sheets");
  });
  test("a copied sheet reference cannot cross projects or sessions", async () => {
    tables.project_attendance_print_sheets[0].project_id = "another-project";
    expect(await resolveAttendancePrintReference(input)).toBeNull();
    tables.project_attendance_print_sheets[0].project_id = projectId;
    tables.project_attendance_print_sheets[0].schedule_id = "another-session";
    expect(await resolveAttendancePrintReference(input)).toBeNull();
  });
  test("a row from another sheet cannot resolve", async () => {
    tables.project_attendance_print_rows[0].sheet_id = "another-sheet";
    expect(await resolveAttendancePrintReference(input)).toBeNull();
  });
  test("rejected or moved signup invalidates the old printed reference", async () => {
    tables.project_signups[0].status = "rejected";
    expect(await resolveAttendancePrintReference(input)).toBeNull();
    tables.project_signups[0].status = "approved";
    tables.project_signups[0].schedule_id = "another-session";
    expect(await resolveAttendancePrintReference(input)).toBeNull();
  });
  test("a continuation ref never supplies a signup identity", async () => {
    tables.project_attendance_print_rows[0].row_kind = "continuation";
    tables.project_attendance_print_rows[0].signup_id = null;
    expect(await resolveAttendancePrintReference(input)).toEqual({
      signupId: null,
      rowKind: "continuation",
      rowNumber: 1,
    });
  });
  test("session options carry the timezone-correct session window", () => {
    const project = tables.projects[0] as unknown as Parameters<
      typeof attendancePrintSessions
    >[0];
    expect(attendancePrintSessions(project)).toEqual([
      {
        id: "oneTime",
        label: "Main session",
        startsAt: Date.parse("2026-09-20T17:00:00Z"),
        endsAt: Date.parse("2026-09-20T19:00:00Z"),
      },
    ]);
  });
});
