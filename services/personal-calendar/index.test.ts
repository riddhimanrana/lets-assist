import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { PersonalCalendarReceipt } from "./reconcile";

mock.module("server-only", () => ({}));

// Synthetic identifiers used only by the mocked stores below.
const USER_ID = "00000000-0000-4000-8000-000000000202";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000205";
const CALENDAR_ID = "owned@example.test";

/** The connection the binding currently resolves to; null once deactivated. */
let activeConnectionId: string | null = CONNECTION_ID;
const bindingReads: Array<{ userId: string; purpose: string }> = [];
let onTokenFetch: () => void = () => undefined;
let tokenFetches = 0;

const store = await import("@/lib/auth/google-oauth-connection-store");
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  ...store,
  getGoogleOAuthConnectionForBinding: async (
    userId: string,
    expected: { purpose: string },
  ) => {
    bindingReads.push({ userId, purpose: expected.purpose });
    return activeConnectionId ? { id: activeConnectionId } : null;
  },
}));
const calendar = await import("@/services/calendar");
mock.module("@/services/calendar", () => ({
  ...calendar,
  getValidAccessToken: async () => {
    tokenFetches++;
    onTokenFetch();
    return "fictional-owner-token";
  },
  markPersonalCalendarConnectionSynced: async () => undefined,
}));

const steps: string[] = [];
let receipt: PersonalCalendarReceipt;
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const step = args.p_step as string | undefined;
      if (step) steps.push(step);
      if (step === "confirm")
        receipt.confirmed_event_ids.push(
          (args.p_payload as { event_id: string }).event_id,
        );
      if (step === "finish") receipt.phase = "synced";
      return { data: structuredClone(receipt), error: null };
    },
  }),
}));
const { synchronizePersonalCalendar } = await import("./index");

const requests: Array<{ url: string; init: RequestInit }> = [];
let onProviderWrite: () => void = () => undefined;
const savedFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init: RequestInit) => {
  requests.push({ url: String(url), init });
  onProviderWrite();
  return new Response("{}", { status: 200 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = savedFetch;
  mock.restore();
});

function plannedEvent(id: string) {
  return {
    id,
    event: {
      summary: "Fictional shift",
      start: { date: "2026-10-10" },
      end: { date: "2026-10-11" },
      extendedProperties: {
        private: { letsAssistReceipt: "00000000-0000-4000-8000-000000000203" },
      },
    },
  };
}

beforeEach(() => {
  activeConnectionId = CONNECTION_ID;
  bindingReads.length = 0;
  requests.length = 0;
  steps.length = 0;
  tokenFetches = 0;
  onTokenFetch = () => undefined;
  onProviderWrite = () => undefined;
  receipt = {
    source_kind: "project",
    source_id: "00000000-0000-4000-8000-000000000201",
    user_id: USER_ID,
    project_id: "00000000-0000-4000-8000-000000000201",
    generation: "00000000-0000-4000-8000-000000000203",
    phase: "syncing",
    requested_schedule_id: null,
    legacy_event_id: null,
    calendar_id: CALENDAR_ID,
    events: [plannedEvent("la0123456789"), plannedEvent("laanother01")],
    confirmed_event_ids: [],
    claim_token: "00000000-0000-4000-8000-000000000204",
  };
});

const sync = () =>
  synchronizePersonalCalendar({
    userId: USER_ID,
    sourceKind: "project",
    sourceId: receipt.source_id,
    operation: "sync",
  });

test("an active binding still syncs every planned event", async () => {
  expect(await sync()).toEqual({ phase: "synced", eventId: "la0123456789" });

  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.init.method).toBe("POST");
    expect((request.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fictional-owner-token",
    );
  }
  expect(steps).toEqual(["renew", "confirm", "renew", "confirm", "finish"]);
  expect(tokenFetches).toBe(1);
  // One pin with the credential, then one fresh read before each write, all
  // for this user's personal-calendar binding and nothing else.
  expect(bindingReads).toHaveLength(3);
  expect(
    bindingReads.every(
      (read) => read.userId === USER_ID && read.purpose === "personal_calendar",
    ),
  ).toBe(true);
});

test("a binding deactivated between the token fetch and the first create writes nothing", async () => {
  // The disconnect lands while the credential is being fetched, so the worker
  // still ends up holding a usable cached token.
  onTokenFetch = () => {
    activeConnectionId = null;
  };

  await expect(sync()).rejects.toMatchObject({
    message:
      "Your Google Calendar was disconnected. Reconnect it to sync events.",
    status: 409,
  });

  expect(tokenFetches).toBe(1);
  expect(requests).toHaveLength(0);
  expect(receipt.confirmed_event_ids).toEqual([]);
  expect(receipt.phase).toBe("syncing");
  // The claim is released, never confirmed or finished.
  expect(steps).toEqual(["renew", "release"]);
});

test("a binding deactivated mid-sync stops before the next event", async () => {
  onProviderWrite = () => {
    activeConnectionId = null;
  };

  await expect(sync()).rejects.toMatchObject({ status: 409 });

  expect(requests).toHaveLength(1);
  expect(receipt.confirmed_event_ids).toEqual(["la0123456789"]);
  expect(steps).toEqual(["renew", "confirm", "renew", "release"]);
});

test("a binding that now points at another connection is not written with the old credential", async () => {
  onTokenFetch = () => {
    activeConnectionId = "00000000-0000-4000-8000-000000000206";
  };

  await expect(sync()).rejects.toMatchObject({ status: 409 });

  expect(requests).toHaveLength(0);
  expect(steps).toEqual(["renew", "release"]);
});

test("no active binding never fetches a credential", async () => {
  activeConnectionId = null;

  await expect(sync()).rejects.toMatchObject({
    message: "Please connect your Google Calendar first",
    status: 409,
  });

  expect(tokenFetches).toBe(0);
  expect(requests).toHaveLength(0);
});
