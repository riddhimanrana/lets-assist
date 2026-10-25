import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { writeOrganizationCalendarEvent } = await import("./provider");
const options = {
  accessToken: "fictional",
  calendarId: "calendar@example.test",
  eventId: "la001122334455",
  receiptId: "receipt-one",
  create: true,
  event: {
    summary: "Synthetic",
    extendedProperties: { private: { source: "keep" } },
  },
};
function responder(responses: Response[]) {
  return mock(async (_url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeDefined();
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
}
test("new event uses the saved ID and receipt marker", async () => {
  const fetcher = responder([Response.json({ id: options.eventId })]);
  expect(
    await writeOrganizationCalendarEvent(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBe("confirmed");
  const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(payload).toMatchObject({
    id: options.eventId,
    extendedProperties: {
      private: { source: "keep", letsAssistReceipt: options.receiptId },
    },
  });
});
test("lost create response retries by identity and refreshes the current payload", async () => {
  const fetcher = responder([
    new Response(null, { status: 409 }),
    Response.json({
      id: options.eventId,
      status: "confirmed",
      etag: '"revision-one"',
      extendedProperties: { private: { letsAssistReceipt: options.receiptId } },
    }),
    new Response(null, { status: 200 }),
  ]);
  expect(
    await writeOrganizationCalendarEvent(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBe("confirmed");
  expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual([
    "POST",
    "GET",
    "PUT",
  ]);
});
test("an unrelated conflict cannot be overwritten", async () => {
  const fetcher = responder([
    new Response(null, { status: 409 }),
    Response.json({
      id: options.eventId,
      status: "confirmed",
      extendedProperties: { private: { letsAssistReceipt: "other" } },
    }),
  ]);
  expect(
    await writeOrganizationCalendarEvent(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBe("unconfirmed");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("cancelled tombstones require a new generation", async () => {
  const fetcher = responder([
    new Response(null, { status: 409 }),
    Response.json({ id: options.eventId, status: "cancelled" }),
  ]);
  expect(
    await writeOrganizationCalendarEvent(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBe("missing");
});
test.each([404, 410])(
  "a removed update target (%d) requests a fresh ID",
  async (status) => {
    const fetcher = responder([new Response(null, { status })]);
    expect(
      await writeOrganizationCalendarEvent(
        { ...options, create: false },
        fetcher as unknown as typeof fetch,
      ),
    ).toBe("missing");
  },
);
test.each([403, 429, 503])(
  "uncertain update response %d preserves the ID",
  async (status) => {
    const fetcher = responder([new Response(null, { status })]);
    expect(
      await writeOrganizationCalendarEvent(
        { ...options, create: false },
        fetcher as unknown as typeof fetch,
      ),
    ).toBe("unconfirmed");
  },
);
test("unsafe stored calendar paths never receive a token", async () => {
  const fetcher = responder([]);
  expect(
    await writeOrganizationCalendarEvent(
      { ...options, calendarId: "../escape" },
      fetcher as unknown as typeof fetch,
    ),
  ).toBe("unconfirmed");
  expect(fetcher).not.toHaveBeenCalled();
});

test("conditional update refuses a concurrent provider edit", async () => {
  const fetcher = responder([
    Response.json({
      id: options.eventId,
      status: "confirmed",
      etag: '"revision-one"',
    }),
    new Response(null, { status: 412 }),
  ]);
  expect(
    await writeOrganizationCalendarEvent(
      { ...options, create: false },
      fetcher as unknown as typeof fetch,
    ),
  ).toBe("unconfirmed");
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
    "If-Match": '"revision-one"',
  });
});
test("expired lease after provider lookup cannot write a stale update", async () => {
  const fetcher = responder([
    Response.json({
      id: options.eventId,
      status: "confirmed",
      etag: '"revision-one"',
    }),
  ]);
  expect(
    await writeOrganizationCalendarEvent(
      {
        ...options,
        create: false,
        beforeWrite: async () => {
          throw new Error("expired");
        },
      },
      fetcher as unknown as typeof fetch,
    ),
  ).toBe("unconfirmed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
