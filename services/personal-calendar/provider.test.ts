import { afterAll, describe, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const {
  createPersonalCalendarEvent,
  removePersonalCalendarEvent,
  createPersonalCalendarEventRemover,
} = await import("./provider");
afterAll(() => mock.restore());
const event = {
  summary: "Fictional shift",
  start: { date: "2026-10-10" },
  end: { date: "2026-10-11" },
  extendedProperties: { private: { letsAssistReceipt: "generation-one" } },
};
const id = "la0123456789";
function responses(...values: Response[]) {
  const requests: RequestInit[] = [];
  const fake = (async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return values.shift()!;
  }) as typeof fetch;
  return { requests, fake };
}
function ownershipResponses(calendarId = "owned@example.test") {
  return [
    Response.json({ id: calendarId }),
    Response.json({ id: calendarId, accessRole: "owner" }),
  ];
}
describe("personal calendar provider retries", () => {
  test("supplies the persisted ID and refuses redirects", async () => {
    const f = responses(new Response("{}", { status: 200 }));
    expect(
      await createPersonalCalendarEvent(
        "fictional",
        "owned@example.test",
        id,
        event,
        f.fake,
      ),
    ).toBe(true);
    expect(JSON.parse(f.requests[0].body as string).id).toBe(id);
    expect(f.requests[0].redirect).toBe("error");
    expect(f.requests[0].signal).toBeInstanceOf(AbortSignal);
  });
  test("resolves 409 only to the same live receipt", async () => {
    const f = responses(
      new Response(null, { status: 409 }),
      Response.json({
        id,
        status: "confirmed",
        extendedProperties: event.extendedProperties,
      }),
    );
    expect(
      await createPersonalCalendarEvent(
        "fictional",
        "owned@example.test",
        id,
        event,
        f.fake,
      ),
    ).toBe(true);
    expect(f.requests).toHaveLength(2);
  });
  test.each([
    { id, status: "cancelled", extendedProperties: event.extendedProperties },
    {
      id,
      status: "confirmed",
      extendedProperties: { private: { letsAssistReceipt: "another" } },
    },
    {
      id: "anotherid",
      status: "confirmed",
      extendedProperties: event.extendedProperties,
    },
    { id },
  ])(
    "does not claim success for a tombstone or unrelated conflicting event: %j",
    async (existing) => {
      const f = responses(
        new Response(null, { status: 409 }),
        Response.json(existing),
      );
      expect(
        await createPersonalCalendarEvent(
          "fictional",
          "owned@example.test",
          id,
          event,
          f.fake,
        ),
      ).toBe(false);
    },
  );
  test.each([401, 403, 429, 500])(
    "preserves an uncertain outcome for HTTP%d",
    async (status) => {
      const f = responses(new Response(null, { status }));
      expect(
        await createPersonalCalendarEvent(
          "fictional",
          "owned@example.test",
          id,
          event,
          f.fake,
        ),
      ).toBe(false);
      expect(f.requests).toHaveLength(1);
    },
  );
  test.each([204, 404, 410])(
    "accepts confirmed deletion or absence HTTP%d",
    async (status) => {
      const f = responses(
        ...ownershipResponses(),
        new Response(null, { status }),
      );
      expect(
        await removePersonalCalendarEvent(
          "fictional",
          "owned@example.test",
          id,
          f.fake,
        ),
      ).toBe(true);
      expect(f.requests.map((request) => request.method ?? "GET")).toEqual([
        "GET",
        "GET",
        "DELETE",
      ]);
    },
  );
  test("network errors retain the same receipt for retry", async () => {
    const fake = (async () => {
      throw new TypeError("network unavailable");
    }) as unknown as typeof fetch;
    expect(
      await createPersonalCalendarEvent(
        "fictional",
        "owned@example.test",
        id,
        event,
        fake,
      ),
    ).toBe(false);
    expect(
      await removePersonalCalendarEvent(
        "fictional",
        "owned@example.test",
        id,
        fake,
      ),
    ).toBe(false);
  });
  test.each([404, 403, 500])(
    "calendar HTTP%d never proves event absence",
    async (status) => {
      const f = responses(new Response(null, { status }));
      expect(
        await removePersonalCalendarEvent(
          "fictional",
          "owned@example.test",
          id,
          f.fake,
        ),
      ).toBe(false);
      expect(f.requests).toHaveLength(1);
      expect(f.requests.some((request) => request.method === "DELETE")).toBe(
        false,
      );
    },
  );
  test("a shared calendar writer cannot settle another account's receipt", async () => {
    const f = responses(
      Response.json({ id: "owned@example.test" }),
      Response.json({ id: "owned@example.test", accessRole: "writer" }),
    );
    expect(
      await removePersonalCalendarEvent(
        "fictional",
        "owned@example.test",
        id,
        f.fake,
      ),
    ).toBe(false);
    expect(f.requests).toHaveLength(2);
  });
  test("proof is reused only for the exact token and calendar within one reconciliation", async () => {
    const f = responses(
      ...ownershipResponses(),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      ...ownershipResponses(),
      new Response(null, { status: 204 }),
      ...ownershipResponses("other@example.test"),
      new Response(null, { status: 204 }),
    );
    const remove = createPersonalCalendarEventRemover(f.fake);
    expect(await remove("first-token", "owned@example.test", id)).toBe(true);
    expect(
      await remove("first-token", "owned@example.test", "laanother01"),
    ).toBe(true);
    expect(await remove("second-token", "owned@example.test", id)).toBe(true);
    expect(await remove("second-token", "other@example.test", id)).toBe(true);
    expect(
      f.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(4);
    expect(f.requests).toHaveLength(10);
  });
});

const calendar = await import("@/services/calendar");
mock.module("@/services/calendar", () => ({
  ...calendar,
  getValidAccessToken: async () => "fictional-owner-token",
}));
const steps: string[] = [];
let receipt: import("./reconcile").PersonalCalendarReceipt;
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const step = args.p_step as string | undefined;
      if (step) steps.push(step);
      if (step === "confirm")
        receipt.confirmed_event_ids.push(
          (args.p_payload as { event_id: string }).event_id,
        );
      if (step === "finish") receipt.phase = "removed";
      return { data: structuredClone(receipt), error: null };
    },
  }),
}));
const { synchronizePersonalCalendar } = await import("./index");
test.each([false, true])(
  "real removal caller settles only with calendar ownership: %s",
  async (owned) => {
    steps.length = 0;
    receipt = {
      source_kind: "project",
      source_id: "3f92ceab-e4b9-4657-91c0-166249d2a101",
      user_id: "3f92ceab-e4b9-4657-91c0-166249d2a102",
      project_id: "3f92ceab-e4b9-4657-91c0-166249d2a101",
      generation: "3f92ceab-e4b9-4657-91c0-166249d2a103",
      phase: "removing",
      requested_schedule_id: null,
      legacy_event_id: null,
      calendar_id: "owned@example.test",
      events: [
        { id, event: null },
        { id: "laanother01", event: null },
      ],
      confirmed_event_ids: [],
      claim_token: "3f92ceab-e4b9-4657-91c0-166249d2a104",
    };
    const f = owned
      ? responses(
          ...ownershipResponses(),
          new Response(null, { status: 404 }),
          new Response(null, { status: 204 }),
        )
      : responses(new Response(null, { status: 404 }));
    const savedFetch = globalThis.fetch;
    globalThis.fetch = f.fake;
    try {
      const result = synchronizePersonalCalendar({
        userId: receipt.user_id,
        sourceKind: "project",
        sourceId: receipt.source_id,
        operation: "remove",
        expectedEventId: id,
      });
      if (owned) {
        expect(await result).toEqual({ phase: "removed", eventId: id });
        expect(steps).toEqual([
          "renew",
          "confirm",
          "renew",
          "confirm",
          "finish",
        ]);
        expect(f.requests).toHaveLength(4);
      } else {
        await expect(result).rejects.toThrow("Calendar outcome is unconfirmed");
        expect(steps).toEqual(["renew", "release"]);
        expect(receipt.phase).toBe("removing");
        expect(receipt.confirmed_event_ids).toEqual([]);
        expect(f.requests).toHaveLength(1);
        expect(f.requests.some((request) => request.method === "DELETE")).toBe(
          false,
        );
      }
    } finally {
      globalThis.fetch = savedFetch;
    }
  },
);
