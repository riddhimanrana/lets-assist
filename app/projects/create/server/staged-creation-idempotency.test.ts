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
/** Whether the staged-row update still finds a draft to write to. */
let stagedUpdateMatches = true;
let stagedUpdateError: unknown = null;

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

        if (ops.some((op) => op.method === "update")) {
          if (stagedUpdateError) {
            return { data: null, error: stagedUpdateError };
          }
          return {
            data: stagedUpdateMatches ? { id: EXISTING_PROJECT_ID } : null,
            error: null,
          };
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
  stagedUpdateMatches = true;
  stagedUpdateError = null;
});

function stagedUpdates() {
  return tableCalls
    .filter((call) => call.table === "projects")
    .filter((call) => call.ops.some((op) => op.method === "update"));
}

const STAGED_DRAFT = {
  id: EXISTING_PROJECT_ID,
  workflow_status: "draft",
  waiver_required: true,
  organization_id: null,
};

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

describe("a retried staged attempt applies the form the user sees now", () => {
  test("the staged row is rewritten with the current values, not left as first submitted", async () => {
    attemptLookups = [STAGED_DRAFT];

    const result = await createBasicProject(
      waiverProject({
        creationIdempotencyKey: ATTEMPT_KEY,
        basicInfo: {
          title: "Beach cleanup, new date",
          location: "North pier",
          description: "<p>Bring gloves and water.</p>",
          organizationId: null,
          projectTimezone: "America/New_York",
        },
        schedule: {
          oneTime: {
            date: "2099-07-04",
            startTime: "10:00",
            endTime: "13:00",
            volunteers: 12,
          },
        },
        waiverDisableEsignature: true,
      }),
    );

    expect(result).toEqual({
      success: true,
      id: EXISTING_PROJECT_ID,
      reusedExistingAttempt: true,
      requiresWaiverPublication: true,
    });
    expect(projectInsertPayloads()).toHaveLength(0);

    const updates = stagedUpdates();
    expect(updates).toHaveLength(1);
    const payload = opValue(updates[0].ops, "update")?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      title: "Beach cleanup, new date",
      location: "North pier",
      project_timezone: "America/New_York",
      schedule: {
        oneTime: {
          date: "2099-07-04",
          startTime: "10:00",
          endTime: "13:00",
          volunteers: 12,
        },
      },
      waiver_required: true,
      waiver_disable_esignature: true,
      workflow_status: "draft",
    });
    // Ownership and the attempt key are never rewritten.
    for (const column of [
      "creator_id",
      "organization_id",
      "creation_idempotency_key",
    ]) {
      expect(payload).not.toHaveProperty(column);
    }
    // Only this creator's own row, and only while it is still staged.
    expect(
      updates[0].ops.filter((op) => op.method === "eq").map((op) => op.args),
    ).toEqual([
      ["id", EXISTING_PROJECT_ID],
      ["creator_id", ACTOR.id],
      ["workflow_status", "draft"],
    ]);
  });

  test("a retry is validated like a first attempt and writes nothing when it fails", async () => {
    attemptLookups = [STAGED_DRAFT];

    const result = await createBasicProject(
      waiverProject({
        creationIdempotencyKey: ATTEMPT_KEY,
        schedule: {
          oneTime: {
            date: "2020-01-01",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 5,
          },
        },
      }),
    );

    expect(result).toEqual({ error: "Start time must be in the future" });
    expect(stagedUpdates()).toHaveLength(0);
  });

  test("a retry that removed the waiver publishes the row in the same write", async () => {
    attemptLookups = [STAGED_DRAFT];

    const result = await createBasicProject(
      waiverProject({
        creationIdempotencyKey: ATTEMPT_KEY,
        waiverRequired: false,
      }),
    );

    expect(result).toEqual({
      success: true,
      id: EXISTING_PROJECT_ID,
      reusedExistingAttempt: true,
    });
    const payload = opValue(stagedUpdates()[0].ops, "update")?.[0];
    expect(payload).toMatchObject({
      waiver_required: false,
      workflow_status: "published",
    });
  });

  test("a retry cannot move the staged row to another organization", async () => {
    attemptLookups = [
      {
        ...STAGED_DRAFT,
        organization_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    ];

    const result = await createBasicProject(
      waiverProject({ creationIdempotencyKey: ATTEMPT_KEY }),
    );

    expect(result.error).toMatch(/different organization/u);
    expect(stagedUpdates()).toHaveLength(0);
  });

  test("a row published in the meantime is not asked to publish again", async () => {
    attemptLookups = [STAGED_DRAFT];
    stagedUpdateMatches = false;

    const result = await createBasicProject(
      waiverProject({ creationIdempotencyKey: ATTEMPT_KEY }),
    );

    expect(result).toEqual({
      success: true,
      id: EXISTING_PROJECT_ID,
      reusedExistingAttempt: true,
    });
  });
});

function plainProject(overrides: Record<string, unknown> = {}) {
  return waiverProject({
    waiverRequired: false,
    waiverPdfFile: undefined,
    ...overrides,
  });
}

const RECURRING = {
  enabled: true,
  frequency: "weekly",
  interval: 1,
  endType: "never",
  weekdays: ["monday"],
};

describe("the create action validates what it stores", () => {
  const refusals: Array<{
    name: string;
    overrides: Record<string, unknown>;
    error: string | RegExp;
  }> = [
    {
      name: "an empty editor",
      overrides: {
        basicInfo: {
          title: "Beach cleanup",
          location: "Local",
          description: "<p></p>",
          organizationId: null,
        },
      },
      error: "Description is required",
    },
    {
      name: "a description longer than 2000 characters of text",
      overrides: {
        basicInfo: {
          title: "Beach cleanup",
          location: "Local",
          description: `<p>${"a".repeat(2001)}</p>`,
          organizationId: null,
        },
      },
      error: "Description cannot exceed 2000 characters",
    },
    {
      name: "a cleared volunteers field",
      overrides: {
        schedule: {
          oneTime: {
            date: "2099-06-01",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: null,
          },
        },
      },
      error: "Enter a number of volunteers",
    },
    {
      name: "zero volunteers",
      overrides: {
        schedule: {
          oneTime: {
            date: "2099-06-01",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 0,
          },
        },
      },
      error: "At least 1 volunteer is required",
    },
    {
      name: "a date that is not on the calendar",
      overrides: {
        schedule: {
          oneTime: {
            date: "2099-02-30",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 5,
          },
        },
      },
      error: /real calendar date/u,
    },
    {
      name: "two roles with the same name",
      overrides: {
        eventType: "sameDayMultiArea",
        schedule: {
          sameDayMultiArea: {
            date: "2099-06-01",
            overallStart: "09:00",
            overallEnd: "12:00",
            roles: [
              {
                name: "Setup",
                startTime: "09:00",
                endTime: "12:00",
                volunteers: 2,
              },
              {
                name: " setup ",
                startTime: "09:00",
                endTime: "12:00",
                volunteers: 2,
              },
            ],
          },
        },
      },
      error: /Two roles share this name/u,
    },
    {
      name: "a repeat schedule on a multi-day project",
      overrides: {
        eventType: "multiDay",
        schedule: {
          multiDay: [
            {
              date: "2099-06-01",
              slots: [
                {
                  name: "",
                  startTime: "09:00",
                  endTime: "12:00",
                  volunteers: 5,
                },
              ],
            },
          ],
        },
        recurrence: RECURRING,
      },
      error: /Multi-day projects cannot repeat/u,
    },
    {
      name: "an end date that was never chosen",
      overrides: { recurrence: { ...RECURRING, endType: "on_date" } },
      error: "Choose the date the series ends.",
    },
    {
      name: "a weekly repeat with no weekday",
      overrides: { recurrence: { ...RECURRING, weekdays: [] } },
      error: "Select at least one day of the week.",
    },
    {
      name: "an unknown time zone",
      overrides: {
        basicInfo: {
          title: "Beach cleanup",
          location: "Local",
          description: "<p>Bring gloves.</p>",
          organizationId: null,
          projectTimezone: "Not/A/Zone",
        },
      },
      error: /Invalid project timezone/u,
    },
    {
      name: "a payload that is not a project at all",
      overrides: { eventType: "weekly-thing" },
      error: "Choose an event type.",
    },
  ];

  for (const { name, overrides, error } of refusals) {
    test(`${name} is refused with a specific message and never stored`, async () => {
      const result = await createBasicProject(plainProject(overrides));

      if (typeof error === "string") expect(result.error).toBe(error);
      else expect(result.error).toMatch(error);
      expect(projectInsertPayloads()).toHaveLength(0);
    });
  }

  test("a repeating project that requires a waiver is staged unpublished with its repeat schedule", async () => {
    const result = await createBasicProject(
      plainProject({
        waiverRequired: true,
        waiverPdfFile: {},
        recurrence: RECURRING,
      }),
    );

    expect(result).toMatchObject({
      success: true,
      id: NEW_PROJECT_ID,
      requiresWaiverPublication: true,
    });
    expect(projectInsertPayloads()[0]).toMatchObject({
      waiver_required: true,
      workflow_status: "draft",
      recurrence_rule: {
        frequency: "weekly",
        interval: 1,
        end_type: "never",
        weekdays: ["monday"],
      },
    });
  });

  test("a hidden occurrence count left over from another end type is not sent", async () => {
    const result = await createBasicProject(
      plainProject({
        recurrence: {
          ...RECURRING,
          endOccurrences: 100,
          endDate: "2001-01-01",
        },
      }),
    );

    expect(result).toMatchObject({ success: true, id: NEW_PROJECT_ID });
    expect(projectInsertPayloads()[0].recurrence_rule).toEqual({
      frequency: "weekly",
      interval: 1,
      end_type: "never",
      end_date: null,
      end_occurrences: null,
      weekdays: ["monday"],
    });
  });

  test("only the parsed schedule of the chosen event type is stored", async () => {
    const result = await createBasicProject(
      plainProject({
        schedule: {
          oneTime: {
            date: "2099-06-01",
            startTime: "09:00",
            endTime: "12:00",
            volunteers: 5,
            injected: "unexpected",
          },
          multiDay: [{ date: "", slots: [] }],
        },
        status: "completed",
        creator_id: "someone-else",
      }),
    );

    expect(result).toMatchObject({ success: true });
    const payload = projectInsertPayloads()[0];
    expect(payload.schedule).toEqual({
      oneTime: {
        date: "2099-06-01",
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 5,
      },
    });
    expect(payload).toMatchObject({
      creator_id: ACTOR.id,
      status: "upcoming",
      workflow_status: "published",
      published: { oneTime: false },
    });
  });

  for (const [code, message, expected] of [
    [
      "23514",
      "Published projects require a valid schedule and timezone.",
      /schedule could not be saved/u,
    ],
    [
      "22023",
      "projects.recurrence_rule violates the recurrence contract",
      /repeat schedule is not valid/u,
    ],
    [
      "22023",
      "projects.project_timezone must be a valid IANA timezone",
      /time zone is not valid/u,
    ],
  ] as const) {
    test(`database refusal ${code} (${message.slice(0, 24)}) becomes a message the user can act on`, async () => {
      insertError = { code, message, details: "Failing row contains (...)" };
      const originalError = console.error;
      const logged: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        logged.push(args);
      };

      try {
        const result = await createBasicProject(plainProject());
        expect(result.error).toMatch(expected);
        expect(result.error).not.toContain(message);
        // The original error is logged for the operator, without row detail.
        expect(JSON.stringify(logged)).toContain(code);
        expect(JSON.stringify(logged)).not.toContain("Failing row");
      } finally {
        console.error = originalError;
      }
    });
  }
});
