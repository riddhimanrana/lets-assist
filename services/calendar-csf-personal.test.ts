import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let destination: {
  state: string;
  calendar_id: string | null;
  last_outcome_code: string | null;
} | null;
let lookupState: Record<string, unknown>;
let failBegin: boolean;
let failCompletion: boolean;
const rpc = mock(async (name: string, args: Record<string, unknown>) => {
  if (name === "csf_begin_personal_calendar_destination_provision") {
    if (failBegin) return { data: null, error: { code: "fixture" } };
    const shouldCreate =
      !destination ||
      (destination.state === "ready" &&
        args.p_replace_calendar_id === destination.calendar_id);
    if (shouldCreate)
      destination = {
        state: "provisioning",
        calendar_id: null,
        last_outcome_code: null,
      };
    if (!destination) throw new Error("Expected durable destination");
    return {
      error: null,
      data: {
        operationId: "operation-one",
        operationState: shouldCreate ? "started" : "unknown_outcome",
        destinationState: destination.state,
        calendarId: destination.calendar_id,
        outcomeCode: destination.last_outcome_code,
        shouldCallProvider: shouldCreate,
        idempotent: !shouldCreate,
      },
    };
  }
  if (failCompletion) return { data: null, error: { code: "fixture" } };
  destination = {
    state: args.p_outcome === "confirmed" ? "ready" : String(args.p_outcome),
    calendar_id: args.p_calendar_id as string | null,
    last_outcome_code: args.p_outcome_code as string | null,
  };
  return { data: {}, error: null };
});
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc,
    schema: () => ({
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: destination, error: null }),
        };
        return query;
      },
    }),
  }),
}));
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  getGoogleOAuthConnectionForBinding: async () => ({
    id: "connection-one",
    is_active: true,
    connection_type: "calendar",
    granted_scopes: "https://www.googleapis.com/auth/calendar.app.created",
  }),
}));
mock.module("./calendar-operations", () => ({
  getGoogleAccessTokenForUser: async () => "fictional-token",
}));
mock.module("./calendar", () => ({
  GOOGLE_CALENDAR_API: "https://www.googleapis.com/calendar/v3",
  GOOGLE_CALENDAR_LOOKUP_TIMEOUT_MS: 10_000,
  PERSONAL_CALENDAR_GOOGLE_BINDING: { purpose: "personal_calendar" },
  getGoogleCalendarAccessState: async () => lookupState,
}));
const { getCsfPersonalCalendarProviderContext } =
  await import("./calendar-csf-personal");
beforeEach(() => {
  destination = null;
  lookupState = { status: "accessible" };
  failBegin = false;
  failCompletion = false;
  rpc.mockClear();
});
afterAll(() => mock.restore());
const options = { requestId: "request-one", allowCreate: true };
describe("shared durable personal calendar provisioning", () => {
  test("claims before creation and persists identity before reporting ready", async () => {
    const fake = mock(async (_url: unknown, init?: RequestInit) => {
      expect(destination?.state).toBe("provisioning");
      expect(init?.redirect).toBe("error");
      return Response.json({ id: "created@example.test" });
    });
    const result = await getCsfPersonalCalendarProviderContext(
      "actor-one",
      options,
      fake as unknown as typeof fetch,
    );
    expect(result.status).toBe("ready");
    expect(destination?.state).toBe("ready");
    await getCsfPersonalCalendarProviderContext(
      "actor-one",
      { ...options, requestId: "request-two" },
      fake as unknown as typeof fetch,
    );
    expect(fake).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe(
      "csf_begin_personal_calendar_destination_provision",
    );
  });
  test.each([408, 429, 500, 503])(
    "HTTP%d leaves unknown creation blocked on retry",
    async (status) => {
      const fake = mock(async () => new Response(null, { status }));
      expect(
        (
          await getCsfPersonalCalendarProviderContext(
            "actor-one",
            options,
            fake as unknown as typeof fetch,
          )
        ).status,
      ).toBe("unknown_outcome");
      expect(
        (
          await getCsfPersonalCalendarProviderContext(
            "actor-one",
            { ...options, requestId: "request-two" },
            fake as unknown as typeof fetch,
          )
        ).status,
      ).toBe("unknown_outcome");
      expect(fake).toHaveBeenCalledTimes(1);
    },
  );
  test("network ambiguity and malformed successful response are retained", async () => {
    const fake = mock(async () => {
      throw new TypeError("network lost");
    });
    expect(
      (
        await getCsfPersonalCalendarProviderContext(
          "actor-one",
          options,
          fake as unknown as typeof fetch,
        )
      ).status,
    ).toBe("unknown_outcome");
    expect(destination?.state).toBe("unknown_outcome");
    destination = null;
    const malformed = mock(async () => Response.json({}));
    expect(
      (
        await getCsfPersonalCalendarProviderContext(
          "actor-one",
          options,
          malformed as unknown as typeof fetch,
        )
      ).status,
    ).toBe("unknown_outcome");
    expect(destination).toMatchObject({
      last_outcome_code: "malformed_response",
    });
  });
  test("database failure after Google success cannot authorize another creation", async () => {
    failCompletion = true;
    const fake = mock(async () =>
      Response.json({ id: "created@example.test" }),
    );
    expect(
      (
        await getCsfPersonalCalendarProviderContext(
          "actor-one",
          options,
          fake as unknown as typeof fetch,
        )
      ).status,
    ).toBe("unknown_outcome");
    expect(destination?.state).toBe("provisioning");
    expect(
      (
        await getCsfPersonalCalendarProviderContext(
          "actor-one",
          { ...options, requestId: "request-two" },
          fake as unknown as typeof fetch,
        )
      ).status,
    ).toBe("unknown_outcome");
    expect(fake).toHaveBeenCalledTimes(1);
  });
  test("claim failure prevents all provider writes", async () => {
    failBegin = true;
    const fake = mock(async () =>
      Response.json({ id: "created@example.test" }),
    );
    expect(
      (
        await getCsfPersonalCalendarProviderContext(
          "actor-one",
          options,
          fake as unknown as typeof fetch,
        )
      ).status,
    ).toBe("unknown_outcome");
    expect(fake).not.toHaveBeenCalled();
  });
  test.each([
    { status: "forbidden", httpStatus: 403 },
    { status: "retryable_error", reason: "rate_limited", httpStatus: 429 },
    { status: "retryable_error", reason: "server_error", httpStatus: 503 },
    { status: "retryable_error", reason: "timeout" },
  ])(
    "uncertain destination lookup cannot reserve a replacement: %j",
    async (state) => {
      destination = {
        state: "ready",
        calendar_id: "existing@example.test",
        last_outcome_code: null,
      };
      lookupState = state;
      const fake = mock(async () =>
        Response.json({ id: "replacement@example.test" }),
      );
      expect(
        (
          await getCsfPersonalCalendarProviderContext(
            "actor-one",
            options,
            fake as unknown as typeof fetch,
          )
        ).status,
      ).not.toBe("ready");
      expect(rpc).not.toHaveBeenCalled();
      expect(fake).not.toHaveBeenCalled();
      expect(destination.calendar_id).toBe("existing@example.test");
    },
  );
  test("only a confirmed missing calendar permits an exact-identity replacement claim", async () => {
    destination = {
      state: "ready",
      calendar_id: "existing@example.test",
      last_outcome_code: null,
    };
    lookupState = { status: "missing" };
    const fake = mock(async () =>
      Response.json({ id: "replacement@example.test" }),
    );
    expect(
      (
        await getCsfPersonalCalendarProviderContext(
          "actor-one",
          options,
          fake as unknown as typeof fetch,
        )
      ).status,
    ).toBe("ready");
    expect(rpc.mock.calls[0][1].p_replace_calendar_id).toBe(
      "existing@example.test",
    );
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
