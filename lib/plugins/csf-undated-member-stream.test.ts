import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type Row = Record<string, unknown>;
const tables = new Map<string, Row[]>();

const CURSOR_OR =
  /^published_at\.lt\.([^,]+),and\(published_at\.eq\.[^,]+,id\.lt\.([^)]+)\)$/u;

function builder(table: string) {
  const eqFilters: Row = {};
  const inFilters: Array<{ column: string; values: unknown[] }> = [];
  const notNullColumns: string[] = [];
  let cursor: { publishedAt: string; id: string } | null = null;
  const orderings: Array<{ column: string; ascending: boolean }> = [];
  let limitCount: number | null = null;

  function rows(): Row[] {
    let result = (tables.get(table) ?? []).filter((row) => {
      for (const [key, value] of Object.entries(eqFilters)) {
        if (row[key] !== value) return false;
      }
      for (const { column, values } of inFilters) {
        if (!values.includes(row[column])) return false;
      }
      for (const column of notNullColumns) {
        if (row[column] === null || row[column] === undefined) return false;
      }
      if (cursor) {
        const publishedAt = String(row.published_at ?? "");
        const id = String(row.id ?? "");
        const past =
          publishedAt < cursor.publishedAt ||
          (publishedAt === cursor.publishedAt && id < cursor.id);
        if (!past) return false;
      }
      return true;
    });
    if (orderings.length > 0) {
      result = [...result].sort((left, right) => {
        for (const { column, ascending } of orderings) {
          const a = String(left[column] ?? "");
          const b = String(right[column] ?? "");
          if (a !== b) return ascending === a < b ? -1 : 1;
        }
        return 0;
      });
    }
    if (limitCount !== null) result = result.slice(0, limitCount);
    return result;
  }

  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => {
      eqFilters[key] = value;
      return chain;
    },
    in: (column: string, values: unknown[]) => {
      inFilters.push({ column, values });
      return chain;
    },
    not: (column: string, operator: string, value: unknown) => {
      if (operator === "is" && value === null) notNullColumns.push(column);
      return chain;
    },
    is: () => chain,
    or: (expression: string) => {
      const match = CURSOR_OR.exec(expression);
      if (match) {
        cursor = { publishedAt: match[1] ?? "", id: match[2] ?? "" };
      }
      return chain;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orderings.push({ column, ascending: options?.ascending !== false });
      return chain;
    },
    limit: (count: number) => {
      limitCount = count;
      return chain;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
  };
  return chain;
}

mock.module("@/lib/plugins/supabase", () => ({
  createPluginAdminClient: () => ({
    from: builder,
    rpc: async () => ({ data: {}, error: null }),
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: builder }),
}));

const { listCsfMemberStream } =
  await import("@/lib/plugins/private/plugins/dvhs-csf/services/stream");
const { buildCsfAgendaItemsFromSnapshot } =
  await import("@/lib/plugins/private/plugins/dvhs-csf/services/upcoming-activities");
const org = "74000000-0000-4000-8000-000000000001";
const user = "74000000-0000-4000-8000-000000000002";
const id = "74000000-0000-4000-8000-000000000003";

test("published undated activity remains in Member Home feed, without an invented calendar date", async () => {
  tables.set("csf_announcements", []);
  const row = {
    id,
    organization_id: org,
    title: "Fictional undated activity",
    body: "A signup activity without a schedule",
    status: "published",
    published_at: "2026-09-13T06:00:00Z",
    starts_at: null,
    point_value: 1,
    point_type: "non_drive",
    signup_mode: "none",
    cohort_id: null,
    created_by_user_id: null,
    signup_url: null,
    linked_project_id: null,
  };
  tables.set("csf_opportunities", [row]);
  const page = await listCsfMemberStream({
    organizationId: org,
    userId: user,
    viewerContext: { profileId: user, cohortId: null, cohortLabel: null },
  });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({
    kind: "activity",
    id,
    title: row.title,
    startsAt: null,
    pointValue: 1,
  });
  expect(
    buildCsfAgendaItemsFromSnapshot(
      { activities: [row], meetingSessions: [], deadlines: [] },
      new Date("2026-09-13T06:00:00Z"),
    ),
  ).toEqual([]);
  const unlinked = await listCsfMemberStream({
    organizationId: org,
    userId: user,
    viewerContext: null,
  });
  expect(unlinked.items).toEqual([]);
});
