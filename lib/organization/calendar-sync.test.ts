import { afterAll, beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
const INITIAL_VERSION = "2026-10-11T00:00:00.000Z";
const PROVISIONED_VERSION = "2026-10-11T00:00:01.000Z";
const NEWER_VERSION = "2026-10-11T00:05:00.000Z";
let authorized = true;
let projectError = false;
let failCalendar = false;
// The saved configuration as the database holds it now. A concurrent admin
// change edits it through one of the hooks below while a pass is in flight.
let savedRow: Record<string, unknown> = {};
let duringAuthorization: () => void = () => undefined;
let duringProvisioning: () => void = () => undefined;
let duringProjection: () => void = () => undefined;
const queryCalls: Array<[string, string, unknown[]]> = [];
const project = {
  id: "project-one",
  event_type: "oneTime",
  schedule: {
    oneTime: { date: "2030-01-01", startTime: "10:00", endTime: "12:00" },
  },
};
// The concurrent changes an in-flight pass must lose to. Each moves one pinned
// column only, so every predicate has to hold on its own.
const concurrentChanges = {
  owner: () => Object.assign(savedRow, { created_by: "owner-two" }),
  calendar: () =>
    Object.assign(savedRow, { calendar_id: "replacement@example.test" }),
  version: () => Object.assign(savedRow, { updated_at: NEWER_VERSION }),
} as const;
type Change = keyof typeof concurrentChanges;
const changes = Object.keys(concurrentChanges) as Change[];
/** Applies a change mid-pass and returns the row exactly as it left it. */
function saveConcurrently(change: Change, also: () => void = () => undefined) {
  const saved: { row: Record<string, unknown> | null } = { row: null };
  const apply = () => {
    also();
    concurrentChanges[change]();
    saved.row = { ...savedRow };
  };
  return { apply, saved };
}
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const filters: Array<["eq" | "is", string, unknown]> = [];
      let payload: Record<string, unknown> | null = null;
      // Filters decide the row like Postgres: `= NULL` matches nothing.
      const matches = () =>
        filters.every(([operator, column, value]) =>
          operator === "is"
            ? savedRow[column] === value
            : value !== null && savedRow[column] === value,
        );
      const result = () => {
        if (table === "organizations")
          return {
            data: { name: "Synthetic", username: "synthetic" },
            error: null,
          };
        if (table !== "organization_calendar_syncs")
          return {
            data: projectError ? null : [project],
            error: projectError ? {} : null,
          };
        if (!matches()) return { data: null, error: null };
        if (payload) Object.assign(savedRow, payload);
        return { data: { ...savedRow }, error: null };
      };
      const record =
        (method: string) =>
        (...args: unknown[]): unknown => {
          queryCalls.push([table, method, args]);
          return query;
        };
      const query = {
        select: record("select"),
        eq: (column: string, value: unknown) => {
          filters.push(["eq", column, value]);
          return record("eq")(column, value);
        },
        is: (column: string, value: unknown) => {
          filters.push(["is", column, value]);
          return record("is")(column, value);
        },
        neq: record("neq"),
        or: record("or"),
        order: record("order"),
        limit: record("limit"),
        gt: () => query,
        update: (values: Record<string, unknown>) => {
          payload = values;
          return record("update")(values);
        },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve().then(result).then(resolve, reject),
      };
      return query;
    },
  }),
}));
const token = mock(async (..._args: unknown[]) => "fictional");
const ensure = mock(async (..._args: unknown[]) => {
  if (failCalendar) return null;
  // Provisioning rewrites the compatibility row, which moves its version.
  Object.assign(savedRow, {
    calendar_id: "canonical@example.test",
    updated_at: PROVISIONED_VERSION,
  });
  duringProvisioning();
  return { calendarId: "canonical@example.test", created: false };
});
mock.module("@/services/calendar", () => ({
  getGoogleAccessTokenForUser: token,
  organizationCalendarGoogleBinding: (organizationId: string) => ({
    organizationId,
    purpose: "organization_calendar",
  }),
  ensureOrganizationCalendar: ensure,
  formatProjectToCalendarEvent: () => ({ summary: "Synthetic event" }),
}));
mock.module("@/lib/auth/google-oauth-authorization", () => ({
  authorizeGoogleOAuthOrganizationRequest: async () => {
    duringAuthorization();
    return { allowed: authorized };
  },
}));
const plans: unknown[] = [];
const reconcile = mock(
  async (options: {
    load: () => Promise<unknown[]>;
    sourceKinds: string[];
    userId: string;
    calendarId: string;
  }) => {
    try {
      plans.push({
        events: await options.load(),
        kinds: options.sourceKinds,
        owner: options.userId,
        calendar: options.calendarId,
      });
      duringProjection();
      return {
        success: true,
        createdCount: 1,
        updatedCount: 0,
        removedCount: 0,
      };
    } catch {
      return { success: false, error: "Source failed" };
    }
  },
);
mock.module("@/services/organization-calendar/reconcile", () => ({
  reconcileOrganizationCalendar: reconcile,
}));
const csf = mock(async (_options: unknown) => ({
  success: true,
  createdCount: 0,
  updatedCount: 0,
  removedCount: 0,
}));
mock.module("@/lib/organization/csf-calendar-sync", () => ({
  syncCsfCalendarProjections: csf,
}));
const { syncOrganizationCalendarInternal } = await import("./calendar-sync");
const configurationUpdates = () =>
  queryCalls.filter(
    ([table, method]) =>
      table === "organization_calendar_syncs" && method === "update",
  );
beforeEach(() => {
  authorized = true;
  projectError = false;
  failCalendar = false;
  savedRow = {
    organization_id: "org",
    created_by: "owner",
    calendar_id: "old@example.test",
    calendar_email: "calendar@example.test",
    auto_sync: true,
    last_synced_at: null,
    updated_at: INITIAL_VERSION,
  };
  duringAuthorization = () => undefined;
  duringProvisioning = () => undefined;
  duringProjection = () => undefined;
  queryCalls.length = 0;
  plans.length = 0;
  token.mockClear();
  ensure.mockClear();
  reconcile.mockClear();
  csf.mockClear();
});
afterAll(() => mock.restore());
test("revoked owner disables sync before acquiring a provider token", async () => {
  authorized = false;
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(token).not.toHaveBeenCalled();
  expect(ensure).not.toHaveBeenCalled();
  expect(savedRow.auto_sync).toBe(false);
  expect(savedRow.updated_at).not.toBe(INITIAL_VERSION);
  expect(savedRow.last_synced_at).toBeNull();
});
test("revoked owner of a calendar that was never provisioned is still paused", async () => {
  authorized = false;
  savedRow.calendar_id = null;
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(token).not.toHaveBeenCalled();
  expect(savedRow.auto_sync).toBe(false);
  expect(savedRow.calendar_id).toBeNull();
});
test.each(changes)(
  "a revoked old pass cannot disable a configuration with a newer %s",
  async (change) => {
    // The old owner loses access while an admin saves the replacement.
    const { apply, saved } = saveConcurrently(change, () => {
      authorized = false;
    });
    duringAuthorization = apply;

    expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
    // The pause was attempted and matched nothing.
    expect(configurationUpdates()).toHaveLength(1);
    expect(savedRow).toEqual(saved.row!);
    expect(savedRow.auto_sync).toBe(true);
    expect(token).not.toHaveBeenCalled();
  },
);
test("a calendar saved over an unprovisioned one is not paused by the old pass", async () => {
  savedRow.calendar_id = null;
  const { apply, saved } = saveConcurrently("calendar", () => {
    authorized = false;
  });
  duringAuthorization = apply;

  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(configurationUpdates()).toHaveLength(1);
  expect(savedRow).toEqual(saved.row!);
  expect(savedRow.auto_sync).toBe(true);
});
test("project projection keeps tenancy, publication scope, and source kind at the durable boundary", async () => {
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(true);
  expect(plans).toEqual([
    {
      events: [
        {
          source_kind: "project_schedule",
          source_id: "project-one",
          occurrence_key: "oneTime",
          event: { summary: "Synthetic event" },
        },
      ],
      kinds: ["project_schedule"],
      owner: "owner",
      calendar: "canonical@example.test",
    },
  ]);
  expect(ensure.mock.calls[0][3]).toEqual({
    organizationId: "org",
    userId: "owner",
  });
  expect(queryCalls).toContainEqual([
    "projects",
    "eq",
    ["organization_id", "org"],
  ]);
  expect(queryCalls).toContainEqual([
    "projects",
    "or",
    ["workflow_status.is.null,workflow_status.eq.published"],
  ]);
  expect(csf).toHaveBeenCalledTimes(1);
});
test("completion stamps the version that provisioning left, not the one first read", async () => {
  expect(await syncOrganizationCalendarInternal("org")).toEqual({
    success: true,
    createdCount: 1,
    updatedCount: 0,
    removedCount: 0,
  });
  expect(typeof savedRow.last_synced_at).toBe("string");
  expect(savedRow).toMatchObject({
    auto_sync: true,
    created_by: "owner",
    calendar_id: "canonical@example.test",
    updated_at: PROVISIONED_VERSION,
  });
});
test.each(changes)(
  "an old pass cannot stamp completion on a configuration with a newer %s",
  async (change) => {
    const { apply, saved } = saveConcurrently(change);
    duringProjection = apply;
    const result = await syncOrganizationCalendarInternal("org");

    expect(result).toEqual({
      success: false,
      error: "Calendar events synced, but completion could not be recorded",
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
    // Completion was attempted and matched nothing.
    expect(configurationUpdates()).toHaveLength(1);
    expect(savedRow).toEqual(saved.row!);
    expect(savedRow.last_synced_at).toBeNull();
  },
);
test.each(["owner", "calendar"] as const)(
  "a newer %s saved during provisioning stops the pass before any event work",
  async (change) => {
    duringProvisioning = saveConcurrently(change).apply;
    const result = await syncOrganizationCalendarInternal("org");

    expect(result).toEqual({
      success: false,
      error: "Calendar settings changed. Retry with the current connection.",
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(csf).not.toHaveBeenCalled();
    expect(configurationUpdates()).toHaveLength(0);
    expect(savedRow.last_synced_at).toBeNull();
    expect(savedRow.auto_sync).toBe(true);
  },
);
test("source load failure cannot report completion or run the other projection lane", async () => {
  projectError = true;
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(plans).toEqual([]);
  expect(csf).not.toHaveBeenCalled();
  expect(configurationUpdates()).toHaveLength(0);
  expect(savedRow.last_synced_at).toBeNull();
});
test("owner revocation after event work cannot stamp healthy completion", async () => {
  duringProjection = () => {
    authorized = false;
  };
  const result = await syncOrganizationCalendarInternal("org");
  expect(result.success).toBe(false);
  expect(configurationUpdates()).toHaveLength(0);
  expect(savedRow.last_synced_at).toBeNull();
});
test("uncertain destination prevents event reconciliation", async () => {
  failCalendar = true;
  expect((await syncOrganizationCalendarInternal("org")).success).toBe(false);
  expect(reconcile).not.toHaveBeenCalled();
  expect(csf).not.toHaveBeenCalled();
  expect(savedRow.last_synced_at).toBeNull();
});
