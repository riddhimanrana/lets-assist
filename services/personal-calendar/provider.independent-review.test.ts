import { afterAll, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const {
  createPersonalCalendarEventUpdater,
  createPersonalCalendarEventRemover,
} = await import("./provider");
afterAll(() => mock.restore());

const calendarId = "owned@example.test";
const id = "sameevent123";
const properties = { private: { letsAssistReceipt: "saved-generation" } };
const desired = {
  summary: "Updated fictional project",
  description: "Updated description",
  location: "Fictional park",
  start: { date: "2030-10-10" },
  end: { date: "2030-10-11" },
  extendedProperties: properties,
};
const existing = {
  ...desired,
  summary: "Old title",
  id,
  status: "confirmed",
  etag: '"before"',
  colorId: "6",
  extendedProperties: {
    private: { ...properties.private, userNote: "keep" },
    shared: { teamNote: "keep" },
  },
};
function transport(
  put: Record<string, unknown> = { ...desired, id, status: "confirmed" },
  before = existing,
) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let getCount = 0;
  const fetchImpl = (async (input: unknown, init: RequestInit) => {
    requests.push({ url: String(input), init });
    if (init.method === "PUT") return Response.json(put);
    getCount++;
    if (getCount === 1) return Response.json({ id: calendarId });
    if (getCount === 2)
      return Response.json({ id: calendarId, accessRole: "owner" });
    return Response.json(before);
  }) as typeof fetch;
  return { requests, update: createPersonalCalendarEventUpdater(fetchImpl) };
}

test("same-ID updates preserve provider fields outside the project projection", async () => {
  const f = transport();
  expect(await f.update("fictional", calendarId, id, desired)).toBe(true);
  const request = f.requests.find(({ init }) => init.method === "PUT")!;
  const body = JSON.parse(String(request.init.body));
  expect(body.id).toBe(id);
  expect(body.colorId).toBe("6");
  expect(body.extendedProperties.private.userNote).toBe("keep");
  expect(body.extendedProperties.shared.teamNote).toBe("keep");
});

test("a successful HTTP response with a stale payload does not confirm the update", async () => {
  const f = transport(existing);
  expect(await f.update("fictional", calendarId, id, desired)).toBe(false);
});

test("fresh authorization runs after provider lookups and immediately before PUT", async () => {
  const f = transport();
  const options = {
    legacy: false,
    beforeWrite: async () => {
      throw new Error("source revoked during lookup");
    },
  };
  expect(await f.update("fictional", calendarId, id, desired, options)).toBe(
    false,
  );
  expect(f.requests.some(({ init }) => init.method === "PUT")).toBe(false);
});

test("a provider event lacking an ETag is held rather than overwritten unconditionally", async () => {
  const f = transport(undefined, {
    ...existing,
    etag: undefined,
  } as unknown as typeof existing);
  expect(await f.update("fictional", calendarId, id, desired)).toBe(false);
  expect(f.requests.some(({ init }) => init.method === "PUT")).toBe(false);
});

test("removal rechecks authority after the owned-calendar lookup", async () => {
  const requests: RequestInit[] = [];
  let reads = 0;
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    reads++;
    return Response.json(
      reads === 1
        ? { id: calendarId }
        : { id: calendarId, accessRole: "owner" },
    );
  }) as typeof fetch;
  const remove = createPersonalCalendarEventRemover(fetchImpl);
  expect(
    await remove("fictional", calendarId, id, async () => {
      throw new Error("receipt revoked during lookup");
    }),
  ).toBe(false);
  expect(requests.some((request) => request.method === "DELETE")).toBe(false);
});

test("an authorized removal runs the final fence after both ownership reads", async () => {
  const requests: RequestInit[] = [];
  let reads = 0;
  let authorizedAfterReads = 0;
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    reads++;
    return Response.json(
      reads === 1
        ? { id: calendarId }
        : { id: calendarId, accessRole: "owner" },
    );
  }) as typeof fetch;
  const remove = createPersonalCalendarEventRemover(fetchImpl);
  expect(
    await remove("fictional", calendarId, id, async () => {
      authorizedAfterReads = reads;
    }),
  ).toBe(true);
  expect(authorizedAfterReads).toBe(2);
  expect(
    requests.filter((request) => request.method === "DELETE"),
  ).toHaveLength(1);
});
