import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("server-only", () => ({}));
const observationCalls: string[] = [];
mock.module("@/lib/cron/worker-observation", () => ({
  observeWorkerRun: async (
    worker: string,
    operation: () => Promise<Response>,
  ) => {
    observationCalls.push(worker);
    return operation();
  },
}));
let cleanupCalls = 0;
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/services/csf-cleanup-orchestration",
  () => ({
    runCsfStorageCleanup: async () => {
      cleanupCalls += 1;
      return { ok: true };
    },
  }),
);
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/services/proof-storage",
  () => ({
    drainCsfProofStorageDeletionQueue: async () => ({}),
    enqueueStaleCsfProofUploads: async () => ({}),
    sweepCsfStagingObjects: async () => ({}),
  }),
);
const { GET } = await import("./route");

const keys = ["CRON_TOKEN", "CRON_SECRET"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterAll(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  process.env.CRON_TOKEN = "fictional-shared-token";
  process.env.CRON_SECRET = "fictional-vercel-secret";
  observationCalls.length = 0;
  cleanupCalls = 0;
});

function request(authorization?: string) {
  return new NextRequest("http://127.0.0.1/api/cron/csf-proof-cleanup", {
    headers: authorization ? { authorization } : {},
  });
}

test.each([
  undefined,
  "Bearer wrong",
  "bearer fictional-vercel-secret",
  "fictional-vercel-secret",
  "Bearer fictional-vercel-secret extra",
  "Bearer fictional-vercel-secre",
])("rejects invalid authorization %j before any cleanup", async (header) => {
  const response = await GET(request(header));
  expect(response.status).toBe(401);
  expect(cleanupCalls).toBe(0);
  expect(observationCalls).toHaveLength(0);
});

test("accepts both shared cron secrets when they differ", async () => {
  for (const token of ["fictional-shared-token", "fictional-vercel-secret"]) {
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  }
  expect(cleanupCalls).toBe(2);
  expect(observationCalls).toEqual(["csf-proof-cleanup", "csf-proof-cleanup"]);
});

test("reports a missing secret without authorizing the literal undefined value", async () => {
  for (const key of keys) delete process.env[key];
  const response = await GET(request("Bearer undefined"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Cron secret not configured",
  });
  expect(cleanupCalls).toBe(0);
  expect(observationCalls).toHaveLength(0);
});
