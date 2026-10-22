import { beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { error: () => undefined },
}));
const organizationId = "a9112000-0000-4000-8000-000000000001";
const projectId = "a9112100-0000-4000-8000-000000000001";
type SourceRow = Record<string, unknown> & { id: string };
let tables: Record<string, SourceRow[]> = {};
let requests: Array<{
  table: string;
  limit: number;
  after: string | null;
  ids: string[] | null;
  signupIds?: string[] | null;
}> = [];
type SourceAnswer = { data: SourceRow[]; count: number | null; error: unknown };
// Runs before a request is answered, with how many requests that table has had. It may change the tables.
let beforeRequest: (table: string, tableRequests: number) => void = () =>
  undefined;
// May replace what one request answers.
let intercept: (
  table: string,
  answer: SourceAnswer,
  tableRequests: number,
) => SourceAnswer = (_table, answer) => answer;
const id = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
function query(table: string) {
  let limit = 1000;
  let after: string | null = null;
  let head = false;
  let ids: string[] | null = null;
  let signupIds: string[] | null = null;
  const filters: Array<(row: SourceRow) => boolean> = [];
  const builder = {
    select(_columns: string, options?: { head?: boolean }) {
      head = Boolean(options?.head);
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return builder;
    },
    in(column: string, value: string[]) {
      if (column === "project_id") ids = value;
      if (column === "signup_id") signupIds = value;
      filters.push((row) => value.includes(String(row[column])));
      return builder;
    },
    not(column: string, _operator: string, value: unknown) {
      filters.push((row) => row[column] !== value);
      return builder;
    },
    gte(column: string, value: string) {
      filters.push((row) => String(row[column]) >= value);
      return builder;
    },
    lte(column: string, value: string) {
      filters.push((row) => String(row[column]) <= value);
      return builder;
    },
    gt(column: string, value: string) {
      if (column === "id") after = value;
      filters.push((row) => String(row[column]) > value);
      return builder;
    },
    order() {
      return builder;
    },
    limit(value: number) {
      limit = value;
      return builder;
    },
    then(resolve: (value: SourceAnswer) => unknown) {
      requests.push({ table, limit, after, ids, signupIds });
      const tableRequests = requests.filter(
        (row) => row.table === table,
      ).length;
      beforeRequest(table, tableRequests);
      const selected = (tables[table] ?? [])
        .filter((row) => filters.every((f) => f(row)))
        .sort((a, b) => a.id.localeCompare(b.id));
      return Promise.resolve(
        intercept(
          table,
          {
            data: head ? [] : selected.slice(0, limit),
            count: selected.length,
            error: null,
          },
          tableRequests,
        ),
      ).then(resolve);
    },
  };
  return builder;
}
const client = { from: query };
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => client }));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: "fictional-admin" } }),
}));
const { getOrganizationReportDataForSync } = await import("../report-service");
const range = { from: "2026-09-01", to: "2026-09-30" };
beforeEach(() => {
  requests = [];
  beforeRequest = () => undefined;
  intercept = (_table, answer) => answer;
  tables = {
    projects: [
      {
        id: projectId,
        organization_id: organizationId,
        title: "Fictional project",
        status: "completed",
        workflow_status: "published",
      },
    ],
    certificates: [],
    project_signups: [],
    project_attendance_intervals: [],
  };
});
test("report includes the 1001st project beyond the API response cap", async () => {
  tables.projects = Array.from({ length: 1001 }, (_, index) => ({
    id: id("a9112100", index),
    organization_id: organizationId,
    title: `Fictional project ${index + 1}`,
    status: "completed",
    workflow_status: "published",
  }));
  tables.projects.push({
    id: id("a9112200", 0),
    organization_id: "other-fictional-organization",
    title: "Foreign project",
    status: "completed",
  });
  const result = await getOrganizationReportDataForSync(organizationId, range);
  expect(result.error).toBeUndefined();
  expect(result.data?.metrics.totalProjects).toBe(1001);
  expect(
    result.data?.projects.some((row) => row.title === "Fictional project 1001"),
  ).toBe(true);
  expect(
    result.data?.projects.some((row) => row.title === "Foreign project"),
  ).toBe(false);
});
test("report includes the 1001st certificate and its hours without a huge project-ID URL", async () => {
  tables.certificates = Array.from({ length: 1001 }, (_, index) => ({
    id: id("a9112300", index),
    project_id: projectId,
    user_id: id("a9112400", index),
    volunteer_name: `Fictional volunteer ${index + 1}`,
    volunteer_email: `fixture-${index + 1}@example.test`,
    is_certified: true,
    type: "verified",
    issued_at: "2026-09-19T16:00:00Z",
    credited_minutes: 60,
    signup_id: null,
  }));
  const result = await getOrganizationReportDataForSync(organizationId, range);
  expect(result.error).toBeUndefined();
  expect(result.data?.metrics.totalVolunteers).toBe(1001);
  expect(result.data?.metrics.verifiedHours).toBe(1001);
  expect(
    result.data?.volunteers.some(
      (row) => row.email === "fixture-1001@example.test",
    ),
  ).toBe(true);
  expect(
    requests.filter((row) => row.ids).every((row) => row.ids!.length <= 200),
  ).toBe(true);
});

const TOO_LARGE =
  "This organization has more records than one report can load.";
const project = (index: number): SourceRow => ({
  id: id("a9112100", index),
  organization_id: organizationId,
  title: `Fictional project ${index + 1}`,
  status: "completed",
  workflow_status: "published",
});
const certificate = (index: number, project_id = projectId): SourceRow => ({
  id: id("a9112300", index),
  project_id,
  user_id: id("a9112400", index),
  volunteer_name: `Fictional volunteer ${index + 1}`,
  volunteer_email: `fixture-${index + 1}@example.test`,
  is_certified: true,
  type: "verified",
  issued_at: "2026-09-19T16:00:00Z",
  credited_minutes: 60,
  signup_id: null,
});
// An hour-long attendance envelope with no certificate.
const attended = (index: number, project_id = projectId): SourceRow => ({
  id: id("a9112500", index),
  project_id,
  user_id: id("a9112400", index),
  anonymous_id: null,
  check_in_time: "2026-09-19T09:00:00Z",
  check_out_time: "2026-09-19T10:00:00Z",
  profiles: {
    id: id("a9112400", index),
    full_name: `Fictional volunteer ${index + 1}`,
    email: `fixture-${index + 1}@example.test`,
  },
});
// The reviewed visit for that signup: half an hour, not the whole envelope.
const visit = (index: number, project_id = projectId): SourceRow => ({
  id: id("a9112600", index),
  project_id,
  signup_id: id("a9112500", index),
  check_in_time: "2026-09-19T09:00:00Z",
  check_out_time: "2026-09-19T09:30:00Z",
});
const many = (count: number, build: (index: number) => SourceRow) =>
  Array.from({ length: count }, (_, index) => build(index));
const load = () => getOrganizationReportDataForSync(organizationId, range);

test("report includes the 1001st attended signup and every reviewed interval", async () => {
  tables.project_signups = many(1001, (index) => attended(index));
  tables.project_attendance_intervals = many(1001, (index) => visit(index));

  const result = await load();
  expect(result.error).toBeUndefined();
  expect(result.data?.metrics.totalVolunteers).toBe(1001);
  // 1001 reviewed half hours. A dropped interval page would count an
  // envelope hour instead, and a dropped signup page would count nothing.
  expect(result.data?.metrics.pendingHours).toBe(500.5);
  expect(
    result.data?.volunteers.some(
      (row) => row.email === "fixture-1001@example.test",
    ),
  ).toBe(true);

  const intervalRequests = requests.filter(
    (row) => row.table === "project_attendance_intervals",
  );
  expect(intervalRequests.length).toBeGreaterThan(0);
  for (const request of intervalRequests) {
    expect(request.signupIds!.length).toBeLessThanOrEqual(200);
    expect(request.ids).toEqual([projectId]);
    expect(request.limit).toBeLessThanOrEqual(500);
  }
  expect(new Set(intervalRequests.flatMap((row) => row.signupIds!)).size).toBe(
    1001,
  );
});

test("every source request is a bounded keyset page", async () => {
  tables.certificates = many(1001, (index) => certificate(index));
  tables.project_signups = many(1001, (index) => attended(index + 2000));

  expect((await load()).error).toBeUndefined();
  for (const table of ["projects", "certificates", "project_signups"]) {
    const pages = requests.filter((row) => row.table === table);
    expect(pages.every((row) => row.limit <= 500)).toBe(true);
    // The first page has no cursor. Each later one continues after an id.
    expect(pages[0].after).toBeNull();
  }
  const certificatePages = requests.filter(
    (row) => row.table === "certificates",
  );
  expect(certificatePages.map((row) => row.after)).toEqual([
    null,
    id("a9112300", 499),
    id("a9112300", 999),
  ]);
});

test("more than 200 projects are read in chunks, and another organization's records never enter", async () => {
  const last = id("a9112100", 400);
  const foreign = id("a9112200", 0);
  tables.projects = [
    ...many(401, project),
    {
      id: foreign,
      organization_id: "other-fictional-organization",
      title: "Foreign project",
      status: "completed",
      workflow_status: "published",
    },
  ];
  tables.certificates = [
    certificate(0, last),
    { ...certificate(1, foreign), volunteer_email: "foreign@example.test" },
  ];
  tables.project_signups = [attended(2, last), attended(3, foreign)];
  tables.project_attendance_intervals = [visit(2, last), visit(3, foreign)];

  const result = await load();
  expect(result.error).toBeUndefined();
  expect(result.data?.metrics.totalProjects).toBe(401);
  expect(result.data?.volunteers.map((row) => row.email).sort()).toEqual([
    "fixture-1@example.test",
    "fixture-3@example.test",
  ]);
  expect(result.data?.metrics.verifiedHours).toBe(1);
  expect(result.data?.metrics.pendingHours).toBe(0.5);

  const scoped = requests.filter((row) => row.ids);
  expect(scoped.every((row) => row.ids!.length <= 200)).toBe(true);
  expect(scoped.some((row) => row.ids!.includes(foreign))).toBe(false);
  expect(
    requests
      .filter((row) => row.table === "certificates")
      .map((row) => row.ids!.length),
  ).toEqual([200, 200, 1]);
  // The interval read names only the one project its signup belongs to.
  expect(
    requests
      .filter((row) => row.table === "project_attendance_intervals")
      .every((row) => row.ids!.length === 1 && row.ids![0] === last),
  ).toBe(true);
});

const sources = [
  ["certificates", "Failed to load certificate hours"],
  ["project_signups", "Failed to load attendance hours"],
] as const;
const fill = (table: string, count: number) => {
  tables[table] = many(count, (index) =>
    table === "certificates" ? certificate(index) : attended(index),
  );
};

test.each(sources)(
  "a %s row inserted while its pages are read fails the report",
  async (table, message) => {
    fill(table, 1001);
    beforeRequest = (requested, tableRequests) => {
      if (requested === table && tableRequests === 2)
        tables[table].push(
          table === "certificates" ? certificate(5000) : attended(5000),
        );
    };

    expect(await load()).toEqual({ error: message });
  },
);

test.each(sources)(
  "a %s row deleted while its pages are read fails the report",
  async (table, message) => {
    fill(table, 1001);
    beforeRequest = (requested, tableRequests) => {
      if (requested === table && tableRequests === 2) tables[table].pop();
    };

    expect(await load()).toEqual({ error: message });
  },
);

test.each([["projects", "Failed to load projects"], ...sources] as const)(
  "a %s page that arrives out of order fails the report",
  async (table, message) => {
    if (table === "projects") tables.projects = many(3, project);
    else fill(table, 3);
    intercept = (requested, answer) =>
      requested === table
        ? { ...answer, data: [...answer.data].reverse() }
        : answer;

    expect(await load()).toEqual({ error: message });
  },
);

test.each([["projects", "Failed to load projects"], ...sources] as const)(
  "a %s count the API could not give fails the report",
  async (table, message) => {
    intercept = (requested, answer) =>
      requested === table ? { ...answer, count: null } : answer;

    expect(await load()).toEqual({ error: message });
  },
);

test("a report source error is not returned as a shorter report", async () => {
  tables.certificates = many(1001, (index) => certificate(index));
  // The third page fails after two pages were read.
  intercept = (requested, answer, tableRequests) =>
    requested === "certificates" && tableRequests === 3
      ? { data: [], count: null, error: { message: "private database detail" } }
      : answer;

  const result = await load();
  expect(result).toEqual({ error: "Failed to load certificate hours" });
  expect(JSON.stringify(result)).not.toContain("private");
});

test("more than 10,000 projects is refused from the count, before anything else is read", async () => {
  tables.projects = many(10_001, project);

  expect(await load()).toEqual({ error: TOO_LARGE });
  expect(requests.map((row) => row.table)).toEqual(["projects"]);
});

test("certificates and attended signups share one bound of 100,000 records", async () => {
  // The API counts 100,000 attended signups. The page itself is not served.
  intercept = (requested, answer) =>
    requested === "project_signups"
      ? { ...answer, data: [], count: 100_000 }
      : answer;

  // With no certificates, 100,000 is inside the bound. The read then fails
  // for the rows it did not receive, not for its size.
  expect(await load()).toEqual({ error: "Failed to load attendance hours" });

  // One certificate leaves room for 99,999.
  tables.certificates = [certificate(0)];
  expect(await load()).toEqual({ error: TOO_LARGE });

  intercept = (requested, answer) =>
    requested === "certificates"
      ? { ...answer, data: [], count: 100_001 }
      : answer;
  expect(await load()).toEqual({ error: TOO_LARGE });
});
