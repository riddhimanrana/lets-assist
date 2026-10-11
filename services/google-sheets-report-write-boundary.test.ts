import { afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("@/lib/logger", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: () => undefined,
}));

const { inspectSpreadsheet, replaceSpreadsheetReportRanges } =
  await import("./google-sheets-report");

const originalFetch = globalThis.fetch;
let events: string[] = [];
/** Answers one mutation: a status, or a thrown error for the name given. */
let answer: (method: string) => number | "TypeError" | "TimeoutError";
let failAcknowledgement = false;

const hooks = (extra: { signal?: AbortSignal; remaining?: number } = {}) => ({
  signal: extra.signal,
  budget: { remaining: extra.remaining ?? 4 },
  beforeWrite: async () => {
    events.push("beforeWrite");
  },
  acknowledgeWrite: async (outcome: string) => {
    events.push(`acknowledge:${outcome}`);
    if (failAcknowledgement) throw new Error("fixture receipt unavailable");
  },
});
const replace = (options: ReturnType<typeof hooks>, clears: string[] = []) =>
  replaceSpreadsheetReportRanges(
    "fictional-token",
    "sheet-1",
    "'Report'!A1:B1",
    clears,
    [["a", 1]],
    options,
  );

beforeEach(() => {
  events = [];
  failAcknowledgement = false;
  answer = () => 200;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    events.push(method);
    const result = answer(method);
    if (typeof result === "string")
      throw new DOMException("fixture transport", result);
    if (method !== "GET") return new Response("{}", { status: result });
    return Response.json(
      { spreadsheetId: "sheet-1", sheets: [] },
      { status: result },
    );
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("authority is checked immediately before each mutation, and each accepted one is acknowledged once", async () => {
  const result = await replace(hooks(), ["'Report'!C1:D1"]);

  expect(result).toEqual({ success: true });
  expect(events).toEqual([
    "beforeWrite",
    "PUT",
    "acknowledge:completed",
    "beforeWrite",
    "POST",
    "acknowledge:completed",
  ]);
});

test.each([400, 401, 403, 404, 429])(
  "a mutation refused with %i is acknowledged as rejected",
  async (status) => {
    answer = () => status;
    expect(await replace(hooks())).toMatchObject({
      success: false,
      stage: "write",
    });
    expect(events).toEqual(["beforeWrite", "PUT", "acknowledge:rejected"]);
  },
);

test.each([
  500,
  502,
  503,
  504,
  408,
  409,
  412,
  "TypeError",
  "TimeoutError",
] as const)(
  "a mutation answered with %s is never acknowledged",
  async (result) => {
    answer = () => result;
    expect(await replace(hooks())).toMatchObject({ success: false });
    expect(events).toEqual(["beforeWrite", "PUT"]);
  },
);

test("a caller abort while the request is in flight is never acknowledged", async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    events.push(init?.method ?? "GET");
    controller.abort();
    init?.signal?.throwIfAborted();
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  expect(await replace(hooks({ signal: controller.signal }))).toMatchObject({
    success: false,
    reason: "timeout",
  });
  expect(events).toEqual(["beforeWrite", "PUT"]);
});

test("a deadline that passes during the authority check sends nothing and says so", async () => {
  const controller = new AbortController();
  const options = hooks({ signal: controller.signal });
  options.beforeWrite = async () => {
    events.push("beforeWrite");
    controller.abort();
  };

  expect(await replace(options)).toMatchObject({ success: false });
  expect(events).toEqual(["beforeWrite", "acknowledge:unsent"]);
});

test("a deadline or a spent budget stops a mutation before the authority check", async () => {
  const expired = new AbortController();
  expired.abort();
  expect(await replace(hooks({ signal: expired.signal }))).toMatchObject({
    success: false,
  });
  expect(await replace(hooks({ remaining: 0 }))).toMatchObject({
    success: false,
  });
  expect(events).toEqual([]);
});

test("a refused authority check sends nothing and acknowledges nothing", async () => {
  const options = hooks();
  options.beforeWrite = async () => {
    events.push("beforeWrite");
    throw new Error("fixture authority changed");
  };

  expect(await replace(options)).toMatchObject({ success: false });
  expect(events).toEqual(["beforeWrite"]);
});

test("an acknowledgement that cannot be saved fails the mutation and stops the clears", async () => {
  failAcknowledgement = true;

  expect(await replace(hooks(), ["'Report'!C1:D1"])).toMatchObject({
    success: false,
    stage: "write",
  });
  expect(events).toEqual(["beforeWrite", "PUT", "acknowledge:completed"]);
});

test("a read runs neither hook", async () => {
  const read = async () =>
    (await inspectSpreadsheet("fictional-token", "sheet-1", hooks())).ok;

  expect(await read()).toBe(true);
  answer = () => 500;
  expect(await read()).toBe(false);
  expect(events).toEqual(["GET", "GET"]);
});
