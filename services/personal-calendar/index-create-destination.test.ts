import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Project } from "@/types";
import type { PersonalCalendarReceipt } from "./reconcile";

mock.module("server-only", () => ({}));

// Synthetic identifiers used only by the mocked stores below.
const USER_ID = "00000000-0000-4000-8000-000000000402";
const PROJECT_ID = "00000000-0000-4000-8000-000000000401";
const GENERATION = "00000000-0000-4000-8000-000000000403";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000405";
const CALENDAR_ID = "owned@example.test";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

/** The bound connection row as the store would return it; null once inactive. */
let connection: Record<string, unknown> | null;
const store = await import("@/lib/auth/google-oauth-connection-store");
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  ...store,
  getGoogleOAuthConnectionForBinding: async () =>
    connection ? structuredClone(connection) : null,
}));
let destination: string | null = CALENDAR_ID;
let destinationCalls = 0;
let onDestination: () => void = () => undefined;
const calendar = await import("@/services/calendar");
mock.module("@/services/calendar", () => ({
  ...calendar,
  getValidAccessToken: async () => "fictional-owner-token",
  getOrCreateVolunteeringCalendar: async () => {
    destinationCalls++;
    onDestination();
    return destination;
  },
  markPersonalCalendarConnectionSynced: async () => undefined,
}));

const steps: string[] = [];
let receipt: PersonalCalendarReceipt;
let onPlan: () => void = () => undefined;
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const step = args.p_step as string | undefined;
      const payload = args.p_payload as Record<string, unknown>;
      if (step) steps.push(step);
      if (step === "plan") {
        receipt.calendar_id = payload.calendar_id as string;
        receipt.events = structuredClone(
          payload.events,
        ) as PersonalCalendarReceipt["events"];
        onPlan();
      }
      if (step === "confirm")
        receipt.confirmed_event_ids.push(payload.event_id as string);
      if (step === "finish")
        receipt.phase = receipt.phase === "syncing" ? "synced" : "removed";
      return { data: structuredClone(receipt), error: null };
    },
  }),
}));
const { synchronizePersonalCalendar } = await import("./index");

const requests: Array<{ url: string; method: string }> = [];
let onProviderRequest: (method: string, url: string) => void = () => undefined;
const savedFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
  const method = init.method ?? "GET";
  requests.push({ url: String(url), method });
  onProviderRequest(method, String(url));
  if (method === "GET")
    return Response.json({ id: CALENDAR_ID, accessRole: "owner" });
  return new Response(method === "DELETE" ? null : "{}", {
    status: method === "DELETE" ? 204 : 200,
  });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = savedFetch;
  mock.restore();
});

const project = {
  id: PROJECT_ID,
  creator_id: USER_ID,
  title: "Fictional park cleanup",
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
const plannedEvent = (id: string) => ({
  id,
  event: {
    summary: "Fictional shift",
    start: { date: "2030-10-10" },
    end: { date: "2030-10-11" },
    extendedProperties: { private: { letsAssistReceipt: GENERATION } },
  },
});

beforeEach(() => {
  connection = {
    id: CONNECTION_ID,
    calendar_email: "owner@example.test",
    connected_at: "2030-10-01T09:00:00.000000+00:00",
    updated_at: "2030-10-10T10:00:00.000000+00:00",
    granted_scopes: CALENDAR_SCOPE,
    connection_type: "calendar",
    preferences: {},
  };
  destination = CALENDAR_ID;
  destinationCalls = 0;
  onDestination = () => undefined;
  onPlan = () => undefined;
  onProviderRequest = () => undefined;
  steps.length = 0;
  requests.length = 0;
  // A first sync: nothing planned and no destination yet.
  receipt = {
    source_kind: "project",
    source_id: PROJECT_ID,
    user_id: USER_ID,
    project_id: PROJECT_ID,
    generation: GENERATION,
    phase: "syncing",
    requested_schedule_id: null,
    legacy_event_id: null,
    calendar_id: null,
    events: [],
    confirmed_event_ids: [],
    claim_token: "00000000-0000-4000-8000-000000000404",
  };
});

const sync = () =>
  synchronizePersonalCalendar({
    userId: USER_ID,
    sourceKind: "project",
    sourceId: PROJECT_ID,
    operation: "sync",
    project,
  });
const posts = () => requests.filter(({ method }) => method === "POST");
/** What provisioning does to the row: save the calendar ID and advance the revision. */
const destinationSaved = () => {
  connection = {
    ...connection,
    preferences: { volunteering_calendar_id: CALENDAR_ID },
    updated_at: "2030-10-10T10:01:00.000000+00:00",
  };
};

test("a first add survives its own destination write advancing the row revision", async () => {
  onDestination = destinationSaved;

  const result = await sync();

  expect(result.phase).toBe("synced");
  expect(destinationCalls).toBe(1);
  expect(posts()).toHaveLength(1);
  expect(steps).toEqual(["plan", "renew", "confirm", "finish"]);
});

test.each([
  [
    "a same-account reconnect",
    { connected_at: "2030-10-10T10:01:00.000000+00:00" },
  ],
  ["another Google account", { calendar_email: "other@example.test" }],
  ["a changed scope grant", { granted_scopes: `${CALENDAR_SCOPE} extra` }],
  ["a changed connection type", { connection_type: "both" }],
])(
  "%s during destination provisioning stops the add before any event write",
  async (_label, change) => {
    onDestination = () => {
      destinationSaved();
      connection = { ...connection, ...change };
    };

    await expect(sync()).rejects.toMatchObject({
      status: 409,
      message:
        "Your Google Calendar was disconnected. Reconnect it to sync events.",
    });

    expect(requests).toHaveLength(0);
    expect(steps).toEqual(["release"]);
  },
);

test("a disconnect during destination provisioning stops the add before any event write", async () => {
  onDestination = () => {
    connection = null;
  };

  await expect(sync()).rejects.toMatchObject({ status: 409 });

  expect(requests).toHaveLength(0);
  expect(steps).toEqual(["release"]);
});

test("the revision is strict again right after the destination boundary", async () => {
  onDestination = destinationSaved;
  // A later row write, after the destination was accepted and before the POST.
  onPlan = () => {
    connection = {
      ...connection,
      updated_at: "2030-10-10T10:02:00.000000+00:00",
    };
  };

  await expect(sync()).rejects.toMatchObject({ status: 409 });

  expect(posts()).toHaveLength(0);
  expect(steps).toEqual(["plan", "renew", "release"]);
});

test("an unresolved destination accepts no row change and writes nothing", async () => {
  destination = null;
  onDestination = () => {
    connection = {
      ...connection,
      updated_at: "2030-10-10T10:01:00.000000+00:00",
    };
  };

  await expect(sync()).rejects.toMatchObject({ status: 409 });

  expect(requests).toHaveLength(0);
  expect(steps).toEqual(["release"]);
});

test("a resumed add with a saved plan never re-pins the revision between event writes", async () => {
  receipt.calendar_id = CALENDAR_ID;
  receipt.events = [plannedEvent("la0123456789"), plannedEvent("laanother01")];
  onProviderRequest = (method) => {
    if (method === "POST")
      connection = {
        ...connection,
        updated_at: "2030-10-10T10:03:00.000000+00:00",
      };
  };

  await expect(sync()).rejects.toMatchObject({ status: 409 });

  expect(destinationCalls).toBe(0);
  expect(posts()).toHaveLength(1);
  expect(receipt.confirmed_event_ids).toEqual(["la0123456789"]);
});

test("removal stays strict: a row revision change during the ownership lookup stops before the DELETE", async () => {
  receipt.phase = "removing";
  receipt.calendar_id = CALENDAR_ID;
  receipt.events = [{ id: "la0123456789", event: null }];
  onProviderRequest = (method) => {
    if (method === "GET")
      connection = {
        ...connection,
        updated_at: "2030-10-10T10:04:00.000000+00:00",
      };
  };

  await expect(
    synchronizePersonalCalendar({
      userId: USER_ID,
      sourceKind: "project",
      sourceId: PROJECT_ID,
      operation: "remove",
      expectedEventId: "la0123456789",
    }),
  ).rejects.toMatchObject({ status: 409 });

  expect(destinationCalls).toBe(0);
  expect(requests.some(({ method }) => method === "DELETE")).toBe(false);
  expect(steps).not.toContain("confirm");
});
