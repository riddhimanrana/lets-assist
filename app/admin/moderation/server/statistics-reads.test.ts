import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthUser } from "@/lib/supabase/types";

type Response = {
  data: Array<Record<string, unknown>> | null;
  count: number | null;
  error: { code: string; message: string } | null;
};
let actor: AuthUser | null;
let requiresMfa = false;
let responses: Response[];
let throwAt: number | undefined;
const reads: string[] = [];
const authOptions: unknown[] = [];
const selections: Array<{
  table: string;
  columns: string;
  options?: Record<string, unknown>;
}> = [];
const privateError = {
  code: "XX000",
  message: "Synthetic private backend context",
};
const rows = (data: Response["data"] = []): Response => ({
  data,
  count: data?.length ?? null,
  error: null,
});
const count = (value = 0): Response => ({
  data: null,
  count: value,
  error: null,
});
const failed = (code = "XX000", message = privateError.message): Response => ({
  data: null,
  count: null,
  error: { code, message },
});

mock.module("@/lib/safe-console", () => ({
  safeConsole: { error() {}, warn() {}, info() {} },
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async (options: { checkMfa?: boolean }) => {
    authOptions.push(options);
    if (requiresMfa && options.checkMfa) {
      return { user: null, error: null, requiresMfa: true };
    }
    return { user: actor, error: null };
  },
}));
const { checkSuperAdmin } = await import("@/app/admin/server/auth");
mock.module("@/app/admin/actions", () => ({ checkSuperAdmin }));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("Statistics must not use a browser/session query fallback");
  },
}));
mock.module("@/services/admin-notifications", () => ({
  notifyAdminsBatched: async () => {
    throw new Error("Read must not notify");
  },
}));
mock.module("@/services/notifications-server", () => ({
  createNotificationForUser: async () => {
    throw new Error("Read must not notify");
  },
}));
mock.module("@/app/admin/moderation/server/notifications", () => ({
  notifyContentOwnerOfModeration: async () => {
    throw new Error("Read must not notify");
  },
  notifyReporterOfReportUpdate: async () => {
    throw new Error("Read must not notify");
  },
}));
mock.module("@/app/admin/moderation/server/enforcement", () => ({
  softRemoveContent: async () => {
    throw new Error("Read must not mutate");
  },
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      const index = reads.length;
      reads.push(table);
      const chain = {
        select: (columns: string, options?: Record<string, unknown>) => {
          selections.push({ table, columns, options });
          return chain;
        },
        in: () => chain,
        gte: () => chain,
        eq: () => chain,
        ilike: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        then(
          resolve: (result: Response) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          const result =
            index === throwAt
              ? Promise.reject(new Error(privateError.message))
              : Promise.resolve(
                  responses[index] ?? failed("UNEXPECTED", "Unexpected query"),
                );
          return result.then(resolve, reject);
        },
      };
      return chain;
    },
  }),
}));

const { getContentReportsStats } = await import("./reports");
const { getModerationStats } = await import("./queues");
const methods = [getContentReportsStats, getModerationStats];

function user(
  app_metadata: Record<string, unknown>,
  user_metadata: Record<string, unknown> = {},
): AuthUser {
  return {
    id: "fictional-actor",
    email: null,
    phone: null,
    role: "authenticated",
    app_metadata,
    user_metadata,
  };
}
const reportResponses = () => [
  count(4),
  rows([
    { status: "pending" },
    { status: "under_review" },
    { status: "resolved" },
    { status: "dismissed" },
  ]),
  count(2),
  count(1),
];
const legacyResponses = () => [
  count(),
  count(),
  rows(),
  rows(),
  count(),
  count(),
  count(),
  count(),
  count(),
  count(),
  count(),
  count(),
  count(),
  rows(),
  rows(),
];

beforeEach(() => {
  actor = user({ role: "super_admin" });
  requiresMfa = false;
  responses = [];
  throwAt = undefined;
  reads.length = 0;
  authOptions.length = 0;
  selections.length = 0;
});

function expectReadError(result: { error?: string; data?: unknown }) {
  expect(result.error).toBeString();
  expect(result.error).not.toContain(privateError.message);
  expect(result).not.toHaveProperty("data");
}

describe("statistics retain fresh super-admin authorization", () => {
  const cases = [
    ["anonymous", null],
    ["volunteer", user({ role: "member" })],
    ["trusted member", user({ role: "trusted_member" })],
    ["organization staff", user({ role: "staff" })],
    ["organization admin", user({ role: "admin" })],
    [
      "forged editable metadata",
      user({}, { role: "super_admin", is_super_admin: true }),
    ],
    ["string privilege flag", user({ is_super_admin: "true" })],
    ["demoted actor", user({ role: "member" }, { is_super_admin: true })],
  ] as const;
  for (const [label, value] of cases) {
    test(`${label} cannot query either statistics reader`, async () => {
      actor = value;
      for (const method of methods) {
        const result = await method();
        expect(result.error).toContain("Unauthorized");
        expect(result).not.toHaveProperty("data");
      }
      expect(reads).toEqual([]);
      expect(authOptions).toEqual([
        { sensitive: true, checkMfa: true },
        { sensitive: true, checkMfa: true },
      ]);
    });
  }
  test("the existing server-managed boolean privilege also permits a real empty read", async () => {
    actor = user({ is_super_admin: true });
    responses = [rows()];
    const result = await getModerationStats();
    expect(result.error).toBeUndefined();
    expect(result.data?.total).toBe(0);
    expect(reads).toEqual(["content_moderation_events"]);
  });
  test("a real super-admin still requiring MFA cannot query either reader", async () => {
    requiresMfa = true;
    for (const method of methods) {
      expect((await method()).error).toContain("Unauthorized");
    }
    expect(reads).toEqual([]);
    expect(authOptions).toEqual([
      { sensitive: true, checkMfa: true },
      { sensitive: true, checkMfa: true },
    ]);
  });
});

describe("content report statistics failures", () => {
  for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    test(`an invalid exact count (${value}) cannot become a snapshot`, async () => {
      responses = reportResponses();
      responses[0] = count(value);
      expectReadError(await getContentReportsStats());
      expect(reads.length).toBe(1);
    });
  }
  for (const exactCount of [null, 1001]) {
    test(`report statuses with missing/truncated exact count (${exactCount}) return an error`, async () => {
      responses = reportResponses();
      responses[1].count = exactCount;
      expectReadError(await getContentReportsStats());
      expect(selections[1]).toMatchObject({
        columns: "status",
        options: { count: "exact" },
      });
    });
  }
  for (const [index, label] of [
    "total",
    "statuses",
    "priority",
    "recent",
  ].entries()) {
    test(`${label} query error cannot become a partial or zero snapshot`, async () => {
      responses = reportResponses();
      responses[index] = failed();
      expectReadError(await getContentReportsStats());
    });
    test(`${label} missing result cannot masquerade as zero`, async () => {
      responses = reportResponses();
      responses[index] = { data: null, count: null, error: null };
      expectReadError(await getContentReportsStats());
    });
  }
  test("a rejected query returns a sanitized error", async () => {
    responses = reportResponses();
    throwAt = 2;
    expectReadError(await getContentReportsStats());
  });
  test("valid counts retain the existing status and historical priority semantics", async () => {
    responses = reportResponses();
    expect((await getContentReportsStats()).data).toEqual({
      total: 4,
      pending: 1,
      resolved: 1,
      highPriority: 2,
      recentWeek: 1,
    });
  });
  test("successful empty responses remain successful zero counts", async () => {
    responses = [count(), rows(), count(), count()];
    expect((await getContentReportsStats()).data).toEqual({
      total: 0,
      pending: 0,
      resolved: 0,
      highPriority: 0,
      recentWeek: 0,
    });
  });
});

describe("moderation view and compatible legacy reads", () => {
  for (const code of ["42501", "57014", "PGRST301", "ECONNRESET", "PGRST204"]) {
    test(`${code} does not trigger a legacy fallback`, async () => {
      responses = [
        failed(code, "Synthetic role does not exist"),
        ...legacyResponses(),
      ];
      expectReadError(await getModerationStats());
      expect(reads).toEqual(["content_moderation_events"]);
    });
  }
  test("missing view data with no error is unknown, not an empty queue", async () => {
    responses = [
      { data: null, count: null, error: null },
      ...legacyResponses(),
    ];
    expectReadError(await getModerationStats());
    expect(reads).toEqual(["content_moderation_events"]);
  });
  test("a rejected view read returns an error without legacy queries", async () => {
    responses = [rows()];
    throwAt = 0;
    expectReadError(await getModerationStats());
    expect(reads).toEqual(["content_moderation_events"]);
  });
  for (const code of ["42P01", "42703", "PGRST205"]) {
    test(`${code} still supports a fully successful legacy empty read`, async () => {
      responses = [failed(code), ...legacyResponses()];
      const result = await getModerationStats();
      expect(result.error).toBeUndefined();
      expect(result.data?.total).toBe(0);
      expect(reads.length).toBe(16);
    });
  }
  for (const exactCount of [null, 1001]) {
    test(`moderation view with missing/truncated exact count (${exactCount}) does not fall back`, async () => {
      const result = rows(
        Array.from({ length: 1000 }, () => ({
          source: "flag",
          status: "pending",
        })),
      );
      result.count = exactCount;
      responses = [result, ...legacyResponses()];
      expectReadError(await getModerationStats());
      expect(reads).toEqual(["content_moderation_events"]);
      expect(selections[0].options).toEqual({ count: "exact" });
    });
  }
  for (const index of [3, 4]) {
    for (const exactCount of [null, 1001]) {
      test(`legacy status read ${index} with missing/truncated exact count (${exactCount}) returns an error`, async () => {
        responses = [failed("42P01"), ...legacyResponses()];
        responses[index].count = exactCount;
        expectReadError(await getModerationStats());
        expect(selections[index]).toMatchObject({
          columns: "status",
          options: { count: "exact" },
        });
      });
    }
  }
  for (let index = 0; index < 15; index += 1) {
    test(`legacy query ${index + 1} failure blocks the entire snapshot`, async () => {
      responses = [failed("42P01"), ...legacyResponses()];
      responses[index + 1] = failed();
      expectReadError(await getModerationStats());
    });
  }
  test("a complete legacy snapshot retains nonzero counts and status semantics", async () => {
    responses = [
      failed("42P01"),
      count(5),
      count(4),
      rows([
        { status: "pending" },
        { status: "pending" },
        { status: "blocked" },
        { status: "confirmed" },
        { status: "dismissed" },
      ]),
      rows([
        { status: "pending" },
        { status: "under_review" },
        { status: "resolved" },
        { status: "dismissed" },
      ]),
      count(2),
      count(2),
      count(3),
      count(1),
      count(1),
      count(2),
      count(1),
      count(4),
      count(3),
      rows([{ created_at: "2026-10-11T12:00:00Z" }]),
      rows([{ updated_at: "2026-10-11T13:00:00Z" }]),
    ];
    const result = await getModerationStats();
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      total: 9,
      pending: 3,
      pendingFlags: 2,
      pendingReports: 1,
      resolved: 5,
      critical: 4,
      recentWeek: 4,
      blocked: 1,
      aiApproved: 1,
      automationLast24h: 3,
      automationTotal: 7,
      lastAutomationAt: "2026-10-11T13:00:00.000Z",
    });
    expect(reads.length).toBe(16);
  });
  for (const index of [1, 3, 14]) {
    test(`legacy missing count/rows at ${index} is not fabricated as zero`, async () => {
      responses = [failed("42P01"), ...legacyResponses()];
      responses[index] = { data: null, count: null, error: null };
      expectReadError(await getModerationStats());
    });
  }
  test("one rejected legacy query returns a sanitized read error", async () => {
    responses = [failed("42P01"), ...legacyResponses()];
    throwAt = 7;
    expectReadError(await getModerationStats());
  });
  test("view success retains report and flag counts without alternate queries", async () => {
    responses = [
      rows([
        { source: "flag", status: "pending" },
        { source: "report", status: "under_review" },
        { source: "report", status: "resolved" },
      ]),
    ];
    const result = await getModerationStats();
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      total: 3,
      pending: 1,
      pendingFlags: 1,
      pendingReports: 0,
      resolved: 1,
    });
    expect(reads).toEqual(["content_moderation_events"]);
  });
});
