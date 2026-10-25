import { beforeEach, describe, expect, mock, test } from "bun:test";

type Op = { method: string; args: unknown[] };
type Row = Record<string, unknown>;

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const STAGED_PROJECT_ID = "44444444-4444-4444-8444-444444444444";

/** The two tables publishing touches, with the creator-scoped unique key. */
let drafts: Row[] = [];
let projects: Row[] = [];
let currentUserId = OWNER_ID;
let projectSequence = 0;

let attemptLookupFailures = 0;
let draftReadFailures = 0;
let draftDeleteFailures = 0;
let insertFailure: { code: string; message: string } | null = null;
let draftDeletes = 0;
let uniqueConflicts = 0;
let pendingInserts = 0;
let insertGate: Promise<void> | null = null;
let beforeDraftRead: (() => void) | null = null;
let beforeInsert: (() => void) | null = null;
const attemptLookupFilters: unknown[][][] = [];

const CHAINABLE = ["select", "insert", "update", "delete", "eq", "gte"];

function matches(row: Row, ops: Op[]) {
  return ops
    .filter((op) => op.method === "eq")
    .every((op) => row[op.args[0] as string] === op.args[1]);
}

function makeClient() {
  const from = (table: string) => {
    const ops: Op[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of CHAINABLE) {
      builder[method] = (...args: unknown[]) => {
        ops.push({ method, args });
        return builder;
      };
    }
    const has = (method: string) => ops.some((op) => op.method === method);

    const settle = async () => {
      if (table === "project_drafts") {
        if (has("delete")) {
          draftDeletes += 1;
          if (draftDeleteFailures > 0) {
            draftDeleteFailures -= 1;
            return { error: { code: "08006", message: "synthetic outage" } };
          }
          drafts = drafts.filter((row) => !matches(row, ops));
          return { error: null };
        }
        beforeDraftRead?.();
        if (draftReadFailures > 0) {
          draftReadFailures -= 1;
          return { data: null, error: { code: "08006", message: "outage" } };
        }
        return {
          data: drafts.find((row) => matches(row, ops)) ?? null,
          error: null,
        };
      }

      if (table !== "projects") throw new Error(`Unexpected table ${table}`);

      if (has("insert")) {
        pendingInserts += 1;
        if (insertGate) await insertGate;
        beforeInsert?.();
        if (insertFailure) return { data: null, error: insertFailure };
        const payload = ops.find((op) => op.method === "insert")!
          .args[0] as Row;
        const duplicate = projects.some(
          (row) =>
            row.creator_id === payload.creator_id &&
            row.creation_idempotency_key === payload.creation_idempotency_key,
        );
        if (duplicate) {
          uniqueConflicts += 1;
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        projectSequence += 1;
        const id = `55555555-5555-4555-8555-${String(projectSequence).padStart(12, "0")}`;
        projects.push({ ...payload, id });
        return { data: { id }, error: null };
      }

      if (has("update")) {
        const payload = ops.find((op) => op.method === "update")!
          .args[0] as Row;
        const row = projects.find((candidate) => matches(candidate, ops));
        if (row) Object.assign(row, payload);
        return { data: row ? { id: row.id } : null, error: null };
      }

      if (has("gte")) return { data: null, error: null, count: 0 };

      attemptLookupFilters.push(
        ops.filter((op) => op.method === "eq").map((op) => op.args),
      );
      if (attemptLookupFailures > 0) {
        attemptLookupFailures -= 1;
        return { data: null, error: { code: "08006", message: "outage" } };
      }
      return {
        data: projects.find((row) => matches(row, ops)) ?? null,
        error: null,
      };
    };

    builder.maybeSingle = () => settle();
    builder.single = () => settle();
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => settle().then(onFulfilled, onRejected);
    return builder;
  };

  return {
    from,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async () => ({
        data: { user: { id: currentUserId } },
        error: null,
      }),
    },
  };
}

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("Unexpected service client");
  },
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

// The real create action runs behind publishDraft, so these tests exercise the
// stable key against a modeled unique-key conflict rather than a stubbed
// result. They do not prove database concurrency.
const { publishDraft } = await import("./drafts");

function completeDraft(overrides: Record<string, unknown> = {}) {
  return {
    step: 3,
    eventType: "oneTime",
    basicInfo: {
      title: "Beach cleanup",
      location: "Local beach",
      description: "<p>Bring gloves.</p>",
      organizationId: null,
      projectTimezone: "America/Los_Angeles",
    },
    schedule: {
      oneTime: {
        date: "2099-06-01",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 5,
      },
      multiDay: [{ date: "", slots: [] }],
      sameDayMultiArea: {
        date: "",
        overallStart: "09:00",
        overallEnd: "17:00",
        roles: [],
      },
    },
    verificationMethod: "qr-code",
    requireLogin: true,
    visibility: "unlisted",
    waiverRequired: false,
    waiverPdfFile: null,
    waiverPdfUrl: null,
    recurrence: {
      enabled: false,
      frequency: "weekly",
      interval: 1,
      endType: "never",
      weekdays: [],
    },
    pluginData: {},
    ...overrides,
  };
}

function saveDraft(overrides: Record<string, unknown> = {}) {
  drafts = [
    { id: DRAFT_ID, user_id: OWNER_ID, draft_data: completeDraft(overrides) },
  ];
}

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function until(condition: () => boolean) {
  for (let turn = 0; turn < 200 && !condition(); turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(condition()).toBe(true);
}

beforeEach(() => {
  saveDraft();
  projects = [];
  currentUserId = OWNER_ID;
  projectSequence = 0;
  attemptLookupFailures = 0;
  draftReadFailures = 0;
  draftDeleteFailures = 0;
  insertFailure = null;
  draftDeletes = 0;
  uniqueConflicts = 0;
  pendingInserts = 0;
  insertGate = null;
  beforeDraftRead = null;
  beforeInsert = null;
  attemptLookupFilters.length = 0;
});

describe("publishing a saved draft", () => {
  test("a complete draft is created under its own id as the attempt key and then removed", async () => {
    const result = await publishDraft(DRAFT_ID);

    expect(result).toEqual({ success: true, id: projects[0].id as string });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      creator_id: OWNER_ID,
      creation_idempotency_key: DRAFT_ID,
      workflow_status: "published",
    });
    expect(drafts).toHaveLength(0);
  });

  test("a differently cased draft id resolves to the same attempt key", async () => {
    const result = await publishDraft(` ${DRAFT_ID.toUpperCase()} `);

    expect(result).toMatchObject({ success: true });
    expect(projects[0].creation_idempotency_key).toBe(DRAFT_ID);
    expect(drafts).toHaveLength(0);
  });

  const incomplete: Array<{
    name: string;
    overrides: Record<string, unknown>;
    error: string;
  }> = [
    {
      name: "no location",
      overrides: {
        basicInfo: {
          title: "Beach cleanup",
          location: "",
          description: "<p>Bring gloves.</p>",
          organizationId: null,
        },
      },
      error: "Location is required",
    },
    {
      name: "an empty description",
      overrides: {
        basicInfo: {
          title: "Beach cleanup",
          location: "Local beach",
          description: "<p></p>",
          organizationId: null,
        },
      },
      error: "Description is required",
    },
    {
      name: "no date yet",
      overrides: {
        schedule: {
          oneTime: {
            date: "",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 0,
          },
        },
      },
      error: "Date is required",
    },
    {
      name: "a date that has passed",
      overrides: {
        schedule: {
          oneTime: {
            date: "2020-06-01",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 5,
          },
        },
      },
      error: "Start time must be in the future",
    },
    {
      name: "no schedule at all",
      overrides: { schedule: {} },
      error: "Add a date and time for this project.",
    },
  ];

  for (const { name, overrides, error } of incomplete) {
    test(`a draft with ${name} says so and creates nothing`, async () => {
      saveDraft(overrides);

      expect(await publishDraft(DRAFT_ID)).toEqual({ error });
      expect(projects).toHaveLength(0);
      expect(drafts).toHaveLength(1);
      expect(draftDeletes).toBe(0);
    });
  }

  test("a waiver draft is sent back to the create flow and kept", async () => {
    saveDraft({ waiverRequired: true, waiverPdfFile: {} });

    const result = await publishDraft(DRAFT_ID);
    expect(result).toMatchObject({
      error: expect.stringContaining("must be published from the create flow"),
    });
    expect(projects).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(draftDeletes).toBe(0);
  });

  test("a staged waiver row that wins the race is not reported as published", async () => {
    // The create flow stages a waiver project under this draft's key between
    // this request's lookup and its insert.
    beforeInsert = () => {
      beforeInsert = null;
      projects.push({
        id: STAGED_PROJECT_ID,
        creator_id: OWNER_ID,
        creation_idempotency_key: DRAFT_ID,
        workflow_status: "draft",
        waiver_required: true,
        organization_id: null,
      });
    };

    const result = await publishDraft(DRAFT_ID);

    expect(result).toMatchObject({
      error: expect.stringContaining("waiting for its waiver"),
    });
    expect(projects).toHaveLength(1);
    expect(projects[0].workflow_status).toBe("draft");
    expect(drafts).toHaveLength(1);
    expect(draftDeletes).toBe(0);
  });

  test("an id that is not a UUID is not found without any query", async () => {
    expect(await publishDraft("draft-1")).toEqual({ error: "Draft not found" });
    expect(attemptLookupFilters).toHaveLength(0);
    expect(projects).toHaveLength(0);
  });
});

describe("one saved draft publishes at most one project", () => {
  test("two concurrent publishes converge on one project through the unique key", async () => {
    // Both requests are held at the insert, so both have already missed the
    // attempt lookup and both try to create the project.
    const gate = deferred();
    insertGate = gate.promise;
    const racing = [publishDraft(DRAFT_ID), publishDraft(DRAFT_ID)];
    await until(() => pendingInserts === 2);
    gate.release();
    const outcomes = await Promise.all(racing);

    expect(projects).toHaveLength(1);
    expect(uniqueConflicts).toBe(1);
    expect(outcomes).toEqual([
      { success: true, id: projects[0].id as string },
      { success: true, id: projects[0].id as string },
    ]);
    expect(drafts).toHaveLength(0);
  });

  test("a publish that finishes while another is reading the draft is reused", async () => {
    // The other request publishes and removes the draft after this request's
    // first attempt lookup and before its draft read.
    beforeDraftRead = () => {
      beforeDraftRead = null;
      projects.push({
        id: STAGED_PROJECT_ID,
        creator_id: OWNER_ID,
        creation_idempotency_key: DRAFT_ID,
        workflow_status: "published",
      });
      drafts = [];
    };

    expect(await publishDraft(DRAFT_ID)).toEqual({
      success: true,
      id: STAGED_PROJECT_ID,
    });
    expect(projects).toHaveLength(1);
  });

  test("a lost draft removal keeps the draft, says so, and the retry only cleans up", async () => {
    draftDeleteFailures = 1;

    const first = await publishDraft(DRAFT_ID);
    expect(first).toEqual({
      success: true,
      id: projects[0].id as string,
      draftRetained: true,
      message: expect.stringContaining("draft could not be removed"),
    });
    expect(projects).toHaveLength(1);
    expect(drafts).toHaveLength(1);

    const retry = await publishDraft(DRAFT_ID);
    expect(retry).toEqual({ success: true, id: projects[0].id as string });
    expect(projects).toHaveLength(1);
    expect(drafts).toHaveLength(0);
    expect(pendingInserts).toBe(1);
  });

  test("a retry after a lost success response returns the published project", async () => {
    const lost = await publishDraft(DRAFT_ID);
    expect(drafts).toHaveLength(0);

    const retry = await publishDraft(DRAFT_ID);
    expect(retry).toEqual(lost);
    expect(retry).toEqual({ success: true, id: projects[0].id as string });
    expect(projects).toHaveLength(1);
    expect(pendingInserts).toBe(1);
  });
});

describe("publication is scoped to the signed-in creator", () => {
  test("another account cannot publish or remove someone else's draft", async () => {
    currentUserId = OTHER_ID;

    expect(await publishDraft(DRAFT_ID)).toEqual({ error: "Draft not found" });
    expect(projects).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(draftDeletes).toBe(0);
    for (const filters of attemptLookupFilters) {
      expect(filters).toEqual([
        ["creator_id", OTHER_ID],
        ["creation_idempotency_key", DRAFT_ID],
      ]);
    }
    expect(attemptLookupFilters.length).toBeGreaterThan(0);
  });

  test("another account's project under the same key is never returned or reused", async () => {
    projects.push({
      id: STAGED_PROJECT_ID,
      creator_id: OTHER_ID,
      creation_idempotency_key: DRAFT_ID,
      workflow_status: "published",
    });

    const result = await publishDraft(DRAFT_ID);

    expect(projects).toHaveLength(2);
    const own = projects.find((row) => row.creator_id === OWNER_ID);
    expect(result).toEqual({ success: true, id: own?.id as string });
    expect(own?.id).not.toBe(STAGED_PROJECT_ID);
    expect(drafts).toHaveLength(0);
  });
});

describe("a failure before publication keeps the draft", () => {
  test("a failed attempt lookup publishes nothing and removes nothing", async () => {
    attemptLookupFailures = 1;

    expect(await publishDraft(DRAFT_ID)).toEqual({
      error: "Could not check this draft's publication. Please try again.",
    });
    expect(projects).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(pendingInserts).toBe(0);
    expect(draftDeletes).toBe(0);
  });

  test("a failed draft read is not reported as a missing draft", async () => {
    draftReadFailures = 1;

    expect(await publishDraft(DRAFT_ID)).toEqual({
      error: "This draft could not be loaded. Please try again.",
    });
    expect(projects).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(draftDeletes).toBe(0);
  });

  test("a failed project insert keeps the draft for the next attempt", async () => {
    insertFailure = { code: "08006", message: "synthetic outage" };

    expect(await publishDraft(DRAFT_ID)).toEqual({
      error: "Failed to create project. Please try again.",
    });
    expect(projects).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(draftDeletes).toBe(0);

    insertFailure = null;
    expect(await publishDraft(DRAFT_ID)).toMatchObject({ success: true });
    expect(projects).toHaveLength(1);
    expect(drafts).toHaveLength(0);
  });
});
