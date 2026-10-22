import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Project } from "@/types";
import type { PersonalCalendarReceipt } from "./reconcile";

mock.module("server-only", () => ({}));
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONNECTION = "33333333-3333-4333-8333-333333333333";
const GENERATION = "44444444-4444-4444-8444-444444444444";
const CLAIM = "55555555-5555-4555-8555-555555555555";
const calendarId = "owned@example.test";
const event = {
  summary: "Fictional updated title",
  start: { date: "2030-10-10" },
  end: { date: "2030-10-11" },
  extendedProperties: { private: { letsAssistReceipt: GENERATION } },
};
let identity = "owner@example.test";
let revision = "2030-10-10T10:00:00.000Z";
let connectedAt = "2030-10-10T10:00:00.000Z";
let verifiedAt: string | null = "2030-10-10T10:00:00.000Z";
let grantedScopes = "https://www.googleapis.com/auth/calendar.app.created";
let connectionType = "calendar";
let onTokenFetch = () => {};
let onEventLookup = () => {};
let onProviderWrite = () => {};
let onDestinationProvision = () => {};
let receipt: PersonalCalendarReceipt;
const requests: Array<RequestInit> = [];
const steps: unknown[] = [];
const store = await import("@/lib/auth/google-oauth-connection-store");
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  ...store,
  getGoogleOAuthConnectionForBinding: async () => ({
    id: CONNECTION,
    user_id: USER,
    is_active: true,
    calendar_email: identity,
    binding_identity_email: identity,
    binding_identity_verified_at: verifiedAt,
    connected_at: connectedAt,
    updated_at: revision,
    granted_scopes: grantedScopes,
    connection_type: connectionType,
    preferences: { volunteering_calendar_id: calendarId },
  }),
}));
const calendar = await import("@/services/calendar");
mock.module("@/services/calendar", () => ({
  ...calendar,
  getValidAccessToken: async () => {
    onTokenFetch();
    return "fictional-cached-token";
  },
  getOrCreateVolunteeringCalendar: async () => {
    onDestinationProvision();
    return calendarId;
  },
  markPersonalCalendarConnectionSynced: async () => undefined,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (args.p_step) steps.push(args.p_step);
      if (args.p_step === "plan") {
        const plan = args.p_payload as {
          calendar_id: string;
          events: PersonalCalendarReceipt["events"];
        };
        receipt.calendar_id = plan.calendar_id;
        receipt.events = structuredClone(plan.events);
      }
      if (args.p_step === "confirm")
        receipt.confirmed_event_ids.push(
          (args.p_payload as { event_id: string }).event_id,
        );
      if (args.p_step === "finish") receipt.phase = "synced";
      return { data: structuredClone(receipt), error: null };
    },
  }),
}));
const { updatePersonalCalendarProject, synchronizePersonalCalendar } =
  await import("./index");
const savedFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init: RequestInit) => {
  requests.push(init);
  if (init.method === "PUT") {
    onProviderWrite();
    return Response.json({ ...event, id: "sameevent123", status: "confirmed" });
  }
  if (String(url).includes("/events/")) {
    onEventLookup();
    return Response.json({
      ...event,
      summary: "Old title",
      id: "sameevent123",
      status: "confirmed",
      etag: '"old"',
    });
  }
  return Response.json({ id: calendarId, accessRole: "owner" });
}) as typeof fetch;
beforeEach(() => {
  identity = "owner@example.test";
  revision = "2030-10-10T10:00:00.000Z";
  connectedAt = "2030-10-10T10:00:00.000Z";
  verifiedAt = "2030-10-10T10:00:00.000Z";
  grantedScopes = "https://www.googleapis.com/auth/calendar.app.created";
  connectionType = "calendar";
  onTokenFetch = () => {};
  onEventLookup = () => {};
  onProviderWrite = () => {};
  onDestinationProvision = () => {};
  requests.length = 0;
  steps.length = 0;
  receipt = {
    source_kind: "project",
    source_id: PROJECT,
    user_id: USER,
    project_id: PROJECT,
    generation: GENERATION,
    phase: "updating",
    requested_schedule_id: null,
    legacy_event_id: null,
    calendar_id: calendarId,
    events: [{ id: "sameevent123", event }],
    confirmed_event_ids: [],
    claim_token: CLAIM,
    update_planned_at: "2030-10-10T10:00:00.000Z",
    update_connection_id: CONNECTION,
  };
});
afterAll(() => {
  globalThis.fetch = savedFetch;
  mock.restore();
});
const project = {
  id: PROJECT,
  creator_id: USER,
  title: event.summary,
  description: "Fictional",
  location: "Fictional",
  event_type: "oneTime",
  schedule: {},
  status: "upcoming",
  workflow_status: "published",
  project_timezone: "America/Los_Angeles",
} as unknown as Project;

test("an unchanged bound account can update the saved event identity", async () => {
  expect(
    await updatePersonalCalendarProject({ userId: USER, project }),
  ).toEqual({ phase: "synced", eventId: "sameevent123" });
  expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
    1,
  );
});

test("a same-row OAuth rebind during token fetch cannot use the earlier account credential", async () => {
  onTokenFetch = () => {
    identity = "different-owner@example.test";
    revision = "2030-10-10T10:01:00.000Z";
  };
  await expect(
    updatePersonalCalendarProject({ userId: USER, project }),
  ).rejects.toMatchObject({ status: 409 });
  expect(requests).toEqual([]);
});

test("a same-row rebind during provider lookup stops before PUT", async () => {
  onEventLookup = () => {
    identity = "different-owner@example.test";
    revision = "2030-10-10T10:01:00.000Z";
  };
  await expect(
    updatePersonalCalendarProject({ userId: USER, project }),
  ).rejects.toBeInstanceOf(Error);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

test("a same-identity reauthorization during provider lookup also stops before PUT", async () => {
  onEventLookup = () => {
    revision = "2030-10-10T10:01:00.000Z";
  };
  await expect(
    updatePersonalCalendarProject({ userId: USER, project }),
  ).rejects.toBeInstanceOf(Error);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

test("a same-account reconnect during token fetch is distinct from an ordinary token refresh", async () => {
  verifiedAt = null;
  onTokenFetch = () => {
    connectedAt = "2030-10-10T10:01:00.000Z";
    revision = connectedAt;
  };
  await expect(
    updatePersonalCalendarProject({ userId: USER, project }),
  ).rejects.toMatchObject({ status: 409 });
  expect(requests).toEqual([]);
});

test("an ordinary token refresh may advance the row revision while preserving the account connection", async () => {
  onTokenFetch = () => {
    revision = "2030-10-10T10:01:00.000Z";
  };
  expect(
    await updatePersonalCalendarProject({ userId: USER, project }),
  ).toEqual({ phase: "synced", eventId: "sameevent123" });
  expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
    1,
  );
});

test("a rebind during the provider write cannot be acknowledged as current success", async () => {
  onProviderWrite = () => {
    identity = "different-owner@example.test";
    revision = "2030-10-10T10:01:00.000Z";
  };
  await expect(
    updatePersonalCalendarProject({ userId: USER, project }),
  ).rejects.toBeInstanceOf(Error);
  expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
    1,
  );
  expect(steps).not.toContain("confirm");
  expect(steps).not.toContain("finish");
});

function unsyncedProject() {
  receipt.phase = "syncing";
  receipt.calendar_id = null;
  receipt.events = [];
  receipt.update_planned_at = null;
  receipt.update_connection_id = null;
  return {
    ...project,
    schedule: {
      oneTime: {
        date: "2030-10-10",
        startTime: "10:00",
        endTime: "11:00",
        volunteers: 5,
      },
    },
  } as unknown as Project;
}

test("a first-time destination provision can persist its preferences without breaking the original add", async () => {
  const freshProject = unsyncedProject();
  onDestinationProvision = () => {
    revision = "2030-10-10T10:01:00.000Z";
  };
  const result = await synchronizePersonalCalendar({
    userId: USER,
    sourceKind: "project",
    sourceId: PROJECT,
    operation: "sync",
    project: freshProject,
  });
  expect(result.phase).toBe("synced");
  expect(result.eventId).toBe(receipt.events[0].id);
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(
    1,
  );
});

test("a reconnect during destination provisioning still stops the add before any event write", async () => {
  const freshProject = unsyncedProject();
  onDestinationProvision = () => {
    connectedAt = "2030-10-10T10:01:00.000Z";
    revision = connectedAt;
  };
  await expect(
    synchronizePersonalCalendar({
      userId: USER,
      sourceKind: "project",
      sourceId: PROJECT,
      operation: "sync",
      project: freshProject,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(requests).toEqual([]);
});

test.each(["scopes", "purpose"])(
  "a changed %s configuration cannot be rebased as a destination preference write",
  async (changed) => {
    const freshProject = unsyncedProject();
    onDestinationProvision = () => {
      revision = "2030-10-10T10:01:00.000Z";
      if (changed === "scopes")
        grantedScopes = "https://www.googleapis.com/auth/calendar.readonly";
      else connectionType = "sheets";
    };
    await expect(
      synchronizePersonalCalendar({
        userId: USER,
        sourceKind: "project",
        sourceId: PROJECT,
        operation: "sync",
        project: freshProject,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(requests).toEqual([]);
  },
);
