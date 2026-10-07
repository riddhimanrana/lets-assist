import { afterAll, describe, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { createPersonalCalendarEvent, removePersonalCalendarEvent } =
  await import("./provider");
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
      const f = responses(new Response(null, { status }));
      expect(
        await removePersonalCalendarEvent(
          "fictional",
          "owned@example.test",
          id,
          f.fake,
        ),
      ).toBe(true);
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
});
