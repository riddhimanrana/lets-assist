import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const clientCalls: unknown[] = [];
const probeCalls: unknown[] = [];
const revalidationCalls: string[] = [];

const ORG_A = "ca100000-0000-4000-8000-000000000001";
const ORG_B = "ca100000-0000-4000-8000-000000000002";

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

  test("an enabled call invokes only the bounded RPC, refreshes changed chapters, and returns aggregate truth", async () => {
    process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = "true";
    process.env.CSF_SCHEDULED_POST_PUBLISHER_BATCH_SIZE = "7";
    rpcHandler = async () => ({
      data: report({
        examined: 3,
        published: 2,
        held: 1,
        holds: {
          pluginUnavailable: 0,
          actorUnavailable: 1,
          termUnavailable: 0,
          cohortUnavailable: 0,
          expired: 0,
          scheduledEmailUnsupported: 0,
        },
        organizationIds: [ORG_A, ORG_B],
      }),
      error: null,
    });

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.name).toBe("csf_publish_due_posts");
    expect(rpcCalls[0]?.args.p_limit).toBe(7);
    expect(String(rpcCalls[0]?.args.p_worker_id)).toMatch(
      /^csf-scheduled-[a-z0-9]+-[0-9a-f]{8}$/,
    );
    expect(revalidationCalls).toEqual([ORG_A, ORG_B]);
    expect(body).toEqual({
      enabled: true,
      examined: 3,
      published: 2,
      held: 1,
      holds: {
        pluginUnavailable: 0,
        actorUnavailable: 1,
        termUnavailable: 0,
        cohortUnavailable: 0,
        expired: 0,
        scheduledEmailUnsupported: 0,
      },
      organizationsChanged: 2,
      cacheRefreshFailures: 0,
      batchSize: 7,
    });
    expect(JSON.stringify(body)).not.toContain(ORG_A);
    expect(JSON.stringify(body)).not.toContain(ORG_B);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("emailqueued");
  });

  test("cache refresh failure is reported separately after durable publication", async () => {
    process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = "true";
    revalidationFailureOrganization = ORG_B;
    rpcHandler = async () => ({
      data: report({
        examined: 2,
        published: 2,
        organizationIds: [ORG_A, ORG_B],
      }),
      error: null,
    });

    const response = await POST(authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      published: 2,
      cacheRefreshFailures: 1,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(revalidationCalls).toEqual([ORG_A, ORG_B]);
  });

  test("RPC errors and malformed or unbalanced reports fail closed without cache work", async () => {
    process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = "true";

    rpcHandler = async () => ({
      data: null,
      error: { message: "sensitive database detail" },
    });
    let response = await POST(authorized());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Scheduled post publisher unavailable",
    });
    expect(revalidationCalls).toHaveLength(0);

    rpcHandler = async () => ({
      data: report({ examined: 2, published: 2, held: 1 }),
      error: null,
    });
    response = await POST(authorized());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Scheduled post publisher returned invalid data",
    });
    expect(revalidationCalls).toHaveLength(0);

    rpcHandler = async () => ({
      data: report({ organizationIds: [ORG_A] }),
      error: null,
    });
    response = await POST(authorized());
    expect(response.status).toBe(503);
    expect(revalidationCalls).toHaveLength(0);
  });

  test("GET uses the same authenticated, feature-gated implementation", async () => {
    process.env.CSF_SCHEDULED_POST_PUBLISHER_ENABLED = "true";
    const response = await GET(authorized("GET"));
    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(revalidationCalls).toHaveLength(0);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
