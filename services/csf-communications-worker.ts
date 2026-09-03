import "server-only";

import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { sendEmail, type SendEmailResult } from "@/services/email";
import {
  mapTransportResultToSettlement,
  type CsfDispatchCoordinate,
  type CsfDispatchSettlement,
  type CsfProviderPayload,
} from "@/services/csf-communications-dispatch";

/**
 * The DVHS CSF durable dispatch worker.
 *
 * This is the real, server-only path from a queued attempt to a settled one:
 *
 *   claim -> validate the RPC response -> authorize immediately before sending
 *         -> call the shared sendEmail EXACTLY ONCE -> settle that exact attempt
 *
 * `server-only` is imported at the top for a reason: every function here can send
 * mail to a real person, and none of it may ever be reachable from a browser bundle.
 * There is deliberately no exported action, no route handler, and no shape that
 * accepts a caller-supplied sender, topic, recipient, or provider coordinate. The
 * only inputs are an organization, an optional campaign filter, and a worker
 * identity; every addressing fact is read from the ledger.
 *
 * WHAT THIS FILE REFUSES TO DO
 *
 *   * It never retries an ambiguous outcome. If the transport cannot say whether
 *     the provider accepted the request, the attempt settles `unknown_outcome`,
 *     which the ledger treats as terminal and review-required.
 *   * It never invents a payload. The authorization RPC returns the exact request
 *     whose digest the ledger stored, and it is forwarded unchanged.
 *   * It never treats a missing transport as a fact about the recipient.
 */

/** Minimal shape of the Supabase RPC surface this worker needs. */
export type CsfPluginRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

export type CsfWorkerClaim = {
  attemptId: string;
  campaignId: string;
  deliveryId: string;
  recipientSnapshotId: string;
  attemptNumber: number;
  providerIdempotencyKey: string;
  requestPayloadHash: string;
  leaseExpiresAt: string;
};

export type CsfWorkerAttemptReport = {
  attemptId: string;
  status:
    | "sent"
    | "refused"
    | "failed"
    | "retryable"
    | "unknown"
    | "authorization_lost";
  settlement?: CsfDispatchSettlement;
  blockedBy?: string;
  detail?: string;
  /**
   * What the LEDGER recorded, which is not always what this worker reported.
   *
   * A webhook can settle the attempt before the send call's own response returns,
   * and provider or officer reconciliation can move it on afterwards. In both
   * cases the settlement RPC accepts the worker's call as a confirmation or as a
   * superseded replay rather than raising -- and a raise is what would otherwise
   * put this worker into an unbounded retry loop against a ledger that has
   * already decided. Surfacing the ledger's own verdict keeps the caller able to
   * tell "I settled this" from "somebody else already had".
   */
  ledgerAttemptState?: string;
  supersededByReconciliation?: boolean;
  workerConfirmedProviderSettlement?: boolean;
};

export type CsfWorkerRunReport = {
  organizationId: string;
  workerId: string;
  claimed: number;
  attempts: CsfWorkerAttemptReport[];
};

export const CSF_COMMUNICATION_WORKER_MAX_CONCURRENCY = 5;
export const CSF_COMMUNICATION_WORKER_MAX_STARTS_PER_SECOND = 8;

export function createCsfProviderStartLimiter(
  options: {
    startsPerSecond?: number;
    now?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const startsPerSecond =
    options.startsPerSecond ?? CSF_COMMUNICATION_WORKER_MAX_STARTS_PER_SECOND;
  if (!Number.isInteger(startsPerSecond) || startsPerSecond < 1) {
    throw new RangeError(
      "Provider starts per second must be a positive integer",
    );
  }
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const intervalMs = Math.ceil(1_000 / startsPerSecond);
  let nextStartAt = 0;
  let queue = Promise.resolve();

  return async () => {
    let release!: () => void;
    const previous = queue;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const delayMs = Math.max(0, nextStartAt - now());
      if (delayMs > 0) await wait(delayMs);
      nextStartAt = Math.max(nextStartAt, now()) + intervalMs;
    } finally {
      release();
    }
  };
}

/**
 * A bounded RPC failure. Carries a code, never the raw database message.
 *
 * The raw text can contain a recipient address (it is embedded in several ledger
 * diagnostics by design, for operators reading the database directly). It must not
 * escape this module.
 */
export class CsfWorkerRpcError extends Error {
  readonly code: string;

  constructor(operation: string, code: string) {
    super(`CSF dispatch worker could not complete ${operation}`);
    this.name = "CsfWorkerRpcError";
    this.code = code;
  }
}

/** SQLSTATE is exactly five uppercase alphanumerics. Anything else is not one. */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * The bounded fault code for an RPC failure.
 *
 * `error.code` is where a structured classification is SUPPOSED to arrive, and for
 * PostgREST it does. But it is loosely typed, and a proxy, a driver, or a future
 * client version can put arbitrary text there -- so forwarding it unchecked would
 * reopen the exact channel `error.message` was closed for. A value that is not a
 * SQLSTATE becomes the caller-supplied fallback instead of travelling.
 */
export function boundedRpcFaultCode(
  code: string | undefined,
  fallback: string,
): string {
  return typeof code === "string" && SQLSTATE_PATTERN.test(code)
    ? code
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CsfWorkerRpcError(`reading ${key}`, "malformed_rpc_response");
  }
  return value;
}

/**
 * Validate a claim batch.
 *
 * An RPC response is untrusted input like any other. A worker that trusted a
 * malformed claim would go on to send with a half-built coordinate, so the shape is
 * checked before anything reaches the transport.
 */
export function parseClaimBatch(data: unknown): CsfWorkerClaim[] {
  if (!isRecord(data)) {
    throw new CsfWorkerRpcError(
      "claiming a dispatch batch",
      "malformed_rpc_response",
    );
  }

  const claims = data.claims;
  if (!Array.isArray(claims)) {
    throw new CsfWorkerRpcError(
      "claiming a dispatch batch",
      "malformed_rpc_response",
    );
  }

  return claims.map((claim) => {
    if (!isRecord(claim)) {
      throw new CsfWorkerRpcError(
        "claiming a dispatch batch",
        "malformed_rpc_response",
      );
    }

    const attemptNumber = claim.attemptNumber;
    if (typeof attemptNumber !== "number" || !Number.isInteger(attemptNumber)) {
      throw new CsfWorkerRpcError(
        "claiming a dispatch batch",
        "malformed_rpc_response",
      );
    }

    return {
      attemptId: requireString(claim, "attemptId"),
      campaignId: requireString(claim, "campaignId"),
      deliveryId: requireString(claim, "deliveryId"),
      recipientSnapshotId: requireString(claim, "recipientSnapshotId"),
      attemptNumber,
      providerIdempotencyKey: requireString(claim, "providerIdempotencyKey"),
      requestPayloadHash: requireString(claim, "requestPayloadHash"),
      leaseExpiresAt: requireString(claim, "leaseExpiresAt"),
    };
  });
}

export type ParsedAuthorization =
  | {
      authorized: true;
      coordinate: CsfDispatchCoordinate;
      providerPayload: CsfProviderPayload;
      requestPayloadHash: string;
      providerIdempotencyKey: string;
    }
  | { authorized: false; blockedBy: string; attemptState: string };

/**
 * Validate an authorization response.
 *
 * The digest and the idempotency key are re-checked against the claim, not merely
 * read. Those two values are the only reason a duplicate send is impossible: if the
 * authorization ever returned a payload that did not match the coordinate the claim
 * described, forwarding it would present a key that names a different message.
 */
export function parseAuthorization(
  data: unknown,
  claim: CsfWorkerClaim,
): ParsedAuthorization {
  if (!isRecord(data)) {
    throw new CsfWorkerRpcError(
      "authorizing a dispatch",
      "malformed_rpc_response",
    );
  }

  if (data.authorized !== true) {
    return {
      authorized: false,
      blockedBy:
        typeof data.blockedBy === "string" ? data.blockedBy : "unknown",
      attemptState:
        typeof data.attemptState === "string" ? data.attemptState : "unknown",
    };
  }

  const payload = data.providerPayload;
  const coordinate = data.coordinate;
  if (!isRecord(payload) || !isRecord(coordinate)) {
    throw new CsfWorkerRpcError(
      "authorizing a dispatch",
      "malformed_rpc_response",
    );
  }

  const requestPayloadHash = requireString(data, "requestPayloadHash");
  const providerIdempotencyKey = requireString(data, "providerIdempotencyKey");

  if (requestPayloadHash !== claim.requestPayloadHash) {
    // The ledger changed its mind about what this attempt sends between the claim
    // and the authorization. Sending either version would be a guess.
    throw new CsfWorkerRpcError(
      "authorizing a dispatch",
      "payload_digest_mismatch",
    );
  }

  if (providerIdempotencyKey !== claim.providerIdempotencyKey) {
    throw new CsfWorkerRpcError(
      "authorizing a dispatch",
      "idempotency_key_mismatch",
    );
  }

  if (payload.idempotencyKey !== providerIdempotencyKey) {
    // The key the ledger allocated must be the key that is actually transmitted.
    throw new CsfWorkerRpcError(
      "authorizing a dispatch",
      "idempotency_key_not_in_payload",
    );
  }

  return {
    authorized: true,
    coordinate: coordinate as unknown as CsfDispatchCoordinate,
    providerPayload: payload as unknown as CsfProviderPayload,
    requestPayloadHash,
    providerIdempotencyKey,
  };
}

function attemptStatusFor(
  settlement: CsfDispatchSettlement,
): CsfWorkerAttemptReport["status"] {
  switch (settlement.outcome) {
    case "accepted":
      return "sent";
    case "failed":
      return "failed";
    case "retryable_failure":
      return "retryable";
    case "suppressed":
      return "refused";
    case "unknown_outcome":
      return "unknown";
  }
}

/**
 * Dispatch one already-claimed attempt.
 *
 * Exported so a test can drive a single attempt without a claim batch, and so the
 * run loop below has exactly one place where a send happens.
 */
export async function dispatchClaimedAttempt(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    workerId: string;
    correlationId?: string;
    claim: CsfWorkerClaim;
    providerSignal?: AbortSignal;
    beforeProviderRequest?: () => Promise<void>;
    sendProviderRequest?: (
      payload: CsfProviderPayload & { signal?: AbortSignal },
    ) => Promise<SendEmailResult>;
  },
): Promise<CsfWorkerAttemptReport> {
  const {
    organizationId,
    workerId,
    correlationId,
    claim,
    providerSignal,
    beforeProviderRequest,
    sendProviderRequest = sendEmail,
  } = input;

  // 1. WAIT FOR THE PROVIDER START SLOT.
  //
  // Authorization must happen after this wait. A recipient can opt out or an
  // officer can cancel the campaign while concurrent sends are being paced.
  if (beforeProviderRequest) await beforeProviderRequest();

  // 2. AUTHORIZE IMMEDIATELY BEFORE SENDING.
  //
  // Not at claim time: a lease can last 1800 seconds, and a recipient can opt out or
  // bounce inside that window.
  const authorizeResponse = await plugin.rpc(
    "csf_authorize_communication_dispatch",
    {
      p_organization_id: organizationId,
      p_attempt_id: claim.attemptId,
      p_worker_id: workerId,
      p_correlation_id: correlationId ?? null,
    },
  );

  if (authorizeResponse.error) {
    // The lease may have been reaped, or another worker may hold it. Either way this
    // worker has no authority to send, and it must NOT settle an attempt it does not
    // own -- a stale fence settling would overwrite the real holder's outcome.
    return {
      attemptId: claim.attemptId,
      status: "authorization_lost",
      detail: boundedRpcFaultCode(
        authorizeResponse.error.code,
        "authorization_failed",
      ),
    };
  }

  const authorization = parseAuthorization(authorizeResponse.data, claim);

  if (!authorization.authorized) {
    // The ledger already settled this attempt as suppressed and reduced the
    // delivery. Nothing to send, and nothing left to settle.
    return {
      attemptId: claim.attemptId,
      status: "refused",
      blockedBy: authorization.blockedBy,
    };
  }

  // 3. EXACTLY ONE SEND, WITH THE PAYLOAD UNCHANGED.
  //
  // Spread rather than reconstructed: every field -- from, to, replyTo, subject,
  // both bodies, the tag array, headers, topicId, the transport type, and the
  // idempotency key -- is the object the ledger hashed. If Resend has seen this key
  // within its retention window it deduplicates; beyond that window the ledger's own
  // attempt coordinate is what prevents a second send, which is why nothing below
  // ever loops.
  const transportResult = await sendProviderRequest({
    ...authorization.providerPayload,
    ...(providerSignal ? { signal: providerSignal } : {}),
  });

  const settlement = mapTransportResultToSettlement(transportResult);

  // 4. SETTLE THE EXACT ATTEMPT.
  //
  // If this call fails the attempt stays leased and is later reaped as
  // unknown_outcome -- which is correct: we genuinely do not know whether the
  // settlement committed, and the provider may already have the message. The worker
  // does NOT retry the send to find out.
  const settleResponse = await plugin.rpc(
    "csf_settle_communication_dispatch_attempt",
    {
      p_organization_id: organizationId,
      p_attempt_id: claim.attemptId,
      p_worker_id: workerId,
      p_outcome: settlement.outcome,
      p_provider_message_id: settlement.providerMessageId,
      p_provider_status_code: settlement.providerStatusCode,
      p_failure_class: settlement.failureClass,
      p_detail: settlement.detail,
      p_metadata: settlement.metadata,
      p_retry_after_seconds: settlement.retryAfterSeconds ?? 60,
    },
  );

  if (settleResponse.error) {
    throw new CsfWorkerRpcError(
      "settling a dispatch attempt",
      boundedRpcFaultCode(settleResponse.error.code, "settlement_failed"),
    );
  }

  const settled = isRecord(settleResponse.data) ? settleResponse.data : {};

  return {
    attemptId: claim.attemptId,
    status: attemptStatusFor(settlement),
    settlement,
    ledgerAttemptState:
      typeof settled.attemptState === "string"
        ? settled.attemptState
        : undefined,
    supersededByReconciliation: settled.supersededByReconciliation === true,
    workerConfirmedProviderSettlement:
      settled.workerConfirmedProviderSettlement === true,
  };
}

/**
 * Claim a bounded batch and dispatch each attempt.
 *
 * Each attempt reauthorizes before its provider request. Concurrency and request
 * starts are both bounded so one run can drain a large queue without producing a
 * provider burst.
 */
export async function runCsfDispatchWorker(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    campaignId?: string | null;
    workerId: string;
    batchSize?: number;
    leaseSeconds?: number;
    correlationId?: string;
    providerSignal?: AbortSignal;
    concurrency?: number;
    waitForProviderStart?: () => Promise<void>;
    sendProviderRequest?: (
      payload: CsfProviderPayload & { signal?: AbortSignal },
    ) => Promise<SendEmailResult>;
  },
): Promise<CsfWorkerRunReport> {
  const requestedBatchSize = input.batchSize ?? 25;
  const claimResponse = await plugin.rpc(
    "csf_claim_communication_dispatch_batch",
    {
      p_organization_id: input.organizationId,
      p_campaign_id: input.campaignId ?? null,
      p_worker_id: input.workerId,
      p_batch_size: requestedBatchSize,
      p_lease_seconds: input.leaseSeconds ?? 120,
    },
  );

  if (claimResponse.error) {
    throw new CsfWorkerRpcError(
      "claiming a dispatch batch",
      boundedRpcFaultCode(claimResponse.error.code, "claim_failed"),
    );
  }

  const claims = parseClaimBatch(claimResponse.data);
  if (claims.length > requestedBatchSize) {
    // A caller uses a one-attempt claim to enforce its wall-clock budget. If the
    // database ever violates that bound, dispatching the oversized response
    // would turn a bounded route back into an unbounded provider loop. Refuse the
    // entire malformed batch before the first authorization or send. The leases
    // remain conservative and are reaped as unknown rather than guessed at.
    throw new CsfWorkerRpcError(
      "validating a dispatch batch bound",
      "malformed_rpc_response",
    );
  }
  const requestedConcurrency =
    input.concurrency ?? CSF_COMMUNICATION_WORKER_MAX_CONCURRENCY;
  if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1) {
    throw new RangeError("Worker concurrency must be a positive integer");
  }
  const concurrency = Math.min(
    requestedConcurrency,
    CSF_COMMUNICATION_WORKER_MAX_CONCURRENCY,
  );
  const waitForProviderStart =
    input.waitForProviderStart ?? createCsfProviderStartLimiter();
  const attempts = await mapWithConcurrency(
    claims,
    concurrency,
    async (claim) =>
      dispatchClaimedAttempt(plugin, {
        organizationId: input.organizationId,
        workerId: input.workerId,
        correlationId: input.correlationId,
        claim,
        providerSignal: input.providerSignal,
        beforeProviderRequest: waitForProviderStart,
        sendProviderRequest: input.sendProviderRequest,
      }),
  );

  return {
    organizationId: input.organizationId,
    workerId: input.workerId,
    claimed: claims.length,
    attempts,
  };
}
