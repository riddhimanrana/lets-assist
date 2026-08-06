import { describe, expect, test } from "bun:test";

import {
  dispatchAuthorizedCsfAttempt,
  mapTransportResultToSettlement,
  type CsfDispatchAuthorization,
  type CsfDispatchSettlement,
  type CsfProviderPayload,
} from "./csf-communications-dispatch";
import type { SendEmailParams, SendEmailResult } from "./email";

/**
 * The authorization -> exact provider request -> settlement contract, executable.
 *
 * Nothing here reaches Supabase, Resend, or a network: every dependency is
 * injected. Every fixture value is synthetic and uses reserved .test names.
 */

const ORG = "bd100000-0000-4000-8000-000000000001";
const CAMPAIGN = "bd400000-0000-4000-8000-000000000001";
const SNAPSHOT = "bd800000-0000-4000-8000-000000000001";
const ATTEMPT = "bd900000-0000-4000-8000-000000000001";
const DELIVERY = "bda00000-0000-4000-8000-000000000001";

/**
 * Exactly what `plugin_data.csf_communication_provider_request()` builds for a
 * broadcast, with the idempotency key merged in by the authorization RPC.
 */
const PROVIDER_PAYLOAD: CsfProviderPayload = {
  from: "DVHS CSF <csf@notifications.lets-assist.com>",
  to: "rep.one@local.test",
  replyTo: "dvhighcsf@gmail.com",
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
  type: "transactional",
  idempotencyKey: "csf-att-" + "a".repeat(64) + "-1",
};

function authorized(): CsfDispatchAuthorization {
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
    providerPayload: PROVIDER_PAYLOAD,
    requestPayloadHash: "e".repeat(64),
    providerIdempotencyKey: PROVIDER_PAYLOAD.idempotencyKey,
  };
}

function harness(
  transportResult: SendEmailResult,
  authorization: CsfDispatchAuthorization = authorized(),
) {
  const sent: SendEmailParams[] = [];
  const settled: Array<CsfDispatchSettlement & { attemptId: string }> = [];

  return {
    sent,
    settled,
    dependencies: {
      authorize: async () => authorization,
      send: async (payload: SendEmailParams) => {
        sent.push(payload);
        return transportResult;
      },
      settle: async (input: CsfDispatchSettlement & { attemptId: string }) => {
        settled.push(input);
        return { settled: true };
      },
    },
  };
}

const ACCEPTED: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "resend-message-synthetic-a",
  transport: "resend",
  data: { id: "resend-message-synthetic-a" },
};

describe("the authorized payload reaches the transport unchanged", () => {
  test("the transport request equals the authorized provider payload exactly", async () => {
    const { sent, dependencies } = harness(ACCEPTED);

    await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    expect(sent).toHaveLength(1);
    // Byte-for-byte equality, including From, Reply-To, both bodies, the tag array
    // in its canonical order, topicId, the transport type flag, and the idempotency
    // key. Hashing one shape and sending another is exactly what this forbids.
    expect(sent[0]).toEqual({
      from: "DVHS CSF <csf@notifications.lets-assist.com>",
      to: "rep.one@local.test",
      replyTo: "dvhighcsf@gmail.com",
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
      type: "transactional",
      idempotencyKey: PROVIDER_PAYLOAD.idempotencyKey,
    });
  });

  test("the adapter adds no key the ledger did not authorize", async () => {
    const { sent, dependencies } = harness(ACCEPTED);

    await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    expect(Object.keys(sent[0]).sort()).toEqual(
      Object.keys(PROVIDER_PAYLOAD).sort(),
    );
  });

  test("a transactional authorization carries no topic", async () => {
    const transactional = authorized();
    if (!transactional.authorized)
      throw new Error("fixture must be authorized");
    const { topicId, ...withoutTopic } = transactional.providerPayload;
    void topicId;
    transactional.providerPayload = withoutTopic as CsfProviderPayload;
    transactional.coordinate.deliveryRequirement = "transactional";
    transactional.coordinate.topicKey = null;

    const { sent, dependencies } = harness(ACCEPTED, transactional);
    await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    expect("topicId" in sent[0]).toBe(false);
  });

  test("a refused authorization sends nothing and settles nothing", async () => {
    const refusal: CsfDispatchAuthorization = {
      authorized: false,
      organizationId: ORG,
      attemptId: ATTEMPT,
      deliveryId: DELIVERY,
      blockedBy: "address_safety",
      decision: "suppressed_address_safety",
      reason: "address_bounce",
      attemptState: "suppressed",
    };

    const { sent, settled, dependencies } = harness(ACCEPTED, refusal);
    const report = await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    expect(report).toEqual({
      dispatched: false,
      reason: "refused",
      blockedBy: "address_safety",
      attemptState: "suppressed",
    });
    // The ledger already settled it. A second settlement would be a conflict.
    expect(sent).toHaveLength(0);
    expect(settled).toHaveLength(0);
  });

  // THE REFUSAL UNION HAS THREE ARMS, NOT TWO.
  //
  // csf_authorize_communication_dispatch() refuses with 'campaign_status' when the
  // campaign has left 'queued'/'sending' -- cancelled, paused, or completed -- and
  // it settles the attempt 'failed' rather than 'suppressed'. The TypeScript union
  // listed only address_safety and broadcast_consent, so a caller narrowing on
  // blockedBy could conclude this arm was unreachable and drop the case. This
  // fixture is the contract: it type-checks only while the union admits it.
  test("a campaign-status refusal is a modelled refusal, not an unreachable one", async () => {
    const refusal: CsfDispatchAuthorization = {
      authorized: false,
      organizationId: ORG,
      attemptId: ATTEMPT,
      deliveryId: DELIVERY,
      blockedBy: "campaign_status",
      decision: "refused",
      reason: 'campaign is "cancelled", so this attempt is not dispatchable',
      attemptState: "failed",
    };

    const { sent, settled, dependencies } = harness(ACCEPTED, refusal);
    const report = await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    expect(report).toEqual({
      dispatched: false,
      reason: "refused",
      blockedBy: "campaign_status",
      attemptState: "failed",
    });
    // A cancelled campaign must not put a message on the wire.
    expect(sent).toHaveLength(0);
    expect(settled).toHaveLength(0);
  });
});

describe("every transport outcome maps to exactly one settlement", () => {
  test("accepted records the provider message identity", () => {
    expect(mapTransportResultToSettlement(ACCEPTED)).toEqual({
      outcome: "accepted",
      providerMessageId: "resend-message-synthetic-a",
      providerStatusCode: null,
      failureClass: null,
      detail: null,
      metadata: {},
    });
  });

  test("a definitive failure settles as failed and is not retryable", () => {
    const settlement = mapTransportResultToSettlement({
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "provider_response",
      code: "validation_error",
      status: 422,
      error: "provider rejected the request (validation_error)",
    });

    expect(settlement.outcome).toBe("failed");
    expect(settlement.providerMessageId).toBeNull();
    expect(settlement.metadata).toMatchObject({
      statusCode: 422,
      errorName: "validation_error",
      retryable: false,
    });
  });

  test("a pre-send refusal settles as retryable with no message identity", () => {
    const settlement = mapTransportResultToSettlement({
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "provider_response",
      code: "rate_limit_exceeded",
      status: 429,
      error:
        "provider refused the request before acceptance (rate_limit_exceeded)",
    });

    expect(settlement.outcome).toBe("retryable_failure");
    // The ledger rejects a retryable failure that names a message, because a
    // response that named one was an acceptance.
    expect(settlement.providerMessageId).toBeNull();
    expect(settlement.metadata).toMatchObject({ retryable: true });
  });

  test("an ambiguous outcome settles as unknown and NEVER as retryable", () => {
    for (const phase of ["provider_request", "provider_response"] as const) {
      const settlement = mapTransportResultToSettlement({
        outcome: "unknown_outcome",
        success: false,
        skipped: false,
        phase,
        code: "transport_exception",
        status: null,
        error: "the provider request may or may not have been accepted",
      });

      expect(settlement.outcome).toBe("unknown_outcome");
      // This is the assertion the whole design exists for. An unknown outcome that
      // mapped to retryable_failure would let the ledger enqueue a successor and
      // mail a real person twice.
      expect(settlement.outcome).not.toBe("retryable_failure");
      expect(settlement.providerMessageId).toBeNull();
      expect(settlement.metadata).toMatchObject({ retryable: false });
    }
  });

  test("an unconfigured transport is an operational fault, never recipient suppression", () => {
    const settlement = mapTransportResultToSettlement({
      outcome: "skipped",
      success: false,
      skipped: true,
      phase: "transport_setup",
      code: "transport_not_configured",
      reason: "Email service not configured",
    });

    // 'suppressed' is a statement about the RECIPIENT and terminally locks the
    // delivery. A missing API key says nothing about the recipient, and mandatory
    // transactional mail must not be silently converted into a blocked address.
    expect(settlement.outcome).not.toBe("suppressed");
    expect(settlement.outcome).toBe("retryable_failure");
    expect(settlement.metadata).toMatchObject({ retryable: true });
  });
});

describe("the worker settles exactly what the transport reported", () => {
  test("a timeout after dispatch settles as unknown with no retry", async () => {
    const { settled, dependencies } = harness({
      outcome: "unknown_outcome",
      success: false,
      skipped: false,
      phase: "provider_request",
      code: "transport_exception",
      status: null,
      error: "the provider request may or may not have been accepted",
    });

    const report = await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    expect(report.dispatched).toBe(true);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      organizationId: ORG,
      attemptId: ATTEMPT,
      workerId: "worker-1",
      outcome: "unknown_outcome",
      providerMessageId: null,
    });
  });

  test("an accepted send settles with the provider message identity", async () => {
    const { settled, dependencies } = harness(ACCEPTED);

    await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    expect(settled[0]).toMatchObject({
      outcome: "accepted",
      providerMessageId: "resend-message-synthetic-a",
    });
  });

  test("no settlement metadata carries a recipient address or raw cause", async () => {
    const { settled, dependencies } = harness({
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "provider_response",
      code: "validation_error",
      status: 422,
      error: "provider rejected the request (validation_error)",
    });

    await dispatchAuthorizedCsfAttempt(
      { organizationId: ORG, attemptId: ATTEMPT, workerId: "worker-1" },
      dependencies,
    );

    const serialized = JSON.stringify(settled[0]);
    expect(serialized).not.toContain("rep.one@local.test");
    expect(serialized).not.toContain("csf@notifications.lets-assist.com");
  });
});
