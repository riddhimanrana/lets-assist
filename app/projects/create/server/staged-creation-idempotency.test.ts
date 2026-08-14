import { beforeEach, describe, expect, mock, test } from "bun:test";

type Op = { method: string; args: unknown[] };
type TableCall = { table: string; ops: Op[] };

const tableCalls: TableCall[] = [];
const ACTOR = { id: "88888888-8888-4888-8888-888888888888" };
const ATTEMPT_KEY = "99999999-9999-4999-8999-999999999999";
const EXISTING_PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Rows returned for successive "does this attempt already exist?" lookups. */
let attemptLookups: (Record<string, unknown> | null)[] = [];
let attemptLookupCount = 0;
/** Error the projects insert reports, if any. */
let insertError: unknown = null;

function nextAttemptLookup(): Record<string, unknown> | null {
  const row = attemptLookups[attemptLookupCount] ?? null;
  attemptLookupCount += 1;
  return row;
}

const CHAINABLE = ["select", "insert", "update", "delete", "eq", "or", "gte"];

function opValue(ops: Op[], method: string): unknown[] | undefined {
  return ops.find((op) => op.method === method)?.args;
}

function makeClient() {
  const from = (table: string) => {
    const ops: Op[] = [];
    const builder: Record<string, unknown> = {
      count: null,
    };

    for (const method of CHAINABLE) {
      builder[method] = (...args: unknown[]) => {
        ops.push({ method, args });
        return builder;
      };
    }

    const settle = () => {
      tableCalls.push({ table, ops });

      if (table === "profiles") {
        return { data: { trusted_member: true }, error: null };
      }

      if (table === "projects") {
        const isInsert = ops.some((op) => op.method === "insert");

        if (isInsert) {
          return insertError
            ? { data: null, error: insertError }
            : { data: { id: NEW_PROJECT_ID }, error: null };
        }

        // The rate-limit head count and the attempt lookup share this table.
        const filtersOnAttemptKey = ops.some(
          (op) =>
            op.method === "eq" && op.args[0] === "creation_idempotency_key",
        );

        if (filtersOnAttemptKey) {
          return { data: nextAttemptLookup(), error: null };
        }

        return { data: [], error: null, count: 0 };
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => settle();
    builder.single = async () => settle();
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(settle()).then(onFulfilled, onRejected);

    return builder;
  };

  return {
    from,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async () => ({ data: { user: ACTOR }, error: null }),
    },
  };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => makeClient(),
}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: () => null,
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runProjectCreate: async () => {},
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));

const { createBasicProject } = await import("./create");

function waiverProject(overrides: Record<string, unknown> = {}) {
  return {
    basicInfo: {
      title: "Beach cleanup",
      location: "Local",
      description: "<p>Bring gloves.</p>",
      organizationId: undefined,
      projectTimezone: "America/Los_Angeles",
    },
    eventType: "oneTime",
    schedule: {
      oneTime: {
        date: "2099-06-01",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 5,
      },
    },
    verificationMethod: "manual",
    requireLogin: true,
    visibility: "unlisted",
    waiverRequired: true,
    waiverAllowUpload: true,
    waiverDisableEsignature: false,
    waiverPdfFile: {},
    ...overrides,
  } as never;
}

function projectInsertPayloads() {
  return tableCalls
    .filter((call) => call.table === "projects")
    .map((call) => opValue(call.ops, "insert"))
    .filter((args): args is unknown[] => Array.isArray(args))
    .map((args) => args[0] as Record<string, unknown>);
}

beforeEach(() => {
  tableCalls.length = 0;
  attemptLookups = [];
  attemptLookupCount = 0;
  insertError = null;
});

describe("staged waiver project creation is retry safe", () => {
  test("a first attempt stages the project unpublished and stores its key", async () => {
    const result = await createBasicProject(
      waiverProject({ creationIdempotencyKey: ATTEMPT_KEY }),
    );

    expect(result).toMatchObject({
      success: true,
      id: NEW_PROJECT_ID,
      requiresWaiverPublication: true,
    });

    const payloads = projectInsertPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      workflow_status: "draft",
      waiver_required: true,
      creation_idempotency_key: ATTEMPT_KEY,
    });
  });

  test("a replayed attempt resolves to the same row instead of inserting", async () => {
    attemptLookups = [
      {
        id: EXISTING_PROJECT_ID,
        workflow_status: "draft",
        waiver_required: true,
      },
    ];

    const result = await createBasicProject(
      waiverProject({ creationIdempotencyKey: ATTEMPT_KEY }),
    );

    expect(result).toEqual({
      success: true,
      id: EXISTING_PROJECT_ID,
      reusedExistingAttempt: true,
      requiresWaiverPublication: true,
    });
    expect(projectInsertPayloads()).toHaveLength(0);
  });

  test("a replay after publication does not ask the client to publish again", async () => {
    attemptLookups = [
      {
        id: EXISTING_PROJECT_ID,
        workflow_status: "published",
        waiver_required: true,
      },
    ];

    const result = await createBasicProject(
      waiverProject({ creationIdempotencyKey: ATTEMPT_KEY }),
    );

    expect(result).toEqual({
      success: true,
      id: EXISTING_PROJECT_ID,
      reusedExistingAttempt: true,
    });
  });

  test("two concurrent submits converge on the winner's row", async () => {
    // This submit loses the race: its lookup misses, the unique index rejects
    // its insert, and the post-conflict lookup finds the winner's row.
    attemptLookups = [
      null,
      {
        id: EXISTING_PROJECT_ID,
        workflow_status: "draft",
        waiver_required: true,
      },
    ];
    insertError = { code: "23505", message: "duplicate key value" };

    const result = await createBasicProject(
      waiverProject({ creationIdempotencyKey: ATTEMPT_KEY }),
    );

    expect(result).toEqual({
      success: true,
      id: EXISTING_PROJECT_ID,
      reusedExistingAttempt: true,
      requiresWaiverPublication: true,
    });
  });

  test("a genuine insert failure is still reported, not silently reused", async () => {
    attemptLookups = [null, null];
    insertError = { code: "23503", message: "foreign key violation" };

    const result = await createBasicProject(
      waiverProject({ creationIdempotencyKey: ATTEMPT_KEY }),
    );

    expect(result).toEqual({
      error: "Failed to create project. Please try again.",
    });
  });

  test("an unsignable waiver never reaches the database", async () => {
    const result = await createBasicProject(
      waiverProject({
        creationIdempotencyKey: ATTEMPT_KEY,
        waiverAllowUpload: false,
        waiverDisableEsignature: true,
      }),
    );

    expect(result.error).toMatch(/e-signatures/u);
    expect(projectInsertPayloads()).toHaveLength(0);
  });

  test("a waiver project with no PDF never reaches the database", async () => {
    const result = await createBasicProject(
      waiverProject({
        creationIdempotencyKey: ATTEMPT_KEY,
        waiverPdfFile: undefined,
      }),
    );

    expect(result.error).toMatch(/waiver PDF is required/u);
    expect(projectInsertPayloads()).toHaveLength(0);
  });
});
