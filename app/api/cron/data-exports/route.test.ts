import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
mock.module("server-only", () => ({}));
let probe = false;
let observations = 0;
let calls: number[] = [];
let fail = false;
mock.module("@/lib/cron/auth-shape-probe", () => ({
  cronAuthShapeProbe: () =>
    probe ? Response.json({ mode: "auth-shape-v1", dispatched: false }) : null,
}));
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: async (
    _worker: string,
    operation: () => Promise<Response>,
  ) => {
    observations++;
    return operation();
  },
}));
mock.module("@/lib/supabase/data-export-jobs", () => ({
  processPendingDataExportJobs: async (limit: number) => {
    calls.push(limit);
    if (fail) throw new Error("private@example.test provider-secret");
    return {
      processed: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      removed: 0,
      cleanupFailed: false,
    };
  },
}));
mock.module("@/lib/logger", () => ({ logError: () => {} }));
const { GET, POST } = await import("./route");
const original = {
  token: process.env.CRON_TOKEN,
  secret: process.env.CRON_SECRET,
};
afterAll(() => {
  if (original.token === undefined) delete process.env.CRON_TOKEN;
  else process.env.CRON_TOKEN = original.token;
  if (original.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original.secret;
  mock.restore();
});
beforeEach(() => {
  process.env.CRON_TOKEN = "synthetic-cron-token";
  delete process.env.CRON_SECRET;
  probe = false;
  observations = 0;
  calls = [];
  fail = false;
});
function request(token = "synthetic-cron-token", search = "") {
  return new NextRequest(`http://localhost/api/cron/data-exports${search}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}
test("bad auth and auth-only probes perform no observation or domain work", async () => {
  expect((await POST(request("wrong"))).status).toBe(401);
  probe = true;
  expect(await (await GET(request())).json()).toEqual({
    mode: "auth-shape-v1",
    dispatched: false,
  });
  expect(calls).toEqual([]);
  expect(observations).toBe(0);
});
test("only authenticated real passes are observed, with bounded job counts", async () => {
  for (const method of [GET, POST]) {
    expect(
      (await method(request("synthetic-cron-token", "?limit=999"))).status,
    ).toBe(200);
    expect(
      (await method(request("synthetic-cron-token", "?limit=NaN"))).status,
    ).toBe(200);
  }
  expect(calls).toEqual([5, 1, 5, 1]);
  expect(observations).toBe(4);
});
test("worker exceptions stay generic in the HTTP response", async () => {
  fail = true;
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    ok: false,
    error: "Data export processing could not be confirmed",
  });
  expect(observations).toBe(1);
});
