import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const sheetReference = "30000000-0000-4000-8000-000000000001";
const signupId = "40000000-0000-4000-8000-000000000001";
let actor: string | null;
let authCalls: number;
let queried: string[];
let tables: Record<string, Array<Record<string, unknown>>>;
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => {
    authCalls++;
    return { user: actor ? { id: actor } : null, error: null };
  },
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
        or(expression: string) {
          const pairs = [
            ...expression.matchAll(
              /and\(sheet_id\.eq\.([^,]+),row_reference\.eq\.([^)]+)\)/g,
            ),
          ];
          rows = rows.filter((row) =>
            pairs.some(
              (pair) =>
                row.sheet_id === pair[1] && row.row_reference === pair[2],
            ),
          );
          return query;
        },
        then(resolve: (result: { data: typeof rows; error: null }) => unknown) {
          return Promise.resolve({
            data: rows.slice(0, 1000),
            error: null,
          }).then(resolve);
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
const {
  resolveAttendancePrintReference,
  resolveAuthorizedAttendancePrintReferences,
  requireAttendancePrintAccess,
  attendancePrintSessions,
} = await import("./print-manifest");
const input = {
  projectId,
  scheduleId: "oneTime",
  sheetReference,
  rowReference: "0123456789ab",
};

beforeEach(() => {
  actor = owner;
  authCalls = 0;
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
        user_id: owner,
        anonymous_id: null,
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

describe("batched attendance printed references", () => {
  test("300 repeated references reuse one authorization and three manifest queries", async () => {
    const access = await requireAttendancePrintAccess(projectId);
    expect(access).not.toBeNull();
    const references = Array.from({ length: 300 }, () => ({
      sheetReference,
      rowReference: input.rowReference,
    }));
    const results = await resolveAuthorizedAttendancePrintReferences(access!, {
      ...input,
      references,
    });
    expect(results).toHaveLength(300);
    expect(
      results.every(
        (result) => result?.signupId === signupId && result.userId === owner,
      ),
    ).toBe(true);
    expect(authCalls).toBe(1);
    expect(queried).toEqual([
      "projects",
      "project_attendance_print_sheets",
      "project_attendance_print_rows",
      "project_signups",
    ]);
  });
  test("300 distinct references stay within bounded queries and preserve exact sheet-row pairs", async () => {
    const references = Array.from({ length: 300 }, (_, index) => ({
      sheetReference,
      rowReference: index.toString(16).padStart(12, "0"),
    }));
    tables.project_attendance_print_rows = references.map(
      (reference, index) => ({
        sheet_id: sheetReference,
        project_id: projectId,
        row_reference: reference.rowReference,
        row_number: index + 1,
        row_kind: "signup",
        signup_id: signupId,
      }),
    );
    const access = await requireAttendancePrintAccess(projectId);
    const results = await resolveAuthorizedAttendancePrintReferences(access!, {
      ...input,
      references,
    });
    expect(results.map((result) => result?.rowNumber)).toEqual(
      Array.from({ length: 300 }, (_, index) => index + 1),
    );
    expect(
      queried.filter((table) => table === "project_attendance_print_rows"),
    ).toHaveLength(6);
    expect(queried).toHaveLength(9);
    expect(authCalls).toBe(1);
  });
  test("batch project mismatch and invalid syntax fail before manifest access", async () => {
    const access = await requireAttendancePrintAccess(projectId);
    queried = [];
    expect(
      await resolveAuthorizedAttendancePrintReferences(access!, {
        ...input,
        projectId: other,
        references: [input],
      }),
    ).toEqual([null]);
    expect(
      await resolveAuthorizedAttendancePrintReferences(access!, {
        ...input,
        references: [
          { sheetReference, rowReference: "0123456789ab),id.neq.0" },
        ],
      }),
    ).toEqual([null]);
    expect(queried).toEqual([]);
  });
  test("copied row and sheet pieces do not resolve as a pair", async () => {
    const secondSheet = "30000000-0000-4000-8000-000000000002";
    const secondRow = "aaaaaaaaaaaa";
    tables.project_attendance_print_sheets.push({
      id: secondSheet,
      project_id: projectId,
      schedule_id: "oneTime",
    });
    tables.project_attendance_print_rows.push({
      ...tables.project_attendance_print_rows[0],
      sheet_id: secondSheet,
      row_reference: secondRow,
    });
    const access = await requireAttendancePrintAccess(projectId);
    expect(
      await resolveAuthorizedAttendancePrintReferences(access!, {
        ...input,
        references: [
          { sheetReference, rowReference: secondRow },
          { sheetReference: secondSheet, rowReference: input.rowReference },
        ],
      }),
    ).toEqual([null, null]);
  });
});

test("300 distinct sheets and participants use at most 18 bounded manifest queries", async () => {
  const references = Array.from({ length: 300 }, (_, index) => ({
    sheetReference: `30000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    rowReference: "0123456789ab",
  }));
  tables.project_attendance_print_sheets = references.map((reference) => ({
    id: reference.sheetReference,
    project_id: projectId,
    schedule_id: "oneTime",
  }));
  tables.project_attendance_print_rows = references.map((reference, index) => ({
    sheet_id: reference.sheetReference,
    project_id: projectId,
    row_reference: reference.rowReference,
    row_kind: "signup",
    row_number: 1,
    signup_id: `signup-${index}`,
  }));
  tables.project_signups = references.map((_, index) => ({
    id: `signup-${index}`,
    user_id: null,
    anonymous_id: `guest-${index}`,
    project_id: projectId,
    schedule_id: "oneTime",
    status: "attended",
  }));
  const access = await requireAttendancePrintAccess(projectId);
  const resolved = await resolveAuthorizedAttendancePrintReferences(access!, {
    ...input,
    references,
  });
  expect(resolved.map((row) => row?.anonymousId)).toEqual(
    references.map((_, index) => `guest-${index}`),
  );
  for (const table of [
    "project_attendance_print_sheets",
    "project_attendance_print_rows",
    "project_signups",
  ])
    expect(queried.filter((value) => value === table)).toHaveLength(6);
  expect(authCalls).toBe(1);
});

test("oversized reference requests fail before reading manifests", async () => {
  const access = await requireAttendancePrintAccess(projectId);
  queried = [];
  await expect(
    resolveAuthorizedAttendancePrintReferences(access!, {
      ...input,
      references: Array.from({ length: 301 }, () => input),
    }),
  ).rejects.toThrow("Too many printed references");
  expect(queried).toEqual([]);
});
