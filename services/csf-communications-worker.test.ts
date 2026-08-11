import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * The executable CSF dispatch path, driven end to end with no database, no provider,
 * and no network.
 *
 * The Resend SDK and the Supabase RPC surface are both stubbed. Every fixture value
 * is synthetic and uses reserved .test names.
 */

type SendCall = Record<string, unknown>;
const sendCalls: SendCall[] = [];
/** The SDK's second argument, where the idempotency key is transmitted. */
const sendOptions: Array<{ idempotencyKey?: string } | undefined> = [];
type ResendResponse = {
  data: { id: string } | null;
  error: { name: string; message: string; statusCode?: number | null } | null;
};
let resendImpl: () => Promise<ResendResponse> = async () => ({
  data: { id: "resend-message-synthetic-a" },
  error: null,
});

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (
        payload: SendCall,
        options?: { idempotencyKey?: string },
      ) => {
        sendCalls.push(payload);
        sendOptions.push(options);
        return resendImpl();
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
mock.module("@/lib/logger", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: () => undefined,
}));

const worker = await import("./csf-communications-worker");

const ORG = "bd100000-0000-4000-8000-000000000001";
const CAMPAIGN = "bd400000-0000-4000-8000-000000000001";
const SNAPSHOT = "bd800000-0000-4000-8000-000000000001";
const ATTEMPT = "bd900000-0000-4000-8000-000000000001";
const DELIVERY = "bda00000-0000-4000-8000-000000000001";
const DIGEST = "e".repeat(64);
const IDEMPOTENCY_KEY = `csf-att-${"a".repeat(64)}-1`;

function providerPayload() {
  return {
    from: "DVHS CSF <csf@notifications.lets-assist.com>",
    to: "rep.one@local.test",
    replyTo: "dvhighcsf@example.test",
    subject: "Spring 2032 partner club audit",
    text: "Please submit your Spring 2032 audit.",
    html: "<p>Please submit.</p>",
    tags: [
      { name: "csf_attempt_id", value: ATTEMPT },
      { name: "csf_campaign_id", value: CAMPAIGN },
      { name: "csf_organization_id", value: ORG },
      { name: "csf_plugin", value: "dvhs_csf" },
      { name: "csf_topic_key", value: "partner_clubs" },
    ],
    topicId: "topic_synthetic_partner_clubs",
    type: "transactional" as const,
    idempotencyKey: IDEMPOTENCY_KEY,
  };
}

function claim() {
  return {
    attemptId: ATTEMPT,
    campaignId: CAMPAIGN,
    deliveryId: DELIVERY,
    recipientSnapshotId: SNAPSHOT,
    attemptNumber: 1,
    providerIdempotencyKey: IDEMPOTENCY_KEY,
    requestPayloadHash: DIGEST,
    leaseExpiresAt: "2032-04-01T10:02:00.000Z",
    requiresDispatchAuthorization: true,
  };
}

function authorization(overrides: Record<string, unknown> = {}) {
  return {
    authorized: true,
    organizationId: ORG,
    attemptId: ATTEMPT,
    deliveryId: DELIVERY,
    coordinate: {
      organizationId: ORG,
      campaignId: CAMPAIGN,
      recipientSnapshotId: SNAPSHOT,
      attemptId: ATTEMPT,
      attemptNumber: 1,
      contentHash: "c".repeat(64),
      recipientSnapshotHash: "d".repeat(64),
      deliveryRequirement: "broadcast",
      topicKey: "partner_clubs",
    },
    providerPayload: providerPayload(),
    requestPayloadHash: DIGEST,
    providerIdempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

type RpcCall = { fn: string; args: Record<string, unknown> };

function pluginHarness(
  handlers: Partial<
    Record<
      string,
      (args: Record<string, unknown>) => {
        data: unknown;
        error: { message: string; code?: string } | null;
      }
    >
  >,
) {
  const calls: RpcCall[] = [];
  return {
    calls,
    plugin: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const handler = handlers[fn];
        if (!handler) return { data: null, error: null };
        return handler(args);
      },
    },
  };
}

function defaultHandlers(overrides: Record<string, unknown> = {}) {
  return {
    csf_claim_communication_dispatch_batch: () => ({
      data: { claimedCount: 1, claims: [claim()] },
      error: null,
    }),
    csf_authorize_communication_dispatch: () => ({
      data: authorization(),
      error: null,
    }),
    csf_settle_communication_dispatch_attempt: () => ({
      data: { attemptState: "accepted" },
      error: null,
    }),
    ...overrides,
  };
}

beforeEach(() => {
  sendCalls.length = 0;
  // Reset alongside sendCalls. Left accumulating, "how many times did we transmit,
  // and under which idempotency key" becomes a function of test ordering rather
  // than of the code under test.
  sendOptions.length = 0;
  resendImpl = async () => ({
    data: { id: "resend-message-synthetic-a" },
    error: null,
  });
  process.env.EMAIL_TRANSPORT = "resend";
  process.env.RESEND_API_KEY = "synthetic-resend-key";
});

describe("the claim -> authorize -> send -> settle path", () => {
  test("an accepted send settles the exact attempt with the provider message", async () => {
    const { calls, plugin } = pluginHarness(defaultHandlers());

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
      correlationId: "corr-run-1",
    });

    expect(report.claimed).toBe(1);
    expect(report.attempts[0]).toMatchObject({
      attemptId: ATTEMPT,
      status: "sent",
    });

    // Exactly one send, and the order is claim -> authorize -> settle.
    expect(sendCalls).toHaveLength(1);
    expect(calls.map((call) => call.fn)).toEqual([
      "csf_claim_communication_dispatch_batch",
      "csf_authorize_communication_dispatch",
      "csf_settle_communication_dispatch_attempt",
    ]);

    const settle = calls[2].args;
    expect(settle.p_attempt_id).toBe(ATTEMPT);
    expect(settle.p_worker_id).toBe("worker-1");
    expect(settle.p_outcome).toBe("accepted");
    expect(settle.p_provider_message_id).toBe("resend-message-synthetic-a");
  });

  test("the transmitted request is the authorized payload, unchanged", async () => {
    const { plugin } = pluginHarness(defaultHandlers());

    await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    // The SDK receives from, to, replyTo, subject, both bodies, the tag array,
    // topicId, and the allocated idempotency key -- the exact coordinate the ledger
    // hashed. `type` is a local transport flag and is consumed by sendEmail.
    expect(sendCalls[0]).toMatchObject({
      from: "DVHS CSF <csf@notifications.lets-assist.com>",
      to: "rep.one@local.test",
      replyTo: "dvhighcsf@example.test",
      subject: "Spring 2032 partner club audit",
      text: "Please submit your Spring 2032 audit.",
      html: "<p>Please submit.</p>",
      topicId: "topic_synthetic_partner_clubs",
      tags: providerPayload().tags,
    });
  });

  test("a definitive provider rejection settles failed and is not retried", async () => {
    resendImpl = async () => ({
      data: null,
      error: {
        name: "validation_error",
        message: "from address not verified for rep.one@local.test",
        statusCode: 422,
      },
    });
    const { calls, plugin } = pluginHarness(defaultHandlers());

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0].status).toBe("failed");
    const settle = calls[2].args;
    expect(settle.p_outcome).toBe("failed");
    expect(settle.p_provider_message_id).toBeNull();
    // The provider's message named the recipient. The settlement must not.
    expect(JSON.stringify(settle)).not.toContain("rep.one@local.test");
  });

  test("an unconfigured transport is retryable, never recipient suppression", async () => {
    delete process.env.RESEND_API_KEY;
    const { calls, plugin } = pluginHarness(defaultHandlers());

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0].status).toBe("retryable");
    // 'suppressed' is a claim about the RECIPIENT and terminally locks the delivery.
    // A missing API key says nothing about them.
    expect(calls[2].args.p_outcome).toBe("retryable_failure");
    expect(calls[2].args.p_outcome).not.toBe("suppressed");
  });

  test("a local setup failure never becomes provider ambiguity", async () => {
    process.env.EMAIL_TRANSPORT = "mailpit";
    process.env.MAILPIT_SMTP_PORT = "not-a-port";
    const { calls, plugin } = pluginHarness(defaultHandlers());

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0].status).toBe("failed");
    expect(calls[2].args.p_outcome).toBe("failed");
    expect(calls[2].args.p_outcome).not.toBe("unknown_outcome");
    delete process.env.MAILPIT_SMTP_PORT;
  });

  test("a lost provider response settles unknown and enqueues no retry", async () => {
    resendImpl = async () => {
      const reset = new Error("socket hang up");
      reset.name = "ECONNRESET";
      throw reset;
    };
    const { calls, plugin } = pluginHarness(defaultHandlers());

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0].status).toBe("unknown");
    expect(calls[2].args.p_outcome).toBe("unknown_outcome");
    // The whole point: an ambiguous transport result must never be settled as
    // retryable, because the ledger would then enqueue a successor and mail twice.
    expect(calls[2].args.p_outcome).not.toBe("retryable_failure");
    expect(sendCalls).toHaveLength(1);
  });

  test("a provider 2xx with no message identity is unknown, not accepted", async () => {
    resendImpl = async () => ({ data: null, error: null });
    const { calls, plugin } = pluginHarness(defaultHandlers());

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0].status).toBe("unknown");
    expect(calls[2].args.p_outcome).toBe("unknown_outcome");
  });

  test("a concurrent idempotent request settles unknown and enqueues no successor", async () => {
    // Resend says: another request carrying THIS EXACT idempotency key is still in
    // progress. That in-flight request may be accepted a moment from now, and this
    // worker cannot observe it.
    resendImpl = async () => ({
      data: null,
      error: {
        name: "concurrent_idempotent_requests",
        message:
          "Another request with the same idempotency key for rep.one@local.test is in progress",
        statusCode: 409,
      },
    });
    const { calls, plugin } = pluginHarness(defaultHandlers());

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0].status).toBe("unknown");

    // EXACTLY ONE PROVIDER CALL. Nothing here loops or re-sends to find out.
    expect(sendCalls).toHaveLength(1);
    expect(sendOptions).toHaveLength(1);

    const settle = calls[2].args;
    expect(settle.p_outcome).toBe("unknown_outcome");
    // THE SUCCESSOR TEST. 'retryable_failure' is the single value that makes the
    // ledger insert another attempt, and that successor's provider idempotency key
    // is derived from attempt_number + 1 -- a DIFFERENT key, which Resend's own
    // deduplication window would not catch. Mailing the same person twice is
    // exactly what settling this as retryable would cause.
    expect(settle.p_outcome).not.toBe("retryable_failure");
    expect(settle.p_outcome).not.toBe("accepted");

    // Nothing was accepted, so no message identity may be claimed.
    expect(settle.p_provider_message_id).toBeNull();
    // The provider code survives as bounded diagnostic evidence: an operator
    // reconciling this by hand looks up a concurrency collision differently from
    // a dead socket.
    expect(settle.p_failure_class).toBe("concurrent_idempotent_requests");
    expect(settle.p_provider_status_code).toBe(409);
    // ...but the provider's message named the recipient, and the settlement must not.
    expect(JSON.stringify(settle)).not.toContain("rep.one@local.test");

    // No changed-key resend: the one transmission carried the key the ledger
    // allocated, unchanged.
    expect(sendOptions[0]?.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(sendCalls[0].to).toBe("rep.one@local.test");

    // The worker never asked the ledger to open another attempt.
    expect(calls.map((call) => call.fn)).toEqual([
      "csf_claim_communication_dispatch_batch",
      "csf_authorize_communication_dispatch",
      "csf_settle_communication_dispatch_attempt",
    ]);
  });

  test("a lost settlement response does not resend", async () => {
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_settle_communication_dispatch_attempt: () => ({
          data: null,
          error: { message: "connection reset", code: "08006" },
        }),
      }),
    );

    await expect(
      worker.runCsfDispatchWorker(plugin, {
        organizationId: ORG,
        workerId: "worker-1",
      }),
    ).rejects.toThrow(worker.CsfWorkerRpcError);

    // The send happened once. The attempt stays leased and is later reaped as
    // unknown_outcome, which is the honest answer -- we do not know whether the
    // settlement committed, and we must not send again to find out.
    expect(sendCalls).toHaveLength(1);
  });

  test("the bounded RPC error carries a code, never the raw database message", async () => {
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_settle_communication_dispatch_attempt: () => ({
          data: null,
          error: {
            message: "delivery for rep.one@local.test violates constraint",
            code: "23514",
          },
        }),
      }),
    );

    try {
      await worker.runCsfDispatchWorker(plugin, {
        organizationId: ORG,
        workerId: "worker-1",
      });
      throw new Error("expected the worker to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(worker.CsfWorkerRpcError);
      const bounded = error as InstanceType<typeof worker.CsfWorkerRpcError>;
      expect(bounded.code).toBe("23514");
      expect(bounded.message).not.toContain("rep.one@local.test");
    }
  });
});

describe("fencing and restart safety", () => {
  test("a stale worker whose authorization is refused never settles", async () => {
    const { calls, plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: null,
          error: {
            message: "leased to another worker",
            code: "23514",
          },
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "stale-worker",
    });

    expect(report.attempts[0].status).toBe("authorization_lost");
    // Critically: no send, and no settlement. A stale fence settling would overwrite
    // the real leaseholder's outcome.
    expect(sendCalls).toHaveLength(0);
    expect(calls.map((call) => call.fn)).not.toContain(
      "csf_settle_communication_dispatch_attempt",
    );
  });

  test("a refused authorization sends nothing and settles nothing", async () => {
    const { calls, plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: {
            authorized: false,
            blockedBy: "address_safety",
            attemptState: "suppressed",
          },
          error: null,
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0]).toMatchObject({
      status: "refused",
      blockedBy: "address_safety",
    });
    expect(sendCalls).toHaveLength(0);
    expect(calls.map((call) => call.fn)).not.toContain(
      "csf_settle_communication_dispatch_attempt",
    );
  });

  test("a restarted worker reuses the ledger's key and does not mint a new one", async () => {
    const { calls: firstCalls, plugin: firstPlugin } =
      pluginHarness(defaultHandlers());
    await worker.runCsfDispatchWorker(firstPlugin, {
      organizationId: ORG,
      workerId: "worker-before-restart",
    });

    const { calls: secondCalls, plugin: secondPlugin } =
      pluginHarness(defaultHandlers());
    await worker.runCsfDispatchWorker(secondPlugin, {
      organizationId: ORG,
      workerId: "worker-after-restart",
    });

    // The key is a property of the ATTEMPT coordinate, not of the worker process.
    // Restarting cannot mint a new one, which is what lets Resend deduplicate. It
    // travels as the SDK's idempotency option, not as a body field.
    expect(sendOptions[0]).toEqual({ idempotencyKey: IDEMPOTENCY_KEY });
    expect(sendOptions[1]).toEqual({ idempotencyKey: IDEMPOTENCY_KEY });
    expect(firstCalls[2].args.p_attempt_id).toBe(
      secondCalls[2].args.p_attempt_id,
    );
  });

  test("an authorization whose digest disagrees with the claim refuses to send", async () => {
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: authorization({ requestPayloadHash: "f".repeat(64) }),
          error: null,
        }),
      }),
    );

    await expect(
      worker.runCsfDispatchWorker(plugin, {
        organizationId: ORG,
        workerId: "worker-1",
      }),
    ).rejects.toThrow(worker.CsfWorkerRpcError);

    // The ledger changed its mind about what this attempt sends between claim and
    // authorization. Sending either version would be a guess.
    expect(sendCalls).toHaveLength(0);
  });

  test("an authorization whose key is absent from the payload refuses to send", async () => {
    const payload = providerPayload();
    const { idempotencyKey, ...withoutKey } = payload;
    void idempotencyKey;
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: authorization({ providerPayload: withoutKey }),
          error: null,
        }),
      }),
    );

    await expect(
      worker.runCsfDispatchWorker(plugin, {
        organizationId: ORG,
        workerId: "worker-1",
      }),
    ).rejects.toThrow(worker.CsfWorkerRpcError);
    expect(sendCalls).toHaveLength(0);
  });

  test("a malformed claim batch is rejected before anything is sent", async () => {
    const { plugin } = pluginHarness({
      csf_claim_communication_dispatch_batch: () => ({
        data: { claims: [{ attemptId: ATTEMPT }] },
        error: null,
      }),
    });

    await expect(
      worker.runCsfDispatchWorker(plugin, {
        organizationId: ORG,
        workerId: "worker-1",
      }),
    ).rejects.toThrow(worker.CsfWorkerRpcError);
    expect(sendCalls).toHaveLength(0);
  });

  test("an empty claim batch sends nothing", async () => {
    const { plugin } = pluginHarness({
      csf_claim_communication_dispatch_batch: () => ({
        data: { claimedCount: 0, claims: [] },
        error: null,
      }),
    });

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.claimed).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });
});

describe("cancellation, fencing, and reconciliation are the ledger's call, not the worker's", () => {
  test("a campaign cancelled after the lease refuses authorization and sends nothing", async () => {
    // A lease can outlive the campaign that granted it: cancellation reports live
    // leases rather than stealing them. The authorization RPC is what notices, and
    // it settles the attempt itself, so there is nothing left for the worker to do
    // -- least of all send.
    const { calls, plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: {
            authorized: false,
            blockedBy: "campaign_status",
            campaignStatus: "cancelled",
            attemptState: "failed",
            coordinate: null,
            providerPayload: null,
            requestPayloadHash: null,
            providerIdempotencyKey: null,
          },
          error: null,
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0]).toMatchObject({
      attemptId: ATTEMPT,
      status: "refused",
      blockedBy: "campaign_status",
    });
    expect(sendCalls).toHaveLength(0);
    // No settlement either: the ledger already settled it, and a second settle
    // would be this worker asserting an outcome it never observed.
    expect(calls.map((call) => call.fn)).toEqual([
      "csf_claim_communication_dispatch_batch",
      "csf_authorize_communication_dispatch",
    ]);
  });

  test("a refused authorization never carries recipient, subject, or key material", async () => {
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: {
            authorized: false,
            blockedBy: "campaign_status",
            attemptState: "failed",
            coordinate: null,
            providerPayload: null,
            requestPayloadHash: null,
            providerIdempotencyKey: null,
          },
          error: null,
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "rep.one@local.test",
      "Spring 2032 partner club audit",
      IDEMPOTENCY_KEY,
      "topic_synthetic_partner_clubs",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("a stale fence loses authorization and settles nothing", async () => {
    // The lease was reaped, or another worker holds it. This worker has no
    // authority to speak for the attempt, and settling anyway would overwrite the
    // real holder's outcome.
    const { calls, plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: null,
          error: {
            code: "23514",
            message:
              "This CSF dispatch attempt is leased to another worker; a stale worker may not be authorized to send it.",
          },
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-stale",
    });

    expect(report.attempts[0]).toMatchObject({
      attemptId: ATTEMPT,
      status: "authorization_lost",
      detail: "23514",
    });
    expect(sendCalls).toHaveLength(0);
    expect(
      calls.some(
        (call) => call.fn === "csf_settle_communication_dispatch_attempt",
      ),
    ).toBe(false);
  });

  test("a stale fence reports a code, never the ledger's own sentence", async () => {
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_authorize_communication_dispatch: () => ({
          data: null,
          error: {
            code: "23514",
            message:
              "leased to another worker while mailing rep.one@local.test",
          },
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-stale",
    });

    expect(JSON.stringify(report)).not.toContain("rep.one@local.test");
  });

  test("a late worker whose settlement was already reconciled is told, not looped", async () => {
    // The settlement committed and its HTTP response was lost; by the time this
    // worker retried, provider evidence had reconciled the attempt. Raising here
    // would abort the worker's transaction and it would retry forever against a
    // ledger that has already decided, so the ledger answers with the verdict.
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_settle_communication_dispatch_attempt: () => ({
          data: {
            attemptState: "bounced",
            reconciledOutcome: "bounced",
            reconciledActorKind: "provider",
            supersededByReconciliation: true,
            retryEnqueued: false,
            idempotentReplay: true,
          },
          error: null,
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0]).toMatchObject({
      attemptId: ATTEMPT,
      ledgerAttemptState: "bounced",
      supersededByReconciliation: true,
    });
    // Still exactly one send. The superseded verdict is information, not a reason
    // to try again.
    expect(sendCalls).toHaveLength(1);
  });

  test("a worker confirming a provider settlement records the confirmation", async () => {
    const { plugin } = pluginHarness(
      defaultHandlers({
        csf_settle_communication_dispatch_attempt: () => ({
          data: {
            attemptState: "accepted",
            settlementSource: "provider",
            workerConfirmedProviderSettlement: true,
            idempotentReplay: true,
          },
          error: null,
        }),
      }),
    );

    const report = await worker.runCsfDispatchWorker(plugin, {
      organizationId: ORG,
      workerId: "worker-1",
    });

    expect(report.attempts[0]).toMatchObject({
      status: "sent",
      ledgerAttemptState: "accepted",
      workerConfirmedProviderSettlement: true,
      supersededByReconciliation: false,
    });
    expect(sendCalls).toHaveLength(1);
  });
});

describe("bounded fault codes", () => {
  test("only a real SQLSTATE travels; anything else becomes the fallback", () => {
    expect(worker.boundedRpcFaultCode("23514", "settlement_failed")).toBe(
      "23514",
    );
    expect(worker.boundedRpcFaultCode("P0001", "settlement_failed")).toBe(
      "P0001",
    );
    // A loosely typed client field is one more place unbounded text can arrive, and
    // this one is surfaced to callers as `detail`.
    expect(
      worker.boundedRpcFaultCode(
        "PGRST116 rep.one@local.test",
        "settlement_failed",
      ),
    ).toBe("settlement_failed");
    expect(worker.boundedRpcFaultCode("23514;DROP", "claim_failed")).toBe(
      "claim_failed",
    );
    expect(worker.boundedRpcFaultCode(undefined, "claim_failed")).toBe(
      "claim_failed",
    );
  });
});
