import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * WHO MAY MAKE THIS ROUTE SEND MAIL, and the exact opt-in that lets it.
 *
 * The behavior of an authorized pass -- fairness, deadlines, settlement -- lives
 * in `route.test.ts`. This file covers only the gate in front of it, and every
 * assertion here is a negative one: a disabled flag, an unauthenticated call, a
 * malformed Authorization form, or a missing secret must produce ZERO ledger
 * claims and ZERO provider sends. Everything real this route can cause is mail
 * to a real person, so "nothing happened" has to be provable rather than
 * assumed.
 *
 * The harness is deliberately duplicated from `route.test.ts` rather than
 * shared: each file mocks the provider, the logger, and the database at module
 * scope before importing the route, which is what makes the "zero work" claims
 * observable. Both are driven with no database, no provider, and no network, and
 * every fixture value is synthetic and uses reserved .test names.
 */

type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcResult = { data: unknown; error: unknown };
type MaybePromise<T> = T | Promise<T>;
const rpcCalls: RpcCall[] = [];
const sendCalls: Array<Record<string, unknown>> = [];

let schedulerScopeHandler: () => MaybePromise<RpcResult> = () => ({
  data: { organizationCount: 0, organizationIds: [] },
  error: null,
});
let schedulerAcknowledgementHandler: (
  args: Record<string, unknown>,
) => MaybePromise<RpcResult> = () => ({
  data: { acknowledged: true },
  error: null,
});
let maintenanceHandler: () => MaybePromise<RpcResult> = () => ({
  data: { checked: 0, terminalized: 0, nonterminal: 0, faults: 0 },
  error: null,
});
let claimHandler: (
  args: Record<string, unknown>,
) => MaybePromise<RpcResult> = () => ({
  data: { claimedCount: 0, claims: [] },
  error: null,
});
let authorizeHandler: (
  args: Record<string, unknown>,
) => MaybePromise<RpcResult>;
let settleHandler: (
  args: Record<string, unknown>,
) => MaybePromise<RpcResult> = () => ({
  data: { attemptState: "accepted" },
  error: null,
});

const ORG = "ce100000-0000-4000-8000-000000000001";
const CAMPAIGN = "ce400000-0000-4000-8000-000000000001";
const CAMPAIGN_TWO = "ce400000-0000-4000-8000-000000000002";
const ATTEMPT_TWO = "ce900000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = `csf-att-${"a".repeat(64)}-1`;
const DIGEST = "e".repeat(64);

let resendHandler: () => Promise<{
  data: { id: string } | null;
  error: unknown;
}> = async () => ({ data: { id: "resend-message-synthetic" }, error: null });

function authorizationFor(attemptId: string, attemptNumber: number) {
  const campaignId = attemptId === ATTEMPT_TWO ? CAMPAIGN_TWO : CAMPAIGN;
  const idempotencyKey =
    attemptNumber === 1 ? IDEMPOTENCY_KEY : `csf-att-${"b".repeat(64)}-1`;
  return {
    data: {
      authorized: true,
      organizationId: ORG,
      attemptId,
      deliveryId: `cea00000-0000-4000-8000-${attemptNumber.toString().padStart(12, "0")}`,
      coordinate: {
        organizationId: ORG,
        campaignId,
        recipientSnapshotId: `ce800000-0000-4000-8000-${attemptNumber.toString().padStart(12, "0")}`,
        attemptId,
        attemptNumber,
        contentHash: "c".repeat(64),
        recipientSnapshotHash: "d".repeat(64),
        deliveryRequirement: "broadcast",
        topicKey: "partner_clubs",
      },
      providerPayload: {
        from: "DVHS CSF <csf@notifications.lets-assist.com>",
        to: `rep.${attemptNumber}@local.test`,
        replyTo: "dvhighcsf@example.test",
        subject: "Synthetic bounded worker subject",
        text: "Synthetic body.",
        tags: [{ name: "csf_attempt_id", value: attemptId }],
        type: "transactional",
        idempotencyKey,
      },
      requestPayloadHash: DIGEST,
      providerIdempotencyKey: idempotencyKey,
    },
    error: null,
  };
}

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (
        payload: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => {
        sendCalls.push(payload);
        const providerResult = resendHandler();
        if (!options?.signal) return providerResult;
        if (options.signal.aborted) {
          const error = new Error("synthetic provider request aborted");
          error.name = "AbortError";
          throw error;
        }

        return new Promise((resolve, reject) => {
          const abort = () => {
            const error = new Error("synthetic provider request aborted");
            error.name = "AbortError";
            reject(error);
          };
          options.signal?.addEventListener("abort", abort, { once: true });
          providerResult.then(
            (value) => {
              options.signal?.removeEventListener("abort", abort);
              resolve(value);
            },
            (error) => {
              options.signal?.removeEventListener("abort", abort);
              reject(error);
            },
          );
        });
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
      if (fn === "csf_maintain_communication_campaigns")
        return maintenanceHandler();
      if (fn === "csf_claim_communication_scheduler_scope")
        return schedulerScopeHandler();
      if (fn === "csf_acknowledge_communication_scheduler_scope")
        return schedulerAcknowledgementHandler(args);
      if (fn === "csf_claim_communication_dispatch_batch")
        return claimHandler(args);
      if (fn === "csf_authorize_communication_dispatch")
        return authorizeHandler(args);
      if (fn === "csf_settle_communication_dispatch_attempt") {
        return settleHandler(args);
      }
      return { data: null, error: null };
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
  schedulerScopeHandler = () => ({
    data: { organizationCount: 0, organizationIds: [] },
    error: null,
  });
  schedulerAcknowledgementHandler = () => ({
    data: { acknowledged: true },
    error: null,
  });
  maintenanceHandler = () => ({
    data: { checked: 0, terminalized: 0, nonterminal: 0, faults: 0 },
    error: null,
  });
  claimHandler = () => ({ data: { claimedCount: 0, claims: [] }, error: null });
  authorizeHandler = (args) =>
    authorizationFor(
      String(args.p_attempt_id),
      args.p_attempt_id === ATTEMPT_TWO ? 2 : 1,
    );
  settleHandler = () => ({
    data: { attemptState: "accepted" },
    error: null,
  });
  resendHandler = async () => ({
    data: { id: "resend-message-synthetic" },
    error: null,
  });

  process.env.CRON_TOKEN = "synthetic-cron-token";
  delete process.env.CRON_SECRET;
  delete process.env.CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN;
  process.env.CSF_COMMUNICATIONS_WORKER_ENABLED = "true";
  delete process.env.CSF_COMMUNICATIONS_WORKER_BATCH_SIZE;
  delete process.env.CSF_COMMUNICATIONS_WORKER_DEADLINE_MS;
  delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
  process.env.SUPABASE_SECRET_KEY = "synthetic-secret-key";
  process.env.EMAIL_TRANSPORT = "resend";
  process.env.RESEND_API_KEY = "synthetic-resend-key";
});

describe("the bounded CSF dispatch worker route refuses every call it cannot authorize", () => {
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
        campaignsChecked: 0,
        campaignsTerminalized: 0,
        faults: 0,
        deadlineReached: false,
      });
      expect(rpcCalls, String(value)).toHaveLength(0);
      expect(sendCalls, String(value)).toHaveLength(0);
    }
  });

  test("GET uses the same authenticated exact-opt-in path and is never cached", async () => {
    delete process.env.CSF_COMMUNICATIONS_WORKER_ENABLED;

    const disabled = await GET(authorized("GET"));
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({ enabled: false, claimed: 0 });
    expect(disabled.headers.get("cache-control")).toContain("no-store");
    expect(sendCalls).toHaveLength(0);

    const unauthorized = await GET(request({}, "GET"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toContain("no-store");
    expect(sendCalls).toHaveLength(0);
  });

  test("an unauthenticated call claims nothing and sends nothing", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    // THE ASSERTION THAT MATTERS. Not "it returned 401" -- that the ledger was
    // never touched and no provider call was made.
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
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

      // Literal bytes, not a normalized request. See literalHeaderRequest.
      const response = await POST(literalHeaderRequest(header));

      expect(`${label}=${response.status}`).toBe(`${label}=401`);
      // Not merely a 401: the ledger was never touched and nothing was mailed.
      expect(`${label}=${rpcCalls.length}/${sendCalls.length}`).toBe(
        `${label}=0/0`,
      );
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
    expect(rpcCalls.map((call) => call.fn)).toEqual([
      "csf_maintain_communication_campaigns",
      "csf_claim_communication_scheduler_scope",
      "csf_maintain_communication_campaigns",
    ]);
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
});
