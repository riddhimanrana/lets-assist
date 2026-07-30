import type { SendEmailParams, SendEmailResult } from "@/services/email";

/**
 * The DVHS CSF dispatch worker adapter.
 *
 * This is the executable seam between three things that previously only agreed on
 * paper:
 *
 *   1. `plugin_data.csf_authorize_communication_dispatch()` decides, immediately
 *      before the send, whether this recipient may still be mailed, and returns the
 *      EXACT provider payload whose digest the ledger stored.
 *   2. `sendEmail()` transmits that payload, unchanged.
 *   3. `plugin_data.csf_settle_communication_dispatch_attempt()` records what
 *      happened.
 *
 * Nothing here invents a request, reshapes one, or decides to retry. The two rules
 * it exists to make executable:
 *
 *   * the payload is forwarded byte-for-byte, so the stored digest describes what
 *     the recipient actually received, and
 *   * an ambiguous transport outcome settles as `unknown_outcome` and NEVER
 *     enqueues a retry.
 *
 * Every dependency is injected so the contract is testable without a database, a
 * provider, or a network.
 */

/** The exact object the ledger hands over and the transport receives. */
export type CsfProviderPayload = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  tags: Array<{ name: string; value: string }>;
  headers?: Record<string, string>;
  /** Broadcasts only. Transactional CSF mail carries no topic. */
  topicId?: string;
  /**
   * The transport's own routing flag, not the CSF broadcast/transactional
   * distinction. 'transactional' means "do not re-consult the generic per-user
   * notification settings", which is correct because CSF consent and address safety
   * were already decided by the authorization RPC. It is part of the hashed payload
   * so a worker cannot flip it and have an authorized send silently dropped.
   */
  type: "transactional";
  idempotencyKey: string;
};

/** Internal ledger identity. Never transmitted. */
export type CsfDispatchCoordinate = {
  organizationId: string;
  campaignId: string;
  recipientSnapshotId: string;
  attemptId: string;
  attemptNumber: number;
  contentHash: string;
  recipientSnapshotHash: string;
  deliveryRequirement: "broadcast" | "transactional";
  topicKey: string | null;
};

export type CsfDispatchAuthorization =
  | {
      authorized: true;
      organizationId: string;
      attemptId: string;
      deliveryId: string;
      coordinate: CsfDispatchCoordinate;
      providerPayload: CsfProviderPayload;
      requestPayloadHash: string;
      providerIdempotencyKey: string;
    }
  | {
      authorized: false;
      organizationId: string;
      attemptId: string;
      deliveryId: string;
      // csf_authorize_communication_dispatch() refuses for three reasons, not two.
      // A campaign that left 'queued'/'sending' -- cancelled, paused, completed --
      // blocks with 'campaign_status', and omitting it here let a caller narrow on
      // the union and conclude a refusal it had not handled was unreachable.
      blockedBy: "address_safety" | "broadcast_consent" | "campaign_status";
      decision: string;
      reason: string;
      attemptState: string;
    };

/** The settle-RPC arguments this adapter derives. Nothing else may derive them. */
export type CsfDispatchSettlement = {
  outcome:
    | "accepted"
    | "failed"
    | "retryable_failure"
    | "suppressed"
    | "unknown_outcome";
  providerMessageId: string | null;
  providerStatusCode: number | null;
  failureClass: string | null;
  detail: string | null;
  metadata: Record<string, string | number | boolean>;
};

/**
 * Map one transport result onto a ledger settlement.
 *
 * THE ONLY INTERESTING LINE IN THIS FILE IS THE `unknown_outcome` ONE.
 *
 * `retryable_pre_send` becomes `retryable_failure`, which the ledger is allowed to
 * follow with a successor attempt, because the provider refused the request without
 * accepting it -- nothing was queued, so re-sending cannot duplicate.
 *
 * `unknown_outcome` becomes `unknown_outcome`, which the ledger refuses to retry
 * under any circumstances. That is the whole point: the request may already be in
 * Resend's queue, Resend forgets idempotency keys after 24 hours, and a retry would
 * mail a real person twice. It settles, marks the delivery for review, and waits for
 * either provider evidence or a human.
 *
 * A `skipped` transport result maps to `suppressed`: the ledger authorized the send
 * and the transport declined to make it, which is a terminal outcome for this
 * recipient rather than something to try again.
 */
export function mapTransportResultToSettlement(
  result: SendEmailResult,
): CsfDispatchSettlement {
  const metadata: Record<string, string | number | boolean> = {};
  if (result.status != null) metadata.statusCode = result.status;
  if (result.code) metadata.errorName = result.code;

  switch (result.outcome) {
    case "accepted":
      return {
        outcome: "accepted",
        providerMessageId: result.messageId,
        providerStatusCode: null,
        failureClass: null,
        detail: null,
        metadata: {},
      };

    case "definitive_failure":
      return {
        outcome: "failed",
        providerMessageId: null,
        providerStatusCode: result.status,
        failureClass: result.code,
        detail: String(result.error),
        metadata: { ...metadata, retryable: false },
      };

    case "retryable_pre_send":
      return {
        outcome: "retryable_failure",
        // A retryable failure must carry no provider message identity: a response
        // that named a message was an acceptance, and the ledger rejects the
        // combination outright.
        providerMessageId: null,
        providerStatusCode: result.status,
        failureClass: result.code,
        detail: String(result.error),
        metadata: { ...metadata, retryable: true },
      };

    case "unknown_outcome":
      return {
        outcome: "unknown_outcome",
        providerMessageId: null,
        providerStatusCode: result.status,
        failureClass: result.code,
        detail: String(result.error),
        metadata: { ...metadata, retryable: false },
      };

    case "skipped":
      // A SKIPPED TRANSPORT IS AN OPERATIONAL FAULT, NOT RECIPIENT SUPPRESSION.
      //
      // This previously mapped to `suppressed`, which in the CSF ledger is a
      // statement about the RECIPIENT -- it terminally locks the delivery and reads,
      // to anyone looking later, as "we must not mail this person". But the only way
      // to reach this branch is a transport the operator never configured. Recording
      // that as suppression would mean a missing RESEND_API_KEY silently converted
      // every mandatory transactional recipient into a blocked address, and
      // mandatory transactional delivery is exactly what must not be quietly
      // dropped.
      //
      // It is a retryable operational failure: nothing was sent, nothing about the
      // recipient changed, and configuring the transport makes the same send valid.
      // Address safety is never touched from here.
      return {
        outcome: "retryable_failure",
        providerMessageId: null,
        providerStatusCode: null,
        failureClass: result.code,
        detail: result.reason,
        metadata: { retryable: true },
      };
  }
}

export type CsfDispatchDependencies = {
  authorize: (input: {
    organizationId: string;
    attemptId: string;
    workerId: string;
    correlationId?: string;
  }) => Promise<CsfDispatchAuthorization>;
  send: (payload: SendEmailParams) => Promise<SendEmailResult>;
  settle: (
    input: CsfDispatchSettlement & {
      organizationId: string;
      attemptId: string;
      workerId: string;
    },
  ) => Promise<unknown>;
};

export type CsfDispatchReport =
  | { dispatched: false; reason: "refused"; blockedBy: string; attemptState: string }
  | {
      dispatched: true;
      transportOutcome: SendEmailResult["outcome"];
      settlement: CsfDispatchSettlement;
      settleResult: unknown;
    };

/**
 * Dispatch one authorized CSF attempt.
 *
 * The sequence is fixed and the payload is never touched:
 *
 *   authorize -> (refused? stop) -> send(providerPayload) -> settle(mapped outcome)
 *
 * `providerPayload` is spread into `sendEmail` with no additions, no removals, and
 * no reshaping. That is what makes the digest the ledger stored a statement about
 * the message the recipient received rather than about a document nobody sent.
 */
export async function dispatchAuthorizedCsfAttempt(
  input: {
    organizationId: string;
    attemptId: string;
    workerId: string;
    correlationId?: string;
  },
  dependencies: CsfDispatchDependencies,
): Promise<CsfDispatchReport> {
  const authorization = await dependencies.authorize(input);

  if (!authorization.authorized) {
    // The ledger already settled the attempt itself -- suppressed for an address
    // or consent block, failed for a campaign that left 'queued'/'sending' -- and
    // reduced the delivery with it. There is nothing to send and nothing to settle.
    return {
      dispatched: false,
      reason: "refused",
      blockedBy: authorization.blockedBy,
      attemptState: authorization.attemptState,
    };
  }

  const transportResult = await dependencies.send({
    ...authorization.providerPayload,
  });

  const settlement = mapTransportResultToSettlement(transportResult);

  const settleResult = await dependencies.settle({
    ...settlement,
    organizationId: input.organizationId,
    attemptId: input.attemptId,
    workerId: input.workerId,
  });

  return {
    dispatched: true,
    transportOutcome: transportResult.outcome,
    settlement,
    settleResult,
  };
}
