import { beforeEach, expect, mock, test } from "bun:test";
import type { CertificateRow, ProjectRow, SignupRow } from "./report/types";

const project: ProjectRow = {
  id: "project-a",
  title: "Fictional project",
  status: "completed",
  workflow_status: "published",
};
const visits = [
  {
    check_in_time: "2026-09-19T09:00:00Z",
    check_out_time: "2026-09-19T10:00:00Z",
  },
  {
    check_in_time: "2026-09-19T14:00:00Z",
    check_out_time: "2026-09-19T15:00:00Z",
  },
];
const signup: SignupRow = {
  id: "signup-a",
  project_id: project.id,
  user_id: "volunteer-a",
  schedule_id: "oneTime",
  check_in_time: visits[0].check_in_time,
  check_out_time: visits[1].check_out_time,
  project_attendance_intervals: visits,
  profiles: {
    id: "volunteer-a",
    full_name: "Fictional volunteer",
    email: "volunteer@example.test",
  },
};
const certificate: CertificateRow = {
  id: "certificate-a",
  signup_id: signup.id,
  user_id: signup.user_id,
  project_id: project.id,
  volunteer_name: "Fictional volunteer",
  issued_at: "2026-09-19T16:00:00Z",
  is_certified: true,
  event_start: signup.check_in_time,
  event_end: signup.check_out_time,
  type: "verified",
  credited_minutes: 90,
};
let signups: SignupRow[];
let certificates: CertificateRow[];
let signedIn = true;
let role = "admin";
let membershipStatus: string | null = "active";
let revokeMembershipAfterRead = false;
let changeAccountAfterRead = false;
let authId = "manager";
const authOptions: unknown[] = [];
let attendanceFailure = false;
let intervalFailure = false;
let pageCap = 500;
const adminTables: string[] = [];
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
function buildReadFixture(table: string) {
  let after: string | null = null;
  let signupIds: string[] = [];
  let limit = 500;
  const intervalRows = () =>
    signups
      .flatMap((row, signupIndex) =>
        (row.project_attendance_intervals ?? []).map((interval, index) => ({
          ...interval,
          id: `${signupIndex.toString().padStart(4, "0")}-${index.toString().padStart(4, "0")}`,
          signup_id: row.id,
        })),
      )
      .filter(
        (row) =>
          signupIds.includes(row.signup_id) && (!after || row.id > after),
      )
      .slice(0, Math.min(limit, pageCap));
  const result = () => ({
    data:
      table === "organization_members"
        ? { role, status: membershipStatus }
        : table === "projects"
          ? [project]
          : table === "certificates"
            ? certificates
            : table === "project_attendance_intervals"
              ? intervalFailure
                ? null
                : intervalRows()
              : attendanceFailure
                ? null
                : signups.map(
                    ({ project_attendance_intervals: omitted, ...row }) => {
                      void omitted;
                      return row;
                    },
                  ),
    error:
      (table === "project_signups" && attendanceFailure) ||
      (table === "project_attendance_intervals" && intervalFailure)
        ? { message: "fixture unavailable" }
        : null,
  });
  const query = {
    select(value: string) {
      calls.push({ table, method: "select", args: [value] });
      return query;
    },
    eq(...args: unknown[]) {
      calls.push({ table, method: "eq", args });
      return query;
    },
    in(...args: unknown[]) {
      if (args[0] === "signup_id") signupIds = args[1] as string[];
      calls.push({ table, method: "in", args });
      return query;
    },
    not(...args: unknown[]) {
      calls.push({ table, method: "not", args });
      return query;
    },
    gte(...args: unknown[]) {
      calls.push({ table, method: "gte", args });
      return query;
    },
    lte(...args: unknown[]) {
      calls.push({ table, method: "lte", args });
      return query;
    },
    order: () => query,
    limit(value: number) {
      limit = value;
      return query;
    },
    gt(_column: string, value: string) {
      after = value;
      return query;
    },
    single: async () => result(),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
      Promise.resolve(result()).then(resolve),
  };
  return query;
}
const client = { from: buildReadFixture };
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async (options: unknown) => {
    authOptions.push(options);
    return { user: signedIn ? { id: authId } : null };
  },
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      adminTables.push(table);
      if (table === "project_attendance_intervals") {
        if (revokeMembershipAfterRead) membershipStatus = "inactive";
        if (changeAccountAfterRead) authId = "other-manager";
      }
      return buildReadFixture(table);
    },
  }),
}));
const { getOrganizationReportData, getOrganizationReportDataForSync } =
  await import("./report-service");
const range = { from: "2026-09-01", to: "2026-09-30" };
const report = () => getOrganizationReportData("org-a", range);
beforeEach(() => {
  signups = [signup];
  certificates = [];
  signedIn = true;
  role = "admin";
  membershipStatus = "active";
  revokeMembershipAfterRead = false;
  changeAccountAfterRead = false;
  authId = "manager";
  authOptions.length = 0;
  attendanceFailure = false;
  intervalFailure = false;
  pageCap = 500;
  adminTables.length = 0;
  calls.length = 0;
});

test("reviewed split visits report two pending hours at every aggregation level", async () => {
  const { data, error } = await report();
  expect(error).toBeUndefined();
  expect(data?.metrics.pendingHours).toBe(2);
  expect(data?.metrics.totalHours).toBe(2);
  expect(data?.volunteers[0].pendingHours).toBe(2);
  expect(data?.projects[0].pendingHours).toBe(2);
  expect(data?.monthlyHours[0].pending).toBe(2);
  expect(
    adminTables.every((table) => table === "project_attendance_intervals"),
  ).toBe(true);
  expect(
    calls.find(
      (call) => call.table === "project_signups" && call.method === "select",
    )?.args[0],
  ).not.toContain("project_attendance_intervals");
  expect(calls).toContainEqual({
    table: "project_attendance_intervals",
    method: "select",
    args: ["id, signup_id, check_in_time, check_out_time"],
  });
  expect(calls).toContainEqual({
    table: "project_attendance_intervals",
    method: "in",
    args: ["signup_id", [signup.id]],
  });
  expect(calls).toContainEqual({
    table: "project_attendance_intervals",
    method: "in",
    args: ["project_id", [project.id]],
  });
  expect(calls).toContainEqual({
    table: "projects",
    method: "eq",
    args: ["organization_id", "org-a"],
  });
  for (const table of ["certificates", "project_signups"]) {
    expect(calls).toContainEqual({
      table,
      method: "in",
      args: ["project_id", [project.id]],
    });
    expect(
      calls.some((call) => call.table === table && call.method === "gte"),
    ).toBe(true);
    expect(
      calls.some((call) => call.table === table && call.method === "lte"),
    ).toBe(true);
  }
});

test("reviewed visits round their combined duration once and aggregate before display rounding", async () => {
  signups = [
    {
      ...signup,
      project_attendance_intervals: [
        {
          check_in_time: "2026-09-19T09:00:00Z",
          check_out_time: "2026-09-19T09:01:20Z",
        },
        {
          check_in_time: "2026-09-19T14:00:00Z",
          check_out_time: "2026-09-19T14:01:20Z",
        },
      ],
    },
  ];
  expect((await report()).data?.metrics.pendingHours).toBe(0.1);
  signups = [0, 1].map((index) => ({
    ...signup,
    id: `signup-${index}`,
    project_attendance_intervals: [
      {
        check_in_time: "2026-09-19T09:00:00Z",
        check_out_time: "2026-09-19T09:01:30Z",
      },
    ],
  }));
  expect((await report()).data?.metrics.pendingHours).toBe(0.1);
});

for (const intervals of [undefined, null, []]) {
  test(`legacy attendance retains its envelope fallback for ${JSON.stringify(intervals)}`, async () => {
    signups = [{ ...signup, project_attendance_intervals: intervals }];
    expect((await report()).data?.metrics.pendingHours).toBe(6);
  });
}

test("an incomplete reviewed interval never falls back to the six-hour envelope", async () => {
  signups = [
    {
      ...signup,
      project_attendance_intervals: [{ ...visits[0], check_out_time: null }],
    },
  ];
  expect((await report()).data?.metrics.pendingHours).toBe(0);
});

for (const type of ["verified", null]) {
  test(`published ${type} awards use canonical credit and never add pending signup hours`, async () => {
    certificates = [{ ...certificate, type }];
    const { data } = await report();
    expect(data?.metrics.verifiedHours).toBe(1.5);
    expect(data?.metrics.pendingHours).toBe(0);
    expect(data?.metrics.totalHours).toBe(1.5);
    expect(data?.volunteers[0].eventsAttended).toBe(1);
  });
}

test("historical awards preserve their original envelope rather than later reviewed attendance", async () => {
  certificates = [{ ...certificate, type: null, credited_minutes: null }];
  const { data } = await report();
  expect(data?.metrics.verifiedHours).toBe(6);
  expect(data?.metrics.pendingHours).toBe(0);
});

test("staff and sync report readers share the corrected pending calculation", async () => {
  role = "staff";
  expect((await report()).data?.metrics.pendingHours).toBe(2);
  expect(
    (await getOrganizationReportDataForSync("org-a", range)).data?.metrics
      .pendingHours,
  ).toBe(2);
});

test("missing authentication and unauthorized roles still prevent attendance reads", async () => {
  signedIn = false;
  expect(await report()).toEqual({ error: "Authentication required" });
  expect(calls).toEqual([]);
  signedIn = true;
  role = "member";
  expect(await report()).toEqual({ error: "Permission denied" });
  expect(calls.every((call) => call.table === "organization_members")).toBe(
    true,
  );
});

test("attendance query failures do not return partial aggregate totals", async () => {
  certificates = [certificate];
  attendanceFailure = true;
  expect(await report()).toEqual({ error: "Failed to load attendance hours" });
});

test("interval reads continue through provider row caps without treating missing pages as legacy attendance", async () => {
  pageCap = 1;
  expect((await report()).data?.metrics.pendingHours).toBe(2);
  expect(adminTables).toHaveLength(3);
});

test("interval loading chunks authorized signup IDs and retains all pages", async () => {
  signups = Array.from({ length: 201 }, (_, index) => ({
    ...signup,
    id: `signup-${index}`,
  }));
  pageCap = 75;
  const { data } = await report();
  expect(data?.metrics.pendingHours).toBe(402);
  const scopes = calls.filter(
    (call) =>
      call.table === "project_attendance_intervals" &&
      call.method === "in" &&
      call.args[0] === "signup_id",
  );
  expect(scopes.every((call) => (call.args[1] as string[]).length <= 200)).toBe(
    true,
  );
  expect(
    scopes.some((call) => JSON.stringify(call.args[1]) === '["signup-200"]'),
  ).toBe(true);
});

test("an interval read error fails the report instead of falling back to envelope hours", async () => {
  intervalFailure = true;
  expect(await report()).toEqual({ error: "Failed to generate report data" });
});

for (const status of ["inactive", "pending", "invited", null]) {
  test(`${status} admin membership cannot read privileged interval data`, async () => {
    membershipStatus = status;
    expect(await report()).toEqual({ error: "Permission denied" });
    expect(adminTables).toEqual([]);
    expect(calls.every((call) => call.table === "organization_members")).toBe(
      true,
    );
  });
}

test("revoked membership suppresses data loaded with the interval service client", async () => {
  revokeMembershipAfterRead = true;
  expect(await report()).toEqual({ error: "Permission denied" });
  expect(adminTables).toContain("project_attendance_intervals");
  expect(
    calls.filter(
      (call) =>
        call.table === "organization_members" && call.method === "select",
    ),
  ).toHaveLength(2);
});

test("a changed authenticated account cannot receive the prepared report", async () => {
  changeAccountAfterRead = true;
  expect(await report()).toEqual({ error: "Authentication required" });
  expect(authOptions).toEqual([{ sensitive: true }, { sensitive: true }]);
});

test("aggregate totals use unrounded participant hours before report presentation", async () => {
  signups = [0, 1, 2].map((index) => ({
    ...signup,
    id: `signup-${index}`,
    user_id: `volunteer-${index}`,
    project_attendance_intervals: [
      {
        check_in_time: "2026-09-19T09:00:00Z",
        check_out_time: "2026-09-19T09:01:00Z",
      },
    ],
  }));
  const { data } = await report();
  expect(data?.metrics.pendingHours).toBe(0.1);
  expect(data?.metrics.totalHours).toBe(0.1);
  expect(data?.projects[0].pendingHours).toBe(0.1);
  expect(data?.monthlyHours[0].pending).toBe(0.1);
  expect(data?.volunteers).toHaveLength(3);
  certificates = signups.map((row, index) => ({
    ...certificate,
    id: `certificate-${index}`,
    signup_id: row.id,
    user_id: row.user_id,
    credited_minutes: 1,
  }));
  const published = (await report()).data;
  expect(published?.metrics.verifiedHours).toBe(0.1);
  expect(published?.metrics.totalHours).toBe(0.1);
  expect(published?.metrics.pendingHours).toBe(0);
  expect(published?.projects[0].verifiedHours).toBe(0.1);
  expect(published?.monthlyHours[0].verified).toBe(0.1);
});
