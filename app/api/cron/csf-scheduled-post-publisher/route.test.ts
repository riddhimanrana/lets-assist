import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const clientCalls: unknown[] = [];
const probeCalls: unknown[] = [];
const revalidationCalls: string[] = [];

let probeResponse: Response | null = null;
let revalidationFailureOrganization: string | null = null;
let rpcHandler: () => Promise<{ data: unknown; error: unknown }>;

mock.module("@/lib/cron/auth-shape-probe", () => ({
  cronAuthShapeProbe: (...args: unknown[]) => {
    probeCalls.push(args);
    return probeResponse;
  },
}));

mock.module("@/lib/plugins/supabase", () => ({
  createPluginAdminClient: (...args: unknown[]) => {
    clientCalls.push(args);
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return rpcHandler();
      },
    };
  },
}));

mock.module(
  "@/lib/plugins/private/plugins/dvhs-csf/server/actions/support-feed-revalidation",
  () => ({
    revalidateFeed: (organizationId: string) => {
      revalidationCalls.push(organizationId);
      if (organizationId === revalidationFailureOrganization) {
        throw new Error("synthetic cache failure");
      }
    },
  }),
);

const { GET, POST } = await import("./route");
const { NextRequest } = await import("next/server");

function request(headers: Record<string, string> = {}, method = "POST") {
  return new NextRequest(
    "http://localhost/api/cron/csf-scheduled-post-publisher",
    { method, headers },
  );
}

function literalAuthorization(authorization: string) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? authorization : null,
    },
  } as unknown as Parameters<typeof POST>[0];
}

function authorized(method = "POST") {
  return request(
    { authorization: "Bearer synthetic-scheduled-publisher-token" },
    method,
  );
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    examined: 0,
    published: 0,
    held: 0,
    holds: {
      pluginUnavailable: 0,
      actorUnavailable: 0,
      termUnavailable: 0,
      cohortUnavailable: 0,
      expired: 0,
      scheduledEmailUnsupported: 0,
    },
    organizationIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  clientCalls.length = 0;
  probeCalls.length = 0;
  revalidationCalls.length = 0;
  probeResponse = null;
  revalidationFailureOrganization = null;
  rpcHandler = async () => ({ data: report(), error: null });

  process.env.CSF_SCHEDULED_POST_PUBLISHER_SECRET_TOKEN =
    "synthetic-scheduled-publisher-token";
  process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = "false";
  delete process.env.CSF_SCHEDULED_POST_PUBLISHER_BATCH_SIZE;
  delete process.env.CRON_TOKEN;
  delete process.env.CRON_SECRET;
});

describe("CSF scheduled-post publisher route", () => {
  test("Vercel's CRON_SECRET authenticates GET while the exact opt-in remains disabled", async () => {
    delete process.env.CSF_SCHEDULED_POST_PUBLISHER_SECRET_TOKEN;
    process.env.CRON_SECRET = "synthetic-vercel-cron-secret";

    const response = await GET(
      request({ authorization: "Bearer synthetic-vercel-cron-secret" }, "GET"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: false,
      examined: 0,
      published: 0,
    });
    expect(probeCalls).toHaveLength(1);
    expect(clientCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(revalidationCalls).toHaveLength(0);
  });

  test("authentication and exact bearer grammar precede the probe and every database/cache boundary", async () => {
    const malformed = [
      "",
      "synthetic-scheduled-publisher-token",
      "bearer synthetic-scheduled-publisher-token",
      "Bearer  synthetic-scheduled-publisher-token",
      "Bearer synthetic-scheduled-publisher-token ",
      "Bearer synthetic\u0000-scheduled-publisher-token",
    ];

    for (const header of malformed) {
      const response = await POST(literalAuthorization(header));
      expect(response.status, header).toBe(401);
    }
    expect(probeCalls).toHaveLength(0);
    expect(clientCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(revalidationCalls).toHaveLength(0);
  });

  test("a missing configured token fails closed before any work", async () => {
    delete process.env.CSF_SCHEDULED_POST_PUBLISHER_SECRET_TOKEN;
    const response = await POST(
      request({ authorization: "Bearer attacker-controlled-token" }),
    );
    expect(response.status).toBe(401);
    expect(probeCalls).toHaveLength(0);
    expect(clientCalls).toHaveLength(0);
  });

  test("the isolated auth-shape probe terminates before the feature flag or database", async () => {
    probeResponse = Response.json(
      {
        ok: false,
        route: "csf-scheduled-post-publisher",
        mode: "auth-shape-v1",
        error: "cron_probe_required",
        dispatched: false,
      },
      { status: 428 },
    );
    process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = "true";

    const response = await POST(authorized());
    expect(response.status).toBe(428);
    expect(probeCalls).toHaveLength(1);
    expect(clientCalls).toHaveLength(0);
    expect(revalidationCalls).toHaveLength(0);
  });

  test("every value except exact true is disabled and touches no database", async () => {
    for (const value of ["false", "", "1", "TRUE", " true "]) {
      process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = value;
      const response = await POST(authorized());
      expect(response.status, value).toBe(200);
      expect(await response.json()).toEqual({
        enabled: false,
        retired: true,
        examined: 0,
        published: 0,
        held: 0,
        organizationsChanged: 0,
        cacheRefreshFailures: 0,
      });
    }
    expect(clientCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(revalidationCalls).toHaveLength(0);
  });

  test("legacy enable flags cannot publish through GET or POST", async () => {
    process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = "true";
    for (const handler of [GET, POST]) {
      const response = await handler(authorized());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        retired: true,
        enabled: false,
        published: 0,
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(clientCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(revalidationCalls).toHaveLength(0);
  });
});
