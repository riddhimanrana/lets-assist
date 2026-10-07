import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({ limit: async () => ({ error: null, count: 0 }) }),
    }),
  }),
}));

let controlsAvailable = true;
mock.module("@/lib/cron/csf-worker-controls", () => ({
  readCsfWorkerControls: async () => ({
    mode: "database",
    available: controlsAvailable,
    workers: {
      communications: false,
      import_commit: false,
      publication_notifications: false,
      scheduled_post_publisher: false,
      workbook_refresh: false,
    },
  }),
}));

const { isLocalSupabaseEndpoint } = await import("./status-utils");
const { GET } = await import("./route");

const testEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "status-fixture-server-secret",
  CRON_TOKEN: "status-fixture-cron-secret",
  PUBLIC_IMAGE_CLEANUP_ENABLED: undefined,
  CSF_OPERATIONAL_ALERTS_ENABLED: undefined,
};
const originalEnvironment = Object.fromEntries(
  Object.keys(testEnvironment).map((key) => [key, process.env[key]]),
);

function setEnvironment(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  setEnvironment(testEnvironment);
  controlsAvailable = true;
});
afterEach(() => setEnvironment(originalEnvironment));

describe("status worker configuration readback", () => {
  for (const [name, enabled] of [
    [undefined, false],
    ["false", false],
    ["TRUE", false],
    ["true ", false],
    ["true", true],
  ] as const) {
    test(`returns strict boolean worker flags for ${String(name)}`, async () => {
      setEnvironment({
        PUBLIC_IMAGE_CLEANUP_ENABLED: name,
        CSF_OPERATIONAL_ALERTS_ENABLED: name,
      });
      const response = await GET(
        new NextRequest("http://127.0.0.1/api/status?deep=0"),
      );
      const serialized = await response.text();
      const result = JSON.parse(serialized);
      const workers = result.checks.filter(
        (check: { name: string }) => check.name === "workers",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(workers).toHaveLength(1);
      expect(workers[0].details.publicImageCleanup).toBe(enabled);
      expect(workers[0].details.csfOperationalAlerts).toBe(enabled);
      expect(workers[0].details.csfControlMode).toBe("database");
      expect(serialized).not.toContain(testEnvironment.SUPABASE_SECRET_KEY);
      expect(serialized).not.toContain(testEnvironment.CRON_TOKEN);
      expect(serialized).not.toContain("PUBLIC_IMAGE_CLEANUP_ENABLED");
      expect(serialized).not.toContain("CSF_OPERATIONAL_ALERTS_ENABLED");
    });
  }

  test("unavailable database controls cannot claim a verified disabled posture", async () => {
    controlsAvailable = false;
    const response = await GET(
      new NextRequest("http://127.0.0.1/api/status?deep=0"),
    );
    const result = await response.json();
    const workers = result.checks.find(
      (check: { name: string }) => check.name === "workers",
    );
    expect(workers.state).toBe("fail");
    expect(workers.details).toBeUndefined();
  });
});

describe("status endpoint local Supabase detection", () => {
  test("accepts isolated localhost stacks on arbitrary ports", () => {
    expect(isLocalSupabaseEndpoint("http://127.0.0.1:56351")).toBe(true);
    expect(isLocalSupabaseEndpoint("http://localhost:65432")).toBe(true);
  });

  test("rejects hosted, malformed, and localhost-lookalike endpoints", () => {
    expect(isLocalSupabaseEndpoint("https://example.supabase.co")).toBe(false);
    expect(isLocalSupabaseEndpoint("https://localhost.example.com:54321")).toBe(
      false,
    );
    expect(isLocalSupabaseEndpoint("not a URL")).toBe(false);
  });
});
