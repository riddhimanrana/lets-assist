import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * The bounded worker invocation path, driven with no database, no provider, and
 * no network.
 *
 * This file covers what an AUTHORIZED pass does: environment refusal, scheduler
 * scope and reservation handling, lease recovery, cross-tenant fairness, the
 * absolute deadline, and settlement. The gate in front of it -- the exact opt-in
 * flag and the bearer grammar -- is in `route-authorization.test.ts`.
 *
 * Everything real that this route can cause is mail to a real person, so
 * "nothing happened" is asserted directly rather than assumed wherever a pass is
 * supposed to stop early.
 *
 * Every fixture value is synthetic and uses reserved .test names.
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
const ORG_TWO = "ce100000-0000-4000-8000-000000000002";
const CAMPAIGN = "ce400000-0000-4000-8000-000000000001";
const CAMPAIGN_TWO = "ce400000-0000-4000-8000-000000000002";
const ATTEMPT = "ce900000-0000-4000-8000-000000000001";
const ATTEMPT_TWO = "ce900000-0000-4000-8000-000000000002";
const RESERVATION = "ceb00000-0000-4000-8000-000000000001";
const RESERVATION_TWO = "ceb00000-0000-4000-8000-000000000002";
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

const { POST } = await import("./route");
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

describe("the bounded CSF dispatch worker route", () => {
  test("a malformed transport environment claims nothing and sends nothing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("an unreadable scheduler scope claims nothing and sends nothing", async () => {
    schedulerScopeHandler = () => ({
      data: null,
      error: {
        message:
          "scheduler scope for rep.one@local.test is temporarily unavailable",
      },
    });

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(rpcCalls.map((call) => call.fn)).toEqual([
      "csf_maintain_communication_campaigns",
      "csf_claim_communication_scheduler_scope",
    ]);
    expect(sendCalls).toHaveLength(0);
    // The database's own message never reaches the caller.
    expect(JSON.stringify(await response.json())).not.toContain(
      "rep.one@local.test",
    );
  });

  test("an empty durable scheduler scope claims and sends nothing", async () => {
    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organizationsQueued).toBe(0);
    expect(body.claimed).toBe(0);
    expect(rpcCalls.map((call) => call.fn)).toEqual([
      "csf_maintain_communication_campaigns",
      "csf_claim_communication_scheduler_scope",
      "csf_maintain_communication_campaigns",
    ]);
    expect(sendCalls).toHaveLength(0);
  });

  test("stalled preflight maintenance is also bounded by the absolute route deadline", async () => {
    process.env.CSF_COMMUNICATIONS_WORKER_DEADLINE_MS = "20";
    maintenanceHandler = () => new Promise(() => undefined);

    const wallStartedAt = Date.now();
    const response = await POST(authorized());
    const wallDurationMs = Date.now() - wallStartedAt;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deadlineReached).toBe(true);
    expect(wallDurationMs).toBeLessThan(500);
    expect(rpcCalls.map((call) => call.fn)).toEqual([
      "csf_maintain_communication_campaigns",
    ]);
    expect(sendCalls).toHaveLength(0);
  });

  test("a late scope response leaves its reservation unacknowledged and starts no worker", async () => {
    process.env.CSF_COMMUNICATIONS_WORKER_DEADLINE_MS = "80";
    schedulerScopeHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return {
        data: {
          organizationCount: 1,
          organizationIds: [ORG],
          reservationId: RESERVATION,
        },
        error: null,
      };
    };

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deadlineReached).toBe(true);
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_acknowledge_communication_scheduler_scope",
      ),
    ).toHaveLength(0);
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_claim_communication_dispatch_batch",
      ),
    ).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("a scope without its reservation coordinate is refused before claim", async () => {
    schedulerScopeHandler = () => ({
      data: { organizationCount: 1, organizationIds: [ORG] },
      error: null,
    });

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_claim_communication_dispatch_batch",
      ),
    ).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("an expired or mismatched reservation is refused before claim", async () => {
    schedulerScopeHandler = () => ({
      data: {
        organizationCount: 1,
        organizationIds: [ORG],
        reservationId: RESERVATION,
      },
      error: null,
    });
    schedulerAcknowledgementHandler = () => ({
      data: { acknowledged: false },
      error: null,
    });

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.faults).toBe(1);
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_claim_communication_dispatch_batch",
      ),
    ).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("an expired processing-only scope reaches lease recovery without a resend", async () => {
    schedulerScopeHandler = () => ({
      data: {
        organizationCount: 1,
        organizationIds: [ORG],
        reservationId: RESERVATION,
      },
      error: null,
    });
    claimHandler = () => ({
      data: { claimedCount: 0, reapedUnknownOutcomes: 1, claims: [] },
      error: null,
    });

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organizationsQueued).toBe(1);
    expect(body.organizationsProcessed).toBe(1);
    expect(body.claimed).toBe(0);
    expect(sendCalls).toHaveLength(0);
    // The allocator is asked a second time, because an empty claim is not a
    // reason to abandon the invocation. It answers with the same tenant -- this
    // handler only ever knows one -- and the route recognizes a tenant it has
    // already found empty and stops rather than spinning on it.
    expect(rpcCalls.map((call) => call.fn)).toEqual([
      "csf_maintain_communication_campaigns",
      "csf_claim_communication_scheduler_scope",
      "csf_acknowledge_communication_scheduler_scope",
      "csf_claim_communication_dispatch_batch",
      "csf_claim_communication_scheduler_scope",
      "csf_maintain_communication_campaigns",
    ]);
    // Exactly once. The second scope answer is not re-reserved or re-claimed.
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_acknowledge_communication_scheduler_scope",
      ),
    ).toHaveLength(1);
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_claim_communication_dispatch_batch",
      ),
    ).toHaveLength(1);
  });

  // THE FAIRNESS DEFECT THIS FILE PREVIOUSLY CODIFIED.
  //
  // A tenant whose queue drained between the allocator's eligibility snapshot
  // and the claim used to end the whole invocation. Every other chapter with
  // queued announcements then waited for the next tick -- ten minutes of
  // withheld service caused by an empty queue somewhere else, with roughly the
  // entire wall-clock budget unused.
  test("a tenant that turns out to be empty does not withhold the run from the next tenant", async () => {
    let scopeCalls = 0;
    schedulerScopeHandler = () => {
      scopeCalls += 1;
      if (scopeCalls === 1) {
        return {
          data: {
            organizationCount: 1,
            organizationIds: [ORG],
            reservationId: RESERVATION,
          },
          error: null,
        };
      }
      if (scopeCalls === 2) {
        return {
          data: {
            organizationCount: 1,
            organizationIds: [ORG_TWO],
            reservationId: RESERVATION_TWO,
          },
          error: null,
        };
      }
      return {
        data: {
          organizationCount: 0,
          organizationIds: [],
          reservationId: null,
        },
        error: null,
      };
    };
    claimHandler = (args) =>
      args.p_organization_id === ORG
        ? { data: { claimedCount: 0, claims: [] }, error: null }
        : {
            data: {
              claimedCount: 1,
              claims: [
                {
                  attemptId: ATTEMPT,
                  campaignId: CAMPAIGN,
                  deliveryId: "cea00000-0000-4000-8000-000000000001",
                  recipientSnapshotId: "ce800000-0000-4000-8000-000000000001",
                  attemptNumber: 1,
                  providerIdempotencyKey: IDEMPOTENCY_KEY,
                  requestPayloadHash: DIGEST,
                  leaseExpiresAt: "2032-04-01T10:02:00.000Z",
                },
              ],
            },
            error: null,
          };

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    // The second tenant's queued announcement went out in the same invocation.
    expect(body.claimed).toBe(1);
    expect(body.outcomes.sent).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(
      rpcCalls
        .filter((call) => call.fn === "csf_claim_communication_dispatch_batch")
        .map((call) => call.args.p_organization_id),
    ).toEqual([ORG, ORG_TWO]);
  });

  test("a lost finalizer result remains discoverable and is retried without another send", async () => {
    let maintenanceCalls = 0;
    maintenanceHandler = () => {
      maintenanceCalls += 1;
      return maintenanceCalls <= 2
        ? {
            data: null,
            error: {
              message:
                "campaign row for rep.one@local.test could not be aggregated",
            },
          }
        : {
            data: {
              checked: maintenanceCalls === 3 ? 1 : 0,
              terminalized: maintenanceCalls === 3 ? 1 : 0,
              nonterminal: 0,
              faults: 0,
            },
            error: null,
          };
    };

    const first = await POST(authorized());
    const firstBody = await first.json();
    const second = await POST(authorized());
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody.faults).toBe(2);
    expect(second.status).toBe(200);
    expect(secondBody.faults).toBe(0);
    expect(secondBody.campaignsTerminalized).toBe(1);
    expect(maintenanceCalls).toBe(4);
    expect(sendCalls).toHaveLength(0);
    expect(JSON.stringify({ firstBody, secondBody })).not.toContain(
      "rep.one@local.test",
    );
  });

  test("the organization scope is derived from the ledger, never from the request", async () => {
    schedulerScopeHandler = () => ({
      data: {
        organizationCount: 2,
        organizationIds: [ORG, ORG],
        reservationId: RESERVATION,
      },
      error: null,
    });

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

    // The service-only scheduler scope named one organization twice. The route
    // deduplicated it and never trusted the tenant or payload in the request.
    const claims = rpcCalls.filter(
      (call) => call.fn === "csf_claim_communication_dispatch_batch",
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].args.p_organization_id).toBe(ORG);
    expect(JSON.stringify(rpcCalls)).not.toContain("000000000099");
    expect(JSON.stringify(rpcCalls)).not.toContain("attacker@example.test");
  });

  test("each reserved tenant is acknowledged immediately before its worker pass", async () => {
    const scopes = [[ORG], [ORG_TWO], []];
    let scopeCall = 0;
    schedulerScopeHandler = () => {
      const organizationIds = scopes[scopeCall] ?? [];
      scopeCall += 1;
      return {
        data: {
          organizationCount: organizationIds.length,
          organizationIds,
          reservationId:
            organizationIds[0] === ORG
              ? RESERVATION
              : organizationIds[0] === ORG_TWO
                ? RESERVATION_TWO
                : null,
        },
        error: null,
      };
    };
    claimHandler = () => ({
      data: {
        claimedCount: 1,
        claims: [
          {
            attemptId: ATTEMPT,
            campaignId: CAMPAIGN,
            deliveryId: "cea00000-0000-4000-8000-000000000001",
            recipientSnapshotId: "ce800000-0000-4000-8000-000000000001",
            attemptNumber: 1,
            providerIdempotencyKey: IDEMPOTENCY_KEY,
            requestPayloadHash: DIGEST,
            leaseExpiresAt: "2032-04-01T10:02:00.000Z",
          },
        ],
      },
      error: null,
    });

    const response = await POST(authorized());
    const body = await response.json();
    const scopeCalls = rpcCalls.filter(
      (call) => call.fn === "csf_claim_communication_scheduler_scope",
    );
    const claims = rpcCalls.filter(
      (call) => call.fn === "csf_claim_communication_dispatch_batch",
    );
    const acknowledgements = rpcCalls.filter(
      (call) => call.fn === "csf_acknowledge_communication_scheduler_scope",
    );

    expect(response.status).toBe(200);
    expect(body.organizationsQueued).toBe(2);
    expect(body.organizationsProcessed).toBe(2);
    expect(scopeCalls.map((call) => call.args.p_max_organizations)).toEqual([
      1, 1, 1,
    ]);
    expect(
      acknowledgements.map((call) => [
        call.args.p_organization_id,
        call.args.p_reservation_id,
      ]),
    ).toEqual([
      [ORG, RESERVATION],
      [ORG_TWO, RESERVATION_TWO],
    ]);
    expect(claims.map((call) => call.args.p_organization_id)).toEqual([
      ORG,
      ORG_TWO,
    ]);
  });

  test("one stalled provider call is aborted early enough to settle unknown before the absolute deadline", async () => {
    process.env.CSF_COMMUNICATIONS_WORKER_DEADLINE_MS = "40";
    let scopeCalls = 0;
    schedulerScopeHandler = () => {
      scopeCalls += 1;
      return {
        data: {
          organizationCount: scopeCalls === 1 ? 1 : 0,
          organizationIds: scopeCalls === 1 ? [ORG] : [],
          reservationId: scopeCalls === 1 ? RESERVATION : null,
        },
        error: null,
      };
    };
    claimHandler = () => ({
      data: {
        claimedCount: 1,
        claims: [
          {
            attemptId: ATTEMPT,
            campaignId: CAMPAIGN,
            deliveryId: "cea00000-0000-4000-8000-000000000001",
            recipientSnapshotId: "ce800000-0000-4000-8000-000000000001",
            attemptNumber: 1,
            providerIdempotencyKey: IDEMPOTENCY_KEY,
            requestPayloadHash: DIGEST,
            leaseExpiresAt: "2032-04-01T10:02:00.000Z",
          },
        ],
      },
      error: null,
    });
    resendHandler = () => new Promise(() => undefined);

    const wallStartedAt = Date.now();
    const response = await POST(authorized());
    const wallDurationMs = Date.now() - wallStartedAt;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcomes.unknown).toBe(1);
    expect(wallDurationMs).toBeLessThan(500);
    expect(sendCalls).toHaveLength(1);
    const settlements = rpcCalls.filter(
      (call) => call.fn === "csf_settle_communication_dispatch_attempt",
    );
    expect(settlements).toHaveLength(1);
    expect(settlements[0].args.p_outcome).toBe("unknown_outcome");
    // Unknown is terminal and never creates a changed-key automatic retry.
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_claim_communication_dispatch_batch",
      ),
    ).toHaveLength(1);
  });

  test("authorized work is bounded and the batch size is clamped", async () => {
    schedulerScopeHandler = () => ({
      data: {
        organizationCount: 1,
        organizationIds: [ORG],
        reservationId: RESERVATION,
      },
      error: null,
    });
    process.env.CSF_COMMUNICATIONS_WORKER_BATCH_SIZE = "100000";

    const response = await POST(authorized());
    const body = await response.json();

    expect(response.status).toBe(200);
    const claim = rpcCalls.find(
      (call) => call.fn === "csf_claim_communication_dispatch_batch",
    );
    // The configured value is the run-wide attempt budget. Each durable claim is
    // one attempt so the absolute wall-clock deadline remains enforceable.
    expect(claim?.args.p_batch_size).toBe(1);
    expect(body.batchSize).toBe(50);
    delete process.env.CSF_COMMUNICATIONS_WORKER_BATCH_SIZE;
  });

  test("authorized work dispatches claimed attempts and reports aggregates only", async () => {
    let scopeCalls = 0;
    schedulerScopeHandler = () => {
      scopeCalls += 1;
      return {
        data: {
          organizationCount: scopeCalls === 1 ? 1 : 0,
          organizationIds: scopeCalls === 1 ? [ORG] : [],
          reservationId: scopeCalls === 1 ? RESERVATION : null,
        },
        error: null,
      };
    };
    maintenanceHandler = () => ({
      data: sendCalls.length
        ? { checked: 1, terminalized: 1, nonterminal: 0, faults: 0 }
        : { checked: 1, terminalized: 0, nonterminal: 1, faults: 0 },
      error: null,
    });
    claimHandler = () => ({
      data: {
        claimedCount: 1,
        claims: [
          {
            attemptId: ATTEMPT,
            campaignId: CAMPAIGN,
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
    expect(body.campaignsTerminalized).toBe(1);
    expect(sendCalls).toHaveLength(1);

    // V122: maintenance brackets the worker pass. The second pass sees the
    // campaign the worker just settled without the route carrying its identity.
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_maintain_communication_campaigns",
      ),
    ).toEqual([
      {
        fn: "csf_maintain_communication_campaigns",
        args: { p_max_campaigns: 50 },
      },
      {
        fn: "csf_maintain_communication_campaigns",
        args: { p_max_campaigns: 50 },
      },
    ]);

    // SANITIZED RESPONSE. Aggregates only -- nothing that identifies a recipient,
    // a message, or a ledger row.
    expect(serialized).not.toContain("rep.one@local.test");
    expect(serialized).not.toContain(ATTEMPT);
    expect(serialized).not.toContain(CAMPAIGN);
    expect(serialized).not.toContain(IDEMPOTENCY_KEY);
    expect(serialized).not.toContain("resend-message-synthetic");
    expect(serialized).not.toContain("Synthetic bounded worker subject");
    expect(serialized).not.toContain("Synthetic body.");
  });

  test("a later attempt fault cannot strand an earlier settled campaign or replay its send", async () => {
    let scopeCalls = 0;
    schedulerScopeHandler = () => {
      scopeCalls += 1;
      return {
        data: {
          organizationCount: scopeCalls <= 2 ? 1 : 0,
          organizationIds: scopeCalls <= 2 ? [ORG] : [],
          reservationId: scopeCalls <= 2 ? RESERVATION : null,
        },
        error: null,
      };
    };
    let claimCalls = 0;
    claimHandler = () => {
      claimCalls += 1;
      const second = claimCalls === 2;
      return {
        data: {
          claimedCount: 1,
          claims: [
            {
              attemptId: second ? ATTEMPT_TWO : ATTEMPT,
              campaignId: second ? CAMPAIGN_TWO : CAMPAIGN,
              deliveryId: second
                ? "cea00000-0000-4000-8000-000000000002"
                : "cea00000-0000-4000-8000-000000000001",
              recipientSnapshotId: second
                ? "ce800000-0000-4000-8000-000000000002"
                : "ce800000-0000-4000-8000-000000000001",
              attemptNumber: second ? 2 : 1,
              providerIdempotencyKey: second
                ? `csf-att-${"b".repeat(64)}-1`
                : IDEMPOTENCY_KEY,
              requestPayloadHash: DIGEST,
              leaseExpiresAt: "2032-04-01T10:02:00.000Z",
            },
          ],
        },
        error: null,
      };
    };
    authorizeHandler = (args) => {
      if (args.p_attempt_id === ATTEMPT_TWO) {
        throw new Error(
          "malformed authorization for private recipient second@local.test",
        );
      }
      return authorizationFor(ATTEMPT, 1);
    };
    maintenanceHandler = () => ({
      data:
        sendCalls.length === 0
          ? { checked: 2, terminalized: 0, nonterminal: 2, faults: 0 }
          : { checked: 2, terminalized: 1, nonterminal: 1, faults: 0 },
      error: null,
    });

    const first = await POST(authorized());
    const firstBody = await first.json();
    const second = await POST(authorized());
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody.faults).toBe(1);
    expect(firstBody.campaignsTerminalized).toBe(1);
    expect(second.status).toBe(200);
    expect(secondBody.faults).toBe(0);
    expect(sendCalls).toHaveLength(1);
    expect(
      rpcCalls.filter(
        (call) => call.fn === "csf_settle_communication_dispatch_attempt",
      ),
    ).toHaveLength(1);
    const serialized = JSON.stringify({ firstBody, secondBody });
    for (const privateValue of [
      ATTEMPT,
      ATTEMPT_TWO,
      CAMPAIGN,
      CAMPAIGN_TWO,
      "second@local.test",
      "malformed authorization",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  test("a claim-time fault is bounded and the next tick rotates to another tenant", async () => {
    const scopes = [
      { organizationId: ORG, reservationId: RESERVATION },
      { organizationId: ORG_TWO, reservationId: RESERVATION_TWO },
    ];
    let scopeCall = 0;
    schedulerScopeHandler = () => {
      const scope = scopes[scopeCall];
      scopeCall += 1;
      return {
        data: {
          organizationCount: scope ? 1 : 0,
          organizationIds: scope ? [scope.organizationId] : [],
          reservationId: scope?.reservationId ?? null,
        },
        error: null,
      };
    };
    let claimCall = 0;
    claimHandler = () => {
      claimCall += 1;
      return claimCall === 1
        ? {
            data: null,
            error: {
              message:
                "row csf_communication_dispatch_attempts for rep.one@local.test",
              code: "08006",
            },
          }
        : { data: { claimedCount: 0, claims: [] }, error: null };
    };

    const firstResponse = await POST(authorized());
    const firstBody = await firstResponse.json();
    const secondResponse = await POST(authorized());
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstBody.faults).toBe(1);
    expect(firstBody.claimed).toBe(0);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.faults).toBe(0);
    expect(secondBody.claimed).toBe(0);
    // Nothing was claimed, so nothing was sent.
    expect(sendCalls).toHaveLength(0);
    expect(
      rpcCalls
        .filter(
          (call) => call.fn === "csf_acknowledge_communication_scheduler_scope",
        )
        .map((call) => call.args.p_organization_id),
    ).toEqual([ORG, ORG_TWO]);
    expect(
      rpcCalls
        .filter((call) => call.fn === "csf_claim_communication_dispatch_batch")
        .map((call) => call.args.p_organization_id),
    ).toEqual([ORG, ORG_TWO]);
    expect(JSON.stringify({ firstBody, secondBody })).not.toContain(
      "rep.one@local.test",
    );
  });
});
