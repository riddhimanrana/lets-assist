import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let storedDestination: { state: string } | null;
let calendarCandidate: string | undefined;
let adoptionError: boolean;
let destinationError: boolean;
const rpc = mock(async () => ({
  data: true,
  error: adoptionError ? { code: "fixture" } : null,
}));
const context = mock(async () => ({
  status: "ready",
  calendarId: "canonical@example.test",
  accessToken: "fictional",
}));
mock.module("@/services/calendar-csf-personal", () => ({
  getCsfPersonalCalendarProviderContext: context,
}));
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  getGoogleOAuthConnectionForBinding: async () => ({
    id: "connection-one",
    preferences: { volunteering_calendar_id: calendarCandidate },
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc,
    schema: () => ({
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: storedDestination,
            error: destinationError ? {} : null,
          }),
        };
        return query;
      },
    }),
  }),
}));
mock.module("@/services/calendar", () => ({
  PERSONAL_CALENDAR_GOOGLE_BINDING: { purpose: "personal_calendar" },
  getGoogleCalendarAccessState: async (
    token: string,
    id: string,
    fetchImpl: typeof fetch,
  ) => {
    const response = await fetchImpl(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
    );
    return {
      status:
        response.status === 404
          ? "missing"
          : response.ok
            ? "accessible"
            : "forbidden",
    };
  },
}));
const { getDurablePersonalCalendarDestination, verifyOwnedLegacyCalendar } =
  await import("./destination");
const originalFetch = globalThis.fetch;
beforeEach(() => {
  storedDestination = null;
  calendarCandidate = undefined;
  adoptionError = false;
  destinationError = false;
  rpc.mockClear();
  context.mockClear();
  context.mockImplementation(async () => ({
    status: "ready",
    calendarId: "canonical@example.test",
    accessToken: "fictional",
  }));
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});
const proofFetch = (resource: unknown, statuses = [200, 200]) =>
  (async () => {
    const status = statuses.shift()!;
    return Response.json(resource, { status });
  }) as unknown as typeof fetch;
describe("shared personal destination adoption", () => {
  test("accepts only exact live non-primary owner proof", async () => {
    const requests: RequestInit[] = [];
    const fake = (async (_url: unknown, init: RequestInit) => {
      requests.push(init);
      return Response.json({ id: "legacy@example.test", accessRole: "owner" });
    }) as unknown as typeof fetch;
    expect(
      await verifyOwnedLegacyCalendar("fictional", "legacy@example.test", fake),
    ).toBe("owned");
    expect(requests[1].redirect).toBe("error");
    expect(requests[1].signal).toBeInstanceOf(AbortSignal);
  });
  test.each([
    { id: "legacy@example.test", accessRole: "writer" },
    { id: "other@example.test", accessRole: "owner" },
    { id: "legacy@example.test", accessRole: "owner", primary: true },
    { id: "legacy@example.test", accessRole: "owner", deleted: true },
    {},
  ])("rejects insufficient ownership evidence: %j", async (resource) => {
    expect(
      await verifyOwnedLegacyCalendar(
        "fictional",
        "legacy@example.test",
        proofFetch(resource),
      ),
    ).toBe("unconfirmed");
  });
  test("a calendarList404 alone cannot authorize creating a replacement", async () => {
    expect(
      await verifyOwnedLegacyCalendar(
        "fictional",
        "legacy@example.test",
        proofFetch({}, [200, 404]),
      ),
    ).toBe("unconfirmed");
    expect(
      await verifyOwnedLegacyCalendar(
        "fictional",
        "legacy@example.test",
        proofFetch({}, [404]),
      ),
    ).toBe("missing");
  });
  test("adopts a verified legacy destination before using the shared receipt", async () => {
    calendarCandidate = "legacy@example.test";
    globalThis.fetch = proofFetch({
      id: calendarCandidate,
      accessRole: "owner",
    });
    expect(
      await getDurablePersonalCalendarDestination("fictional", "user-one"),
    ).toBe("canonical@example.test");
    expect(rpc).toHaveBeenCalledWith(
      "adopt_verified_personal_calendar_destination",
      {
        p_user_id: "user-one",
        p_connection_id: "connection-one",
        p_calendar_id: calendarCandidate,
      },
    );
    expect(context).toHaveBeenCalledTimes(1);
  });
  test("does not treat failed adoption or uncertain lookup as permission to create", async () => {
    calendarCandidate = "legacy@example.test";
    adoptionError = true;
    globalThis.fetch = proofFetch({
      id: calendarCandidate,
      accessRole: "owner",
    });
    expect(
      await getDurablePersonalCalendarDestination("fictional", "user-one"),
    ).toBeNull();
    expect(context).not.toHaveBeenCalled();
    adoptionError = false;
    rpc.mockClear();
    globalThis.fetch = proofFetch({}, [503]);
    expect(
      await getDurablePersonalCalendarDestination("fictional", "user-one"),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
  });
  test("existing authoritative state ignores edited preferences", async () => {
    storedDestination = { state: "ready" };
    calendarCandidate = "edited@example.test";
    globalThis.fetch = (() => {
      throw new Error("legacy lookup must not run");
    }) as unknown as typeof fetch;
    expect(
      await getDurablePersonalCalendarDestination("fictional", "user-one"),
    ).toBe("canonical@example.test");
    expect(rpc).not.toHaveBeenCalled();
  });
  test("failed destination read never initiates provisioning", async () => {
    destinationError = true;
    expect(
      await getDurablePersonalCalendarDestination("fictional", "user-one"),
    ).toBeNull();
    expect(context).not.toHaveBeenCalled();
  });
});
