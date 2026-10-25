import { afterAll, describe, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const {
  createPersonalCalendarEventRemover,
  createPersonalCalendarEventUpdater,
} = await import("./provider");
afterAll(() => mock.restore());

const CALENDAR = "owned@example.test";
const id = "la0123456789";
const marker = { private: { letsAssistReceipt: "generation-one" } };
const event = {
  summary: "Fictional corrected shift",
  location: "Fictional hall",
  start: { dateTime: "2026-10-10T10:00:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-10-10T11:00:00", timeZone: "America/Los_Angeles" },
  extendedProperties: marker,
};
/** What Google returns once the saved payload is stored. */
const stored = {
  id,
  status: "confirmed",
  summary: event.summary,
  location: event.location,
  start: { ...event.start, dateTime: "2026-10-10T10:00:00-07:00" },
  end: { ...event.end, dateTime: "2026-10-10T11:00:00-07:00" },
  extendedProperties: marker,
};
const existing = {
  ...stored,
  summary: "Fictional earlier shift",
  etag: '"fictional-etag-1"',
};

function provider(...values: Array<Response | Error>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: unknown, init: RequestInit = {}) => {
    requests.push({ url: String(url), init });
    const next = values.shift();
    if (!next) throw new Error("unexpected provider request");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const methods = () => requests.map(({ init }) => init.method ?? "GET");
  return { requests, fake, methods };
}
const owned = (calendarId = CALENDAR) => [
  Response.json({ id: calendarId }),
  Response.json({ id: calendarId, accessRole: "owner" }),
];
const run = (
  f: ReturnType<typeof provider>,
  options: { legacy?: boolean; beforeWrite?: () => Promise<unknown> } = {},
  payload: typeof event = event,
) =>
  createPersonalCalendarEventUpdater(f.fake)(
    "fictional-token",
    CALENDAR,
    id,
    payload,
    options,
  );

describe("personal calendar in-place update", () => {
  test("verifies ownership and identity, then PUTs the same ID with the ETag", async () => {
    const f = provider(
      ...owned(),
      Response.json(existing),
      Response.json(stored),
    );
    expect(await run(f)).toBe(true);
    expect(f.methods()).toEqual(["GET", "GET", "GET", "PUT"]);
    const put = f.requests[3];
    // Same event, same calendar, and no guest notifications.
    expect(put.url.endsWith(`/events/${id}?sendUpdates=none`)).toBe(true);
    expect(put.url).toContain(encodeURIComponent(CALENDAR));
    const headers = put.init.headers as Record<string, string>;
    expect(headers["If-Match"]).toBe('"fictional-etag-1"');
    expect(headers.Authorization).toBe("Bearer fictional-token");
    expect(JSON.parse(put.init.body as string)).toMatchObject({
      id,
      summary: "Fictional corrected shift",
      extendedProperties: marker,
    });
    expect(put.init.redirect).toBe("error");
    expect(put.init.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a string", 7],
    ["carrying a line break", '"etag"\r\nX-Injected: 1'],
    ["oversized", `"${"e".repeat(1100)}"`],
  ])(
    "an existing event whose ETag is %s is held without a write",
    async (_label, etag) => {
      const f = provider(...owned(), Response.json({ ...existing, etag }));
      expect(await run(f)).toBe(false);
      expect(f.methods()).toEqual(["GET", "GET", "GET"]);
    },
  );

  test("fields this app does not own survive the full-resource PUT", async () => {
    const f = provider(
      ...owned(),
      Response.json({
        ...existing,
        description: "Earlier description",
        colorId: "6",
        attendees: [{ email: "guest@example.test" }],
        extendedProperties: {
          private: { ...marker.private, userNote: "keep" },
          shared: { teamNote: "keep" },
        },
      }),
      Response.json(stored),
    );
    expect(await run(f)).toBe(true);
    const body = JSON.parse(f.requests[3].init.body as string);
    expect(body).toMatchObject({
      id,
      colorId: "6",
      attendees: [{ email: "guest@example.test" }],
      summary: event.summary,
      location: event.location,
      start: event.start,
      end: event.end,
      extendedProperties: {
        private: { ...marker.private, userNote: "keep" },
        shared: { teamNote: "keep" },
      },
    });
    // The saved payload has no description, so the earlier one is not kept.
    expect("description" in body).toBe(false);
    expect("etag" in body).toBe(false);
  });

  test("the authority check runs after both lookups and immediately before the PUT", async () => {
    const f = provider(
      ...owned(),
      Response.json(existing),
      Response.json(stored),
    );
    const seen: string[][] = [];
    expect(
      await run(f, {
        beforeWrite: async () => {
          seen.push(f.methods());
        },
      }),
    ).toBe(true);
    expect(seen).toEqual([["GET", "GET", "GET"]]);
    expect(f.methods()).toEqual(["GET", "GET", "GET", "PUT"]);
  });

  test("a refused authority check writes nothing", async () => {
    const f = provider(...owned(), Response.json(existing));
    expect(
      await run(f, {
        beforeWrite: async () => {
          throw new Error("fictional lease lost");
        },
      }),
    ).toBe(false);
    expect(f.methods()).toEqual(["GET", "GET", "GET"]);
  });

  test("the authority check is not reached for an event that cannot be written", async () => {
    let checks = 0;
    const beforeWrite = async () => {
      checks++;
    };
    for (const body of [
      { ...existing, status: "cancelled" },
      { ...existing, etag: undefined },
    ]) {
      const f = provider(...owned(), Response.json(body));
      expect(await run(f, { beforeWrite })).toBe(false);
    }
    expect(checks).toBe(0);
  });

  test("a successful response that still shows the earlier payload does not confirm", async () => {
    const f = provider(
      ...owned(),
      Response.json(existing),
      Response.json(existing),
    );
    expect(await run(f)).toBe(false);
    expect(f.methods()).toEqual(["GET", "GET", "GET", "PUT"]);
  });

  test.each([
    ["the calendar's own zone", "2026-10-10T13:00:00-04:00", "11:00:00-07:00"],
    ["UTC", "2026-10-10T17:00:00Z", "11:00:00-07:00"],
    ["a wall time in the event zone", "2026-10-10T10:00:00", "11:00:00"],
  ])(
    "a response expressed in %s confirms the same instant",
    async (_label, start, end) => {
      const f = provider(
        ...owned(),
        Response.json(existing),
        Response.json({
          ...stored,
          start: { ...stored.start, dateTime: start },
          end: { ...stored.end, dateTime: `2026-10-10T${end}` },
        }),
      );
      expect(await run(f)).toBe(true);
    },
  );

  test.each([
    ["an hour off in another zone", "2026-10-10T12:00:00-04:00"],
    ["the same wall time in another offset", "2026-10-10T10:00:00-04:00"],
    ["an unparseable time", "tomorrow morning"],
  ])("a response showing %s does not confirm", async (_label, start) => {
    const f = provider(
      ...owned(),
      Response.json(existing),
      Response.json({
        ...stored,
        start: { ...stored.start, dateTime: start },
      }),
    );
    expect(await run(f)).toBe(false);
  });

  test("a response in a different event time zone does not confirm", async () => {
    const f = provider(
      ...owned(),
      Response.json(existing),
      Response.json({
        ...stored,
        start: { ...stored.start, timeZone: "America/New_York" },
      }),
    );
    expect(await run(f)).toBe(false);
  });

  test.each([404, 410, 401, 403, 429, 500])(
    "a lookup HTTP%d is an incomplete update with no write",
    async (status) => {
      const f = provider(...owned(), new Response(null, { status }));
      expect(await run(f)).toBe(false);
      expect(f.methods()).toEqual(["GET", "GET", "GET"]);
    },
  );

  test.each([
    ["a tombstone", { ...existing, status: "cancelled" }],
    ["another event", { ...existing, id: "anotherid" }],
    [
      "another receipt",
      {
        ...existing,
        extendedProperties: { private: { letsAssistReceipt: "other" } },
      },
    ],
    ["an event without a receipt", { ...existing, extendedProperties: {} }],
    ["a non-object body", "unexpected"],
  ])("refuses %s without writing", async (_label, body) => {
    const f = provider(...owned(), Response.json(body));
    expect(await run(f)).toBe(false);
    expect(f.methods()).toEqual(["GET", "GET", "GET"]);
  });

  test("a malformed lookup body stays retryable", async () => {
    const f = provider(...owned(), new Response("{", { status: 200 }));
    expect(await run(f)).toBe(false);
    expect(f.methods()).toEqual(["GET", "GET", "GET"]);
  });

  test("only the legacy ID may lack a receipt marker, and it gains one", async () => {
    const f = provider(
      ...owned(),
      Response.json({ ...existing, extendedProperties: undefined }),
      Response.json(stored),
    );
    expect(await run(f, { legacy: true })).toBe(true);
    expect(
      JSON.parse(f.requests[3].init.body as string).extendedProperties,
    ).toEqual(marker);
  });

  test("a legacy ID carrying another receipt is refused", async () => {
    const f = provider(
      ...owned(),
      Response.json({
        ...existing,
        extendedProperties: { private: { letsAssistReceipt: "other" } },
      }),
    );
    expect(await run(f, { legacy: true })).toBe(false);
    expect(f.methods()).toEqual(["GET", "GET", "GET"]);
  });

  test("a shared calendar writer cannot update the event", async () => {
    const f = provider(
      Response.json({ id: CALENDAR }),
      Response.json({ id: CALENDAR, accessRole: "writer" }),
    );
    expect(await run(f)).toBe(false);
    expect(f.methods()).toEqual(["GET", "GET"]);
  });

  test("the primary calendar is refused before any request", async () => {
    const f = provider();
    expect(
      await createPersonalCalendarEventUpdater(f.fake)(
        "fictional-token",
        "primary",
        id,
        event,
      ),
    ).toBe(false);
    expect(f.requests).toHaveLength(0);
  });

  test("a payload without its receipt marker is never written", async () => {
    const unmarked = { ...event, extendedProperties: undefined };
    const f = provider();
    expect(await run(f, {}, unmarked as unknown as typeof event)).toBe(false);
    expect(f.requests).toHaveLength(0);
  });

  test.each([404, 410, 412, 400, 401, 403])(
    "a write HTTP%d is incomplete and never recreates or clears the event",
    async (status) => {
      const f = provider(
        ...owned(),
        Response.json(existing),
        new Response(null, { status }),
      );
      expect(await run(f)).toBe(false);
      expect(f.methods()).toEqual(["GET", "GET", "GET", "PUT"]);
    },
  );

  test.each([429, 500, 503])(
    "an uncertain write HTTP%d is confirmed only by reading back the saved payload",
    async (status) => {
      const landed = provider(
        ...owned(),
        Response.json(existing),
        new Response(null, { status }),
        Response.json(stored),
      );
      expect(await run(landed)).toBe(true);
      expect(landed.methods()).toEqual(["GET", "GET", "GET", "PUT", "GET"]);

      const lost = provider(
        ...owned(),
        Response.json(existing),
        new Response(null, { status }),
        Response.json(existing),
      );
      expect(await run(lost)).toBe(false);
      expect(lost.methods()).toEqual(["GET", "GET", "GET", "PUT", "GET"]);
    },
  );

  test("a timed-out write is confirmed only by readback", async () => {
    const timeout = () =>
      Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const landed = provider(
      ...owned(),
      Response.json(existing),
      timeout(),
      Response.json(stored),
    );
    expect(await run(landed)).toBe(true);

    const lost = provider(
      ...owned(),
      Response.json(existing),
      timeout(),
      Response.json(existing),
    );
    expect(await run(lost)).toBe(false);

    const unreachable = provider(
      ...owned(),
      Response.json(existing),
      timeout(),
      timeout(),
    );
    expect(await run(unreachable)).toBe(false);
    expect(unreachable.methods()).toEqual(["GET", "GET", "GET", "PUT", "GET"]);
  });

  test.each([
    [
      "a different time",
      {
        ...stored,
        start: { ...stored.start, dateTime: "2026-10-10T09:00:00-07:00" },
      },
    ],
    ["a different location", { ...stored, location: "Elsewhere" }],
    ["a removed event", { ...stored, status: "cancelled" }],
  ])(
    "a readback showing %s does not confirm the write",
    async (_label, after) => {
      const f = provider(
        ...owned(),
        Response.json(existing),
        new Response(null, { status: 503 }),
        Response.json(after),
      );
      expect(await run(f)).toBe(false);
    },
  );

  test("a successful write is trusted only for the same identity and receipt", async () => {
    const foreign = provider(
      ...owned(),
      Response.json(existing),
      Response.json({
        ...stored,
        extendedProperties: { private: { letsAssistReceipt: "other" } },
      }),
    );
    expect(await run(foreign)).toBe(false);
    expect(foreign.methods()).toEqual(["GET", "GET", "GET", "PUT"]);

    const malformed = provider(
      ...owned(),
      Response.json(existing),
      new Response("{", { status: 200 }),
      Response.json(stored),
    );
    expect(await run(malformed)).toBe(true);
    expect(malformed.methods()).toEqual(["GET", "GET", "GET", "PUT", "GET"]);
  });

  test("ownership proof is reused only for the exact token and calendar", async () => {
    const f = provider(
      ...owned(),
      Response.json(existing),
      Response.json(stored),
      Response.json(existing),
      Response.json(stored),
      ...owned(),
      Response.json(existing),
      Response.json(stored),
      ...owned("other@example.test"),
      Response.json(existing),
      Response.json(stored),
    );
    const update = createPersonalCalendarEventUpdater(f.fake);
    expect(await update("first-token", CALENDAR, id, event)).toBe(true);
    expect(await update("first-token", CALENDAR, id, event)).toBe(true);
    expect(await update("second-token", CALENDAR, id, event)).toBe(true);
    expect(await update("second-token", "other@example.test", id, event)).toBe(
      true,
    );
    expect(f.methods().filter((method) => method === "PUT")).toHaveLength(4);
    expect(f.requests).toHaveLength(14);
    expect(
      f.methods().some((method) => method === "POST" || method === "DELETE"),
    ).toBe(false);
  });
});

describe("personal calendar removal authority check", () => {
  test("runs after the ownership proof and immediately before the DELETE", async () => {
    const f = provider(...owned(), new Response(null, { status: 204 }));
    const seen: string[][] = [];
    const remove = createPersonalCalendarEventRemover(f.fake);
    expect(
      await remove("fictional-token", CALENDAR, id, async () => {
        seen.push(f.methods());
      }),
    ).toBe(true);
    expect(seen).toEqual([["GET", "GET"]]);
    expect(f.methods()).toEqual(["GET", "GET", "DELETE"]);
    expect(f.requests[2].url.endsWith(`/events/${id}?sendUpdates=none`)).toBe(
      true,
    );
  });

  test("a refused check deletes nothing", async () => {
    const f = provider(...owned());
    const remove = createPersonalCalendarEventRemover(f.fake);
    expect(
      await remove("fictional-token", CALENDAR, id, async () => {
        throw new Error("fictional lease lost");
      }),
    ).toBe(false);
    expect(f.methods()).toEqual(["GET", "GET"]);
  });

  test("runs before every DELETE even when the ownership proof is reused", async () => {
    const f = provider(
      ...owned(),
      new Response(null, { status: 204 }),
      new Response(null, { status: 404 }),
    );
    let checks = 0;
    const beforeWrite = async () => {
      checks++;
    };
    const remove = createPersonalCalendarEventRemover(f.fake);
    expect(await remove("fictional-token", CALENDAR, id, beforeWrite)).toBe(
      true,
    );
    expect(
      await remove("fictional-token", CALENDAR, "laanother01", beforeWrite),
    ).toBe(true);
    expect(checks).toBe(2);
  });

  test("is not reached without ownership, and stays optional", async () => {
    const shared = provider(
      Response.json({ id: CALENDAR }),
      Response.json({ id: CALENDAR, accessRole: "writer" }),
    );
    let checks = 0;
    expect(
      await createPersonalCalendarEventRemover(shared.fake)(
        "fictional-token",
        CALENDAR,
        id,
        async () => {
          checks++;
        },
      ),
    ).toBe(false);
    expect(checks).toBe(0);

    const plain = provider(...owned(), new Response(null, { status: 204 }));
    expect(
      await createPersonalCalendarEventRemover(plain.fake)(
        "fictional-token",
        CALENDAR,
        id,
      ),
    ).toBe(true);
  });
});
