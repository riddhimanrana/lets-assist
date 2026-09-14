import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

mock.module("server-only", () => ({}));
let workerCalls = 0;
let throwWorker = false;
let probeResponse: NextResponse | null = null;
let enabled = false;
const probeCalls: string[] = [];
mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/services/publication-notifications",
  () => ({
    runCsfPublicationNotificationWorker: async () => {
      workerCalls += 1;
      if (throwWorker)
        throw new Error("private-student@local.test secret-token source-id");
      return { claimed: 2, delivered: 1, skipped: 1, retryable: 0 };
    },
  }),
);
mock.module("@/lib/cron/auth-shape-probe", () => ({
  cronAuthShapeProbe: (route: string) => {
    probeCalls.push(route);
    return probeResponse;
  },
}));
mock.module("@/lib/cron/csf-worker-controls", () => ({
  isCsfWorkerEnabled: async (worker: string) => {
    expect(worker).toBe("publication_notifications");
    return enabled;
  },
}));
const { GET, POST } = await import("./route");
const keys = [
  "CSF_PUBLICATION_NOTIFICATIONS_SECRET_TOKEN",
  "CSF_PUBLICATION_NOTIFICATIONS_ENABLED",
  "CRON_TOKEN",
  "CRON_SECRET",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterAll(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  process.env.CSF_PUBLICATION_NOTIFICATIONS_SECRET_TOKEN =
    "fictional-cron-token";
  workerCalls = 0;
  throwWorker = false;
  probeResponse = null;
  probeCalls.length = 0;
  enabled = false;
});
function request(authorization?: string) {
  return new NextRequest(
    "http://127.0.0.1/api/cron/csf-publication-notifications",
    {
      headers: authorization ? { authorization } : {},
    },
  );
}
for (const [method, handler] of [
  ["GET", GET],
  ["POST", POST],
] as const) {
  test.each([
    undefined,
    "Bearer wrong",
    "bearer fictional-cron-token",
    "Bearer fictional-cron-token extra",
  ])(
    `${method} rejects invalid authorization %j before probing or claiming`,
    async (authorization) => {
      enabled = true;
      const response = await handler(request(authorization));
      expect(response.status).toBe(401);
      expect(workerCalls).toBe(0);
      expect(probeCalls).toHaveLength(0);
    },
  );
  test(`${method} remains off while its release control is disabled`, async () => {
      const response = await handler(request("Bearer fictional-cron-token"));
      expect(await response.json()).toEqual({ enabled: false });
      expect(workerCalls).toBe(0);
  });
  test(`${method} returns the isolated probe before entering an enabled worker`, async () => {
    enabled = true;
    probeResponse = NextResponse.json({ dispatched: false });
    expect(await handler(request("Bearer fictional-cron-token"))).toBe(
      probeResponse,
    );
    expect(probeCalls).toEqual(["csf-publication-notifications"]);
    expect(workerCalls).toBe(0);
  });
  test(`${method} returns aggregate delivery counts only`, async () => {
    enabled = true;
    const response = await handler(request("Bearer fictional-cron-token"));
    expect(await response.json()).toEqual({
      enabled: true,
      claimed: 2,
      delivered: 1,
      skipped: 1,
      retryable: 0,
    });
    expect(workerCalls).toBe(1);
  });
  test(`${method} redacts private exceptions`, async () => {
    enabled = true;
    throwWorker = true;
    const response = await handler(request("Bearer fictional-cron-token"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Worker run failed" });
    expect(workerCalls).toBe(1);
  });
}
test("a configured route secret takes precedence over the shared cron secret", async () => {
  process.env.CRON_SECRET = "other-fictional-token";
  expect((await POST(request("Bearer other-fictional-token"))).status).toBe(
    401,
  );
  delete process.env.CSF_PUBLICATION_NOTIFICATIONS_SECRET_TOKEN;
  expect((await POST(request("Bearer other-fictional-token"))).status).toBe(
    200,
  );
});
test("an absent secret cannot authorize the literal undefined value", async () => {
  delete process.env.CSF_PUBLICATION_NOTIFICATIONS_SECRET_TOKEN;
  expect((await POST(request("Bearer undefined"))).status).toBe(401);
  expect(workerCalls).toBe(0);
});
