import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  createGoogleCalendarOwnedEvent,
  deleteGoogleCalendarOwnedEvent,
  deterministicCsfGoogleEventId,
  updateGoogleCalendarOwnedEvent,
} = await import("./google-calendar-event-mutations");

const event = {
  summary: "CSF meeting",
  start: { date: "2026-09-01" },
  end: { date: "2026-09-02" },
};

function response(status: number) {
  return new Response(null, { status });
}

describe("personal CSF Google Calendar mutations", () => {
  test("derives a stable provider-safe event id from the local coordinate", () => {
    const input = {
      userId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      sourceKind: "csf_meeting_session",
      sourceId: "33333333-3333-4333-8333-333333333333",
      occurrenceKey: "primary",
    };
    const first = deterministicCsfGoogleEventId(input);
    expect(first).toBe(deterministicCsfGoogleEventId(input));
    expect(first).toMatch(/^[0-9a-v]{5,1024}$/u);
    expect(first).not.toBe(
      deterministicCsfGoogleEventId({
        ...input,
        sourceId: "44444444-4444-4444-8444-444444444444",
      }),
    );
  });

  test("treats a duplicate deterministic create as confirmed only after lookup", async () => {
    const calls: string[] = [];
    const fetchImpl = mock(
      async (_input: string | URL | Request, init?: RequestInit) => {
        calls.push(init?.method ?? "GET");
        return calls.length === 1 ? response(409) : response(200);
      },
    ) as unknown as typeof fetch;
    await expect(
      createGoogleCalendarOwnedEvent(
        "token",
        "calendar",
        "csf12345",
        event,
        fetchImpl,
      ),
    ).resolves.toEqual({ status: "confirmed", eventId: "csf12345" });
    expect(calls).toEqual(["POST", "GET"]);
  });

  test("never calls a retryable create failure confirmed", async () => {
    const fetchImpl = mock(async () =>
      response(503),
    ) as unknown as typeof fetch;
    await expect(
      createGoogleCalendarOwnedEvent(
        "token",
        "calendar",
        "csf12345",
        event,
        fetchImpl,
      ),
    ).resolves.toEqual({
      status: "unknown_outcome",
      reason: "server_error",
      httpStatus: 503,
    });
  });

  test("recreates only from a separately confirmed missing update", async () => {
    const fetchImpl = mock(async () =>
      response(404),
    ) as unknown as typeof fetch;
    await expect(
      updateGoogleCalendarOwnedEvent(
        "token",
        "calendar",
        "csf12345",
        event,
        fetchImpl,
      ),
    ).resolves.toEqual({ status: "confirmed_missing" });
  });

  test("treats delete 404 as confirmed and preserves ambiguous failures", async () => {
    const missing = mock(async () => response(404)) as unknown as typeof fetch;
    await expect(
      deleteGoogleCalendarOwnedEvent("token", "calendar", "csf12345", missing),
    ).resolves.toEqual({ status: "confirmed_deleted" });

    const network = mock(async () => {
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;
    await expect(
      deleteGoogleCalendarOwnedEvent("token", "calendar", "csf12345", network),
    ).resolves.toEqual({ status: "unknown_outcome", reason: "network_error" });
  });
});
