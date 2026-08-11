import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * The bounded worker invocation path, driven with no database, no provider, and
 * no network.
 *
 * The two assertions that matter most are negative ones: an unauthorized call and
 * a malformed environment must both produce ZERO ledger claims and ZERO provider
 * sends. Everything real that this route can cause is mail to a real person, so
 * "nothing happened" has to be provable rather than assumed.
 *
 * Every fixture value is synthetic and uses reserved .test names.
 */

type RpcCall = { fn: string; args: Record<string, unknown> };
const rpcCalls: RpcCall[] = [];
const sendCalls: Array<Record<string, unknown>> = [];
const fromCalls: string[] = [];

let queuedRows: Array<{ organization_id: string }> = [];
let queueError: { message: string } | null = null;
let claimHandler: () => { data: unknown; error: unknown } = () => ({
  data: { claimedCount: 0, claims: [] },
  error: null,
});

const ORG = "ce100000-0000-4000-8000-000000000001";
const ATTEMPT = "ce900000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = `csf-att-${"a".repeat(64)}-1`;
const DIGEST = "e".repeat(64);

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        sendCalls.push(payload);
        return { data: { id: "resend-message-synthetic" }, error: null };
      },
    };
  },
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error(
      "notification settings must not be queried for CSF dispatch",
    );
  },
}));
mock.module("react-email", () => ({
  render: async () => "<p>x</p>",
}));

/**
 * Everything the permitted logger is asked to emit, recorded rather than dropped.
 *
 * A no-op logger mock cannot distinguish "the route logged nothing sensitive"
 * from "the route logged the Authorization header and the assertion had nothing
 * to look at".
 */
const logged: unknown[] = [];
mock.module("@/lib/logger", () => ({
  logError: (...args: unknown[]) => {
    logged.push(args);
  },
  logInfo: (...args: unknown[]) => {
    logged.push(args);
  },
  logWarn: (...args: unknown[]) => {
    logged.push(args);
  },
}));

mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "csf_claim_communication_dispatch_batch")
        return claimHandler();
      if (fn === "csf_authorize_communication_dispatch") {
        return {
          data: {
            authorized: true,
            organizationId: ORG,
            attemptId: ATTEMPT,
            deliveryId: "cea00000-0000-4000-8000-000000000001",
            coordinate: {
              organizationId: ORG,
              campaignId: "ce400000-0000-4000-8000-000000000001",
              recipientSnapshotId: "ce800000-0000-4000-8000-000000000001",
              attemptId: ATTEMPT,
              attemptNumber: 1,
              contentHash: "c".repeat(64),
              recipientSnapshotHash: "d".repeat(64),
              deliveryRequirement: "broadcast",
              topicKey: "partner_clubs",
            },
            providerPayload: {
              from: "DVHS CSF <csf@notifications.lets-assist.com>",
              to: "rep.one@local.test",
              replyTo: "dvhighcsf@example.test",
              subject: "Synthetic bounded worker subject",
              text: "Synthetic body.",
              tags: [{ name: "csf_attempt_id", value: ATTEMPT }],
              type: "transactional",
              idempotencyKey: IDEMPOTENCY_KEY,
            },
            requestPayloadHash: DIGEST,
            providerIdempotencyKey: IDEMPOTENCY_KEY,
          },
          error: null,
        };
      }
      if (fn === "csf_settle_communication_dispatch_attempt") {
        return { data: { attemptState: "accepted" }, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      fromCalls.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: async () => ({ data: queuedRows, error: queueError }),
      };
      return builder;
    },
  }),
}));

const { GET, POST } = await import("./route");
const { NextRequest } = await import("next/server");

function request(
  headers: Record<string, string> = {},
  method: "GET" | "POST" = "POST",
) {
  return new NextRequest(
    "http://localhost/api/cron/csf-communications-dispatch",
    { method, headers },
  );
}

function authorized(method: "GET" | "POST" = "POST") {
  return request({ authorization: "Bearer synthetic-cron-token" }, method);
}

/**
 * A request carrying the EXACT header bytes, with no Fetch normalization.
 *
 * `new Request(...)`/`NextRequest` run the Fetch header algorithm, which strips
 * leading and trailing HTTP whitespace from a value and rejects several control
 * bytes outright. So `" Bearer <secret>"` reaches a real route as
 * `"Bearer <secret>"`, and a test that asserted 401 through a real request would
 * be asserting against a value the route never sees -- proving nothing about the
 * grammar and failing for the wrong reason.
 *
 * The route reads exactly one thing from the request, `headers.get("authorization")`,
 * so a stub that answers that call is a faithful stand-in for a hostile client or
 * a proxy that forwards bytes a stricter server would have rejected.
 */
function literalHeaderRequest(authorization: string) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? authorization : null,
    },
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  rpcCalls.length = 0;
  sendCalls.length = 0;
  fromCalls.length = 0;
  queuedRows = [];
  queueError = null;
  claimHandler = () => ({ data: { claimedCount: 0, claims: [] }, error: null });

  process.env.CRON_TOKEN = "synthetic-cron-token";
  delete process.env.CRON_SECRET;
  delete process.env.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN;
  process.env.CSF_COMMUNICATIONS_WORKER_ENABLED = "true";
  delete process.env.CSF_COMMUNICATIONS_WORKER_BATCH_SIZE;
  delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
  process.env.SUPABASE_SECRET_KEY = "synthetic-secret-key";
  process.env.EMAIL_TRANSPORT = "resend";
  process.env.RESEND_API_KEY = "synthetic-resend-key";
});

describe("the bounded CSF dispatch worker route", () => {
  test("every value except exact true is disabled with zero database or provider work", async () => {
    const disabledValues: Array<string | undefined> = [
      undefined,
      "",
      "false",
      "1",
      "TRUE",
      " true ",
    ];

    for (const value of disabledValues) {
      if (value === undefined) {
        delete process.env.CSF_COMMUNICATIONS_WORKER_ENABLED;
      } else {
        process.env.CSF_COMMUNICATIONS_WORKER_ENABLED = value;
      }

      const response = await POST(authorized());
      expect(response.status, String(value)).toBe(200);
      expect(await response.json()).toEqual({
        enabled: false,
        organizationsQueued: 0,
        organizationsProcessed: 0,
        claimed: 0,
        outcomes: {
          sent: 0,
          refused: 0,
          failed: 0,
          retryable: 0,
          unknown: 0,
          authorization_lost: 0,
        },
        faults: 0,
        deadlineReached: false,
      });
      expect(rpcCalls, String(value)).toHaveLength(0);
      expect(sendCalls, String(value)).toHaveLength(0);
      expect(fromCalls, String(value)).toHaveLength(0);
    }
  });

  test("GET uses the same authenticated exact-opt-in path and is never cached", async () => {
    delete process.env.CSF_COMMUNICATIONS_WORKER_ENABLED;

    const disabled = await GET(authorized("GET"));
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({ enabled: false, claimed: 0 });
    expect(disabled.headers.get("cache-control")).toContain("no-store");
    expect(fromCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);

    const unauthorized = await GET(request({}, "GET"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toContain("no-store");
    expect(fromCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("an unauthenticated call claims nothing and sends nothing", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    // THE ASSERTION THAT MATTERS. Not "it returned 401" -- that the ledger was
    // never touched and no provider call was made.
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
    expect(fromCalls).toHaveLength(0);
  });

  test("every malformed Authorization form is rejected with zero work", async () => {
    // The previous reader was `authHeader.replace("Bearer ", "")`. With a string
    // pattern, `replace` removes the FIRST occurrence if present and otherwise
    // returns the input unchanged -- so a header carrying the bare secret with no
    // scheme authenticated, and several stray-prefix forms did too.
    const malformed: Array<[string, string]> = [
      // The bare secret. This one authenticated before.
      ["bare secret, no scheme", "synthetic-cron-token"],
      ["lowercase scheme", "bearer synthetic-cron-token"],
      ["uppercase scheme", "BEARER synthetic-cron-token"],
      ["mixed-case scheme", "BeArEr synthetic-cron-token"],
      ["no space", "Bearersynthetic-cron-token"],
      ["two spaces", "Bearer  synthetic-cron-token"],
      ["tab separator", "Bearer\tsynthetic-cron-token"],
      ["leading space", " Bearer synthetic-cron-token"],
      ["trailing space", "Bearer synthetic-cron-token "],
      ["trailing newline", "Bearer synthetic-cron-token\n"],
      ["trailing carriage return", "Bearer synthetic-cron-token\r"],
      ["embedded newline", "Bearer synthetic\n-cron-token"],
      ["embedded NUL", "Bearer synthetic\u0000-cron-token"],
      ["embedded escape", "Bearer synthetic\u001b-cron-token"],
      ["duplicate prefix", "Bearer Bearer synthetic-cron-token"],
      ["prefix suffix", "xBearer synthetic-cron-token"],
      ["scheme only", "Bearer"],
      ["scheme and space only", "Bearer "],
      ["empty", ""],
      ["other scheme", "Basic synthetic-cron-token"],
      ["token then junk", "Bearer synthetic-cron-token extra"],
    ];

    for (const [label, header] of malformed) {
      rpcCalls.length = 0;
      sendCalls.length = 0;
      fromCalls.length = 0;

      // Literal bytes, not a normalized request. See literalHeaderRequest.
      const response = await POST(literalHeaderRequest(header));

      expect(`${label}=${response.status}`).toBe(`${label}=401`);
      // Not merely a 401: the ledger was never touched and nothing was mailed.
      expect(
        `${label}=${rpcCalls.length}/${sendCalls.length}/${fromCalls.length}`,
      ).toBe(`${label}=0/0/0`);
    }
  });

  test("a real request rejects the malformed forms that survive header normalization", async () => {
    // The subset the Fetch header algorithm passes through unchanged, so this
    // exercises the same grammar against a genuine NextRequest end to end. Outer
    // whitespace and control bytes are deliberately absent here: Fetch strips or
    // rejects those, which is why the case above uses literal bytes instead.
    const survivesNormalization = [
      "synthetic-cron-token",
      "bearer synthetic-cron-token",
      "BEARER synthetic-cron-token",
      "Bearersynthetic-cron-token",
      "Bearer  synthetic-cron-token",
      "Bearer Bearer synthetic-cron-token",
      "xBearer synthetic-cron-token",
      "Bearer",
      "Basic synthetic-cron-token",
      "Bearer synthetic-cron-token extra",
    ];

    for (const header of survivesNormalization) {
      rpcCalls.length = 0;
      sendCalls.length = 0;

      const response = await POST(request({ authorization: header }));

      expect(`${header}=${response.status}`).toBe(`${header}=401`);
      expect(`${header}=${rpcCalls.length}/${sendCalls.length}`).toBe(
        `${header}=0/0`,
      );
    }
  });

  test("the literal stub and a real request agree on the valid form", async () => {
    // Guards the stub itself: if it diverged from a real request, every negative
    // case above would be proving something about the stub rather than the route.
    expect(
      (await POST(literalHeaderRequest("Bearer synthetic-cron-token"))).status,
    ).toBe(200);
    expect((await POST(authorized())).status).toBe(200);
  });

  test("the exact Bearer grammar is accepted", async () => {
    const response = await POST(
      request({ authorization: "Bearer synthetic-cron-token" }),
    );

    expect(response.status).toBe(200);
  });

  test("a secret sharing a prefix with the real one is rejected", async () => {
    // Guards the constant-time comparison: a prefix match must not authenticate,
    // and neither must a longer string that starts with the secret.
    for (const candidate of [
      "synthetic-cron-toke",
      "synthetic-cron-tokenX",
      "synthetic",
      "Synthetic-Cron-Token",
    ]) {
      const response = await POST(
        request({ authorization: `Bearer ${candidate}` }),
      );
      expect(`${candidate}=${response.status}`).toBe(`${candidate}=401`);
    }
  });

  test("the dedicated worker token is accepted under the same grammar", async () => {
    delete process.env.CRON_TOKEN;
    delete process.env.CRON_SECRET;
    process.env.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN =
      "synthetic-worker-token";

    expect(
      (await POST(request({ authorization: "Bearer synthetic-worker-token" })))
        .status,
    ).toBe(200);
    // The bare secret is still not a credential, whichever variable supplied it.
    expect(
      (await POST(request({ authorization: "synthetic-worker-token" }))).status,
    ).toBe(401);

    delete process.env.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN;
    process.env.CRON_TOKEN = "synthetic-cron-token";
  });

  test("Vercel's CRON_SECRET authenticates the scheduled GET when CRON_TOKEN is absent", async () => {
    delete process.env.CRON_TOKEN;
    process.env.CRON_SECRET = "synthetic-vercel-cron-secret";

    const response = await GET(
      request({ authorization: "Bearer synthetic-vercel-cron-secret" }, "GET"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, claimed: 0 });
    expect(fromCalls).toEqual(["csf_communication_dispatch_attempts"]);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("neither the header nor the secret is ever logged", async () => {
    // Two channels can leak a credential: the permitted logger, and a bare
    // console call that bypassed it. Both are captured, and the console is
    // restored before the assertions run so a failure still prints.
    const consoleCalls: unknown[] = [];
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      console[level] = ((...args: unknown[]) => {
        consoleCalls.push(args);
      }) as typeof console.log;
    }

    logged.length = 0;
    try {
      await POST(request({ authorization: "Bearer synthetic-cron-token" }));
      await POST(request({ authorization: "Bearer wrong-secret-value" }));
      await POST(literalHeaderRequest("synthetic-cron-token"));
    } finally {
      Object.assign(console, original);
    }

    const serialized = JSON.stringify({ logged, consoleCalls });
    for (const fragment of [
      "synthetic-cron-token",
      "wrong-secret-value",
      "synthetic-worker-token",
      "Bearer",
      "authorization",
    ]) {
      expect(serialized).not.toContain(fragment);
    }
  });

  test("a wrong bearer token claims nothing and sends nothing", async () => {
    const response = await POST(
      request({ authorization: "Bearer not-the-cron-token" }),
    );

    expect(response.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("a browser-shaped call with a session cookie is still unauthorized", async () => {
    // No bearer token. A signed-in browser must not be able to drive the worker
    // merely by being signed in.
    const response = await POST(
      request({ cookie: "sb-access-token=synthetic-session" }),
    );

    expect(response.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("no configured secret means no access, rather than open access", async () => {
    delete process.env.CRON_TOKEN;
    delete process.env.CRON_SECRET;
    delete process.env.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN;

    const response = await POST(authorized());

    expect(response.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
    process.env.CRON_TOKEN = "synthetic-cron-token";
  });

  test("a malformed transport environment claims nothing and sends nothing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("an unreadable queue claims nothing and sends nothing", async () => {
    queueError = { message: "relation csf_communication_dispatch_attempts" };

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
    // The database's own message never reaches the caller.
    expect(JSON.stringify(await response.json())).not.toContain(
      "csf_communication_dispatch_attempts",
    );
  });

  test("an empty queue does no work at all", async () => {
    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organizationsQueued).toBe(0);
    expect(body.claimed).toBe(0);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("the organization scope is derived from the ledger, never from the request", async () => {
    queuedRows = [{ organization_id: ORG }, { organization_id: ORG }];

    await POST(
      new NextRequest(
        "http://localhost/api/cron/csf-communications-dispatch?organizationId=ce100000-0000-4000-8000-000000000099",
        {
          method: "POST",
          headers: { authorization: "Bearer synthetic-cron-token" },
          body: JSON.stringify({
            organizationId: "ce100000-0000-4000-8000-000000000099",
            to: "attacker@example.test",
            subject: "Injected",
          }),
        },
      ),
    );

    // The queue named one organization, twice. The worker ran for that one, and
    // never for the one the caller tried to name.
    expect(fromCalls).toEqual(["csf_communication_dispatch_attempts"]);
    const claims = rpcCalls.filter(
      (call) => call.fn === "csf_claim_communication_dispatch_batch",
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].args.p_organization_id).toBe(ORG);
    expect(JSON.stringify(rpcCalls)).not.toContain("000000000099");
    expect(JSON.stringify(rpcCalls)).not.toContain("attacker@example.test");
  });

  test("authorized work is bounded and the batch size is clamped", async () => {
    queuedRows = [{ organization_id: ORG }];
    process.env.CSF_COMMUNICATIONS_WORKER_BATCH_SIZE = "100000";

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    const claim = rpcCalls.find(
      (call) => call.fn === "csf_claim_communication_dispatch_batch",
    );
    expect(claim?.args.p_batch_size).toBe(50);
    expect(body.batchSize).toBe(50);
    delete process.env.CSF_COMMUNICATIONS_WORKER_BATCH_SIZE;
  });

  test("authorized work dispatches claimed attempts and reports aggregates only", async () => {
    queuedRows = [{ organization_id: ORG }];
    claimHandler = () => ({
      data: {
        claimedCount: 1,
        claims: [
          {
            attemptId: ATTEMPT,
            campaignId: "ce400000-0000-4000-8000-000000000001",
            deliveryId: "cea00000-0000-4000-8000-000000000001",
            recipientSnapshotId: "ce800000-0000-4000-8000-000000000001",
            attemptNumber: 1,
            providerIdempotencyKey: IDEMPOTENCY_KEY,
            requestPayloadHash: DIGEST,
            leaseExpiresAt: "2032-04-01T10:02:00.000Z",
            requiresDispatchAuthorization: true,
          },
        ],
      },
      error: null,
    });

    const response = await POST(authorized());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.claimed).toBe(1);
    expect(body.outcomes.sent).toBe(1);
    expect(sendCalls).toHaveLength(1);

    // SANITIZED RESPONSE. Aggregates only -- nothing that identifies a recipient,
    // a message, or a ledger row.
    expect(serialized).not.toContain("rep.one@local.test");
    expect(serialized).not.toContain(ATTEMPT);
    expect(serialized).not.toContain(IDEMPOTENCY_KEY);
    expect(serialized).not.toContain("resend-message-synthetic");
    expect(serialized).not.toContain("Synthetic bounded worker subject");
    expect(serialized).not.toContain("Synthetic body.");
  });

  test("a worker fault for one organization is bounded and leaks nothing", async () => {
    queuedRows = [{ organization_id: ORG }];
    claimHandler = () => ({
      data: null,
      error: {
        message:
          "row csf_communication_dispatch_attempts for rep.one@local.test",
        code: "08006",
      },
    });

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.faults).toBe(1);
    expect(body.claimed).toBe(0);
    // Nothing was claimed, so nothing was sent.
    expect(sendCalls).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("rep.one@local.test");
  });
});
