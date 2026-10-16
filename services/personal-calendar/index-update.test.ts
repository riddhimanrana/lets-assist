import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Project } from "@/types";
import type { PersonalCalendarReceipt } from "./reconcile";

mock.module("server-only", () => ({}));

// Synthetic identifiers used only by the mocked stores below.
const USER_ID = "00000000-0000-4000-8000-000000000302";
const PROJECT_ID = "00000000-0000-4000-8000-000000000301";
const GENERATION = "00000000-0000-4000-8000-000000000303";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000305";
const CALENDAR_ID = "owned@example.test";
const LEGACY_CALENDAR_ID = "legacy@example.test";
const marker = { private: { letsAssistReceipt: GENERATION } };

let activeConnectionId: string | null = CONNECTION_ID;
// The same connection row can be reauthorized as another Google account.
let boundEmail = "owner@example.test";
let rowRevision = "2030-10-10T10:00:00.000000+00:00";
// A reconnect resets this; an ordinary token refresh does not.
let connectedAt = "2030-10-01T09:00:00.000000+00:00";
let onTokenFetch: () => void = () => undefined;
let tokenFetches = 0;
let syncedMarks = 0;
const store = await import("@/lib/auth/google-oauth-connection-store");
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  ...store,
  getGoogleOAuthConnectionForBinding: async () =>
    activeConnectionId
      ? {
          id: activeConnectionId,
          calendar_email: boundEmail,
          connected_at: connectedAt,
          updated_at: rowRevision,
          preferences: { volunteering_calendar_id: LEGACY_CALENDAR_ID },
        }
      : null,
}));
const calendar = await import("@/services/calendar");
mock.module("@/services/calendar", () => ({
  ...calendar,
  getValidAccessToken: async () => {
    tokenFetches++;
    onTokenFetch();
    return "fictional-owner-token";
  },
  markPersonalCalendarConnectionSynced: async () => {
    syncedMarks++;
  },
}));

type RpcError = { code: string; hint?: string; message: string };
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const steps: string[] = [];
let receipt: PersonalCalendarReceipt;
let updateClaim: () => { data: unknown; error: RpcError | null };
let nextAdvanceError: RpcError | null = null;
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "claim_personal_calendar_update") return updateClaim();
      if (name === "claim_personal_calendar_sync")
        return {
          data: { ...structuredClone(receipt), claim_token: null },
          error: null,
        };
      const step = args.p_step as string;
      const payload = args.p_payload as Record<string, unknown>;
      steps.push(step);
      if (nextAdvanceError && step !== "release") {
        const error = nextAdvanceError;
        nextAdvanceError = null;
        return { data: null, error };
      }
      if (step === "plan") {
        receipt.calendar_id = payload.calendar_id as string;
        receipt.events = structuredClone(
          payload.events,
        ) as PersonalCalendarReceipt["events"];
        receipt.update_planned_at = "2026-10-11T00:00:00Z";
        receipt.update_connection_id = payload.connection_id as string;
      }
      if (step === "confirm")
        receipt.confirmed_event_ids.push(payload.event_id as string);
      if (step === "finish") receipt.phase = "synced";
      return { data: structuredClone(receipt), error: null };
    },
  }),
}));
const { synchronizePersonalCalendar, updatePersonalCalendarProject } =
  await import("./index");

/** A fictional in-memory Google Calendar that only knows saved events. */
const providerEvents = new Map<string, Record<string, unknown>>();
const requests: Array<{ url: string; method: string; body?: unknown }> = [];
let onProviderRequest: (method: string, url: string) => void = () => undefined;
const savedFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
  const [target] = String(url).split("?");
  const method = init.method ?? "GET";
  requests.push({
    url: String(url),
    method,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  });
  onProviderRequest(method, target);
  if (target.includes("/users/me/calendarList/"))
    return Response.json({
      id: decodeURIComponent(target.split("/").pop()!),
      accessRole: "owner",
    });
  const match = /\/calendars\/([^/]+)(?:\/events\/([^/]+))?$/.exec(target);
  if (!match || method === "POST" || method === "DELETE")
    return new Response(null, { status: 500 });
  if (!match[2]) return Response.json({ id: decodeURIComponent(match[1]) });
  if (method === "GET") {
    const current = providerEvents.get(match[2]);
    return current
      ? Response.json(current)
      : new Response(null, { status: 404 });
  }
  const body = JSON.parse(init.body as string);
  providerEvents.set(match[2], { ...body, status: "confirmed" });
  return Response.json(providerEvents.get(match[2]));
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = savedFetch;
  mock.restore();
});

const project = {
  id: PROJECT_ID,
  creator_id: USER_ID,
  title: "Fictional corrected title",
  description: "Synthetic",
  location: "Fictional hall",
  event_type: "oneTime",
  schedule: {
    oneTime: {
      date: "2030-10-10",
      startTime: "10:00",
      endTime: "12:00",
      volunteers: 20,
    },
  },
  status: "upcoming",
  workflow_status: "published",
  project_timezone: "America/Los_Angeles",
} as unknown as Project;
const multiDayProject = {
  ...project,
  event_type: "multiDay",
  schedule: {
    multiDay: [
      {
        date: "2030-10-11",
        slots: [
          {
            name: "Setup",
            startTime: "09:00",
            endTime: "10:00",
            volunteers: 5,
          },
          {
            name: "Cleanup",
            startTime: "15:00",
            endTime: "16:00",
            volunteers: 5,
          },
        ],
      },
    ],
  },
} as unknown as Project;

beforeEach(() => {
  activeConnectionId = CONNECTION_ID;
  boundEmail = "owner@example.test";
  rowRevision = "2030-10-10T10:00:00.000000+00:00";
  connectedAt = "2030-10-01T09:00:00.000000+00:00";
  onTokenFetch = () => undefined;
  nextAdvanceError = null;
  tokenFetches = 0;
  syncedMarks = 0;
  rpcCalls.length = 0;
  steps.length = 0;
  requests.length = 0;
  onProviderRequest = () => undefined;
  providerEvents.clear();
  providerEvents.set("la0123456789", {
    id: "la0123456789",
    status: "confirmed",
    summary: "Fictional earlier title",
    etag: '"fictional-etag"',
    colorId: "6",
    extendedProperties: {
      private: { ...marker.private, userNote: "keep" },
      shared: { teamNote: "keep" },
    },
  });
  receipt = {
    source_kind: "project",
    source_id: PROJECT_ID,
    user_id: USER_ID,
    project_id: PROJECT_ID,
    generation: GENERATION,
    phase: "updating",
    requested_schedule_id: null,
    legacy_event_id: null,
    calendar_id: CALENDAR_ID,
    events: [
      {
        id: "la0123456789",
        event: {
          summary: "Fictional earlier title",
          extendedProperties: marker,
        },
      },
    ],
    confirmed_event_ids: [],
    claim_token: "00000000-0000-4000-8000-000000000304",
    update_planned_at: null,
    update_connection_id: null,
  };
  updateClaim = () => ({ data: structuredClone(receipt), error: null });
});

const update = (target: Project = project) =>
  updatePersonalCalendarProject({ userId: USER_ID, project: target });
const writes = () => requests.filter(({ method }) => method !== "GET");

test("a creator update rewrites the same event on the same calendar", async () => {
  expect(await update()).toEqual({ phase: "synced", eventId: "la0123456789" });

  const claim = rpcCalls[0];
  expect(claim.name).toBe("claim_personal_calendar_update");
  expect(claim.args).toEqual({
    p_actor_user_id: USER_ID,
    p_project_id: PROJECT_ID,
    p_expected_source: {
      id: PROJECT_ID,
      creator_id: USER_ID,
      title: "Fictional corrected title",
      description: "Synthetic",
      location: "Fictional hall",
      event_type: "oneTime",
      schedule: project.schedule,
      project_timezone: "America/Los_Angeles",
      status: "upcoming",
      workflow_status: "published",
    },
  });
  // The second renew runs after the provider lookups, right before the PUT.
  expect(steps).toEqual(["plan", "renew", "renew", "confirm", "finish"]);
  const plan = rpcCalls.find(({ args }) => args.p_step === "plan")!.args
    .p_payload as Record<string, unknown>;
  expect(plan.calendar_id).toBe(CALENDAR_ID);
  expect(plan.connection_id).toBe(CONNECTION_ID);
  // The plan names the row revision the credential was read at.
  expect(plan.connection_updated_at).toBe(rowRevision);

  expect(writes()).toHaveLength(1);
  const [put] = writes();
  expect(put.method).toBe("PUT");
  expect(put.url).toContain(
    `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/la0123456789?sendUpdates=none`,
  );
  expect(put.body).toMatchObject({
    id: "la0123456789",
    summary: "Fictional corrected title",
    location: "Fictional hall",
    colorId: "6",
    extendedProperties: {
      private: { ...marker.private, userNote: "keep" },
      shared: { teamNote: "keep" },
    },
  });
  expect([...providerEvents.keys()]).toEqual(["la0123456789"]);
  expect(receipt.generation).toBe(GENERATION);
  expect(syncedMarks).toBe(1);
});

test("a project that was never synced reaches no credential and no provider", async () => {
  updateClaim = () => ({ data: null, error: null });

  expect(await update()).toEqual({ phase: "not_synced", eventId: null });

  expect(tokenFetches).toBe(0);
  expect(requests).toHaveLength(0);
  expect(steps).toEqual([]);
  expect(syncedMarks).toBe(0);
});

test("a project owned by someone else is refused before any claim", async () => {
  await expect(
    update({
      ...project,
      creator_id: "00000000-0000-4000-8000-000000000399",
    } as Project),
  ).rejects.toMatchObject({ status: 403 });

  expect(rpcCalls).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test.each([
  ["55000", "calendar_source_changed", "project changed"],
  ["55000", "calendar_receipt_syncing", "still being added"],
  ["55000", "calendar_receipt_removing", "still being removed"],
  ["55000", "calendar_source_unavailable", "published projects"],
  ["55P03", "calendar_operation_in_progress", "in progress"],
])(
  "a refused claim (%s %s) reports its recovery step and writes nothing",
  async (code, hint, text) => {
    updateClaim = () => ({
      data: null,
      error: { code, hint, message: "refused" },
    });

    await expect(update()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(text),
    });

    expect(tokenFetches).toBe(0);
    expect(requests).toHaveLength(0);
    expect(steps).toEqual([]);
  },
);

test("a changed occurrence count refuses with no provider write", async () => {
  await expect(update(multiDayProject)).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining("number of calendar occurrences"),
  });

  expect(steps).toEqual(["release"]);
  expect(requests).toHaveLength(0);
  expect(providerEvents.get("la0123456789")?.summary).toBe(
    "Fictional earlier title",
  );
});

test("the persisted schedule selection is honored instead of the whole project", async () => {
  receipt.requested_schedule_id = "2030-10-11-0-1";

  await update(multiDayProject);

  expect(writes()).toHaveLength(1);
  expect(writes()[0].body).toMatchObject({
    id: "la0123456789",
    summary: "Fictional corrected title - Cleanup",
    start: { dateTime: "2030-10-11T15:00:00" },
  });
});

test("a missing provider event is an incomplete update, not a recreate", async () => {
  providerEvents.clear();

  await expect(update()).rejects.toThrow("Calendar outcome is unconfirmed");

  expect(writes()).toHaveLength(0);
  expect(steps).toEqual(["plan", "renew", "release"]);
  expect(receipt.phase).toBe("updating");
  expect(syncedMarks).toBe(0);
});

test("a disconnect before the first write issues no provider write", async () => {
  activeConnectionId = null;

  await expect(update()).rejects.toMatchObject({ status: 409 });

  expect(tokenFetches).toBe(0);
  expect(requests).toHaveLength(0);
  expect(steps).toEqual(["release"]);
});

test("a disconnect after the last write is not acknowledged as success", async () => {
  onProviderRequest = (method) => {
    if (method === "PUT") activeConnectionId = null;
  };

  await expect(update()).rejects.toMatchObject({
    status: 409,
    message:
      "Your Google Calendar was disconnected. Reconnect it to sync events.",
  });

  expect(writes()).toHaveLength(1);
  // The landed write is not even confirmed under the lost connection.
  expect(steps).toEqual(["plan", "renew", "renew", "release"]);
  expect(receipt.confirmed_event_ids).toEqual([]);
  expect(receipt.phase).toBe("updating");
  expect(syncedMarks).toBe(0);
});

test("the same connection row rebound during the credential fetch reaches no provider", async () => {
  onTokenFetch = () => {
    boundEmail = "different-owner@example.test";
    rowRevision = "2030-10-10T10:01:00.000000+00:00";
  };

  await expect(update()).rejects.toMatchObject({ status: 409 });

  expect(requests).toHaveLength(0);
  expect(steps).toEqual(["release"]);
});

test("a same-account reconnect during the credential fetch reaches no provider", async () => {
  // Same row, same email, but a new grant: the fetched token may be the old one.
  onTokenFetch = () => {
    connectedAt = "2030-10-10T10:01:00.000000+00:00";
    rowRevision = "2030-10-10T10:01:00.000000+00:00";
  };

  await expect(update()).rejects.toMatchObject({ status: 409 });

  expect(requests).toHaveLength(0);
  expect(steps).toEqual(["release"]);
});

test("a same-account reconnect during the event lookup stops before the PUT", async () => {
  onProviderRequest = (method, url) => {
    if (method === "GET" && url.includes("/events/")) {
      connectedAt = "2030-10-10T10:02:00.000000+00:00";
      rowRevision = "2030-10-10T10:02:00.000000+00:00";
    }
  };

  await expect(update()).rejects.toMatchObject({ status: 409 });

  expect(writes()).toHaveLength(0);
  expect(steps).not.toContain("confirm");
});

test("a credential refresh that only advances the row revision is still usable", async () => {
  onTokenFetch = () => {
    rowRevision = "2030-10-10T10:01:00.000000+00:00";
  };

  expect(await update()).toMatchObject({ phase: "synced" });

  const plan = rpcCalls.find(({ args }) => args.p_step === "plan")!.args
    .p_payload as Record<string, unknown>;
  expect(plan.connection_updated_at).toBe("2030-10-10T10:01:00.000000+00:00");
});

test.each([
  [
    "rebound to another account",
    () => {
      boundEmail = "different-owner@example.test";
    },
  ],
  [
    "revised without an identity change",
    () => {
      rowRevision = "2030-10-10T10:02:00.000000+00:00";
    },
  ],
])(
  "the same connection row %s during the event lookup stops before the PUT",
  async (_label, change) => {
    onProviderRequest = (method, url) => {
      if (method === "GET" && url.includes("/events/")) change();
    };

    await expect(update()).rejects.toMatchObject({
      status: 409,
      message:
        "Your Google Calendar was disconnected. Reconnect it to sync events.",
    });

    expect(writes()).toHaveLength(0);
    expect(steps).toEqual(["plan", "renew", "renew", "release"]);
    expect(providerEvents.get("la0123456789")?.summary).toBe(
      "Fictional earlier title",
    );
  },
);

test("a source that changes during the event lookup stops before the PUT", async () => {
  onProviderRequest = (method, url) => {
    if (method === "GET" && url.includes("/events/"))
      nextAdvanceError = {
        code: "55000",
        hint: "calendar_source_changed",
        message: "refused",
      };
  };

  // The database refusal itself is reported, not a vague unconfirmed outcome.
  await expect(update()).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining("project changed"),
  });

  expect(steps).toEqual(["plan", "renew", "renew", "release"]);
  expect(writes()).toHaveLength(0);
  expect(providerEvents.get("la0123456789")?.summary).toBe(
    "Fictional earlier title",
  );
});

test("a rebind after the last write is not acknowledged as success", async () => {
  onProviderRequest = (method) => {
    if (method === "PUT")
      activeConnectionId = "00000000-0000-4000-8000-000000000306";
  };

  await expect(update()).rejects.toMatchObject({ status: 409 });

  expect(steps).not.toContain("finish");
  expect(receipt.phase).toBe("updating");
});

test("a legacy marker updates its one ID on the stored calendar without provisioning", async () => {
  receipt.legacy_event_id = "legacyevent123";
  receipt.calendar_id = null;
  receipt.events = [];
  providerEvents.clear();
  providerEvents.set("legacyevent123", {
    id: "legacyevent123",
    status: "confirmed",
    summary: "Fictional earlier title",
    etag: '"fictional-legacy-etag"',
  });

  expect(await update()).toEqual({
    phase: "synced",
    eventId: "legacyevent123",
  });

  const plan = rpcCalls.find(({ args }) => args.p_step === "plan")!.args
    .p_payload as { calendar_id: string; events: Array<{ id: string }> };
  expect(plan.calendar_id).toBe(LEGACY_CALENDAR_ID);
  expect(plan.events.map(({ id }) => id)).toEqual(["legacyevent123"]);
  expect(writes()).toHaveLength(1);
  expect(writes()[0].url).toContain(
    `/calendars/${encodeURIComponent(LEGACY_CALENDAR_ID)}/events/legacyevent123`,
  );
  expect(writes()[0].body).toMatchObject({ extendedProperties: marker });
  expect([...providerEvents.keys()]).toEqual(["legacyevent123"]);
});

test("a create request resumes an unfinished update through the update claim", async () => {
  const result = await synchronizePersonalCalendar({
    userId: USER_ID,
    sourceKind: "project",
    sourceId: PROJECT_ID,
    operation: "sync",
    project,
  });

  expect(result).toEqual({ phase: "synced", eventId: "la0123456789" });
  expect(rpcCalls.map(({ name }) => name).slice(0, 2)).toEqual([
    "claim_personal_calendar_sync",
    "claim_personal_calendar_update",
  ]);
  expect(writes().map(({ method }) => method)).toEqual(["PUT"]);
});

test("a create request without the project cannot act on an unfinished update", async () => {
  await expect(
    synchronizePersonalCalendar({
      userId: USER_ID,
      sourceKind: "project",
      sourceId: PROJECT_ID,
      operation: "sync",
    }),
  ).rejects.toMatchObject({ status: 409 });

  expect(steps).toEqual([]);
  expect(requests).toHaveLength(0);
});
