import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  getGoogleCapEventDescriptor,
  googleCapEventRequiresAuthEffect,
  GoogleCapValidationError,
  handleGoogleCapPayload,
  validateGoogleCapToken,
} from "@/lib/security/google-cap";
import {
  beginGoogleCapEventEffect,
  claimGoogleCapEvent,
  finishGoogleCapEvent,
  type GoogleCapClaim,
} from "@/lib/security/google-cap-receipts";
import {
  GoogleCapRequestError,
  readGoogleCapToken,
} from "@/lib/security/google-cap-request";

export const runtime = "nodejs";

function retryResponse(requestId: string) {
  return NextResponse.json(
    { error: "Security event processing is temporarily unavailable" },
    {
      status: 503,
      headers: {
        "retry-after": "30",
        "x-request-id": requestId,
        "cache-control": "no-store",
      },
    },
  );
}

function acceptedResponse(requestId: string, replayed: boolean) {
  return NextResponse.json(
    { received: true, ...(replayed ? { replayed: true } : {}) },
    {
      status: 202,
      headers: {
        "x-request-id": requestId,
        "cache-control": "no-store",
      },
    },
  );
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  let claim: GoogleCapClaim | null = null;

  try {
    const rawToken = await readGoogleCapToken(request);
    const decoded = await validateGoogleCapToken(rawToken);
    const descriptor = getGoogleCapEventDescriptor(decoded);
    claim = await claimGoogleCapEvent(descriptor, rawToken);

    if (claim.decision === "replayed") {
      console.info("Google CAP event accepted", {
        requestId,
        outcome: "replayed",
        attemptCount: claim.attemptCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return acceptedResponse(requestId, true);
    }

    if (claim.decision === "in_progress" || !claim.claimToken) {
      console.warn("Google CAP event deferred", {
        requestId,
        outcome: "in_progress",
        attemptCount: claim.attemptCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return retryResponse(requestId);
    }

    let effectUserId = claim.userId;
    if (googleCapEventRequiresAuthEffect(descriptor.eventType)) {
      if (!descriptor.googleSubject) {
        throw new GoogleCapValidationError(
          "CAP event is missing its required user subject",
        );
      }
      const effect = await beginGoogleCapEventEffect({
        receiptId: claim.receiptId,
        claimToken: claim.claimToken,
        googleSubject: descriptor.googleSubject,
      });
      if (effect.decision !== "execute" || !effect.userId) {
        console.warn("Google CAP event deferred", {
          requestId,
          outcome: effect.decision,
          attemptCount: claim.attemptCount,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return retryResponse(requestId);
      }
      effectUserId = effect.userId;
    }

    const result = await handleGoogleCapPayload(decoded, effectUserId);
    if (result.settlement === "hold") {
      console.error("Google CAP Auth outcome requires reconciliation", {
        requestId,
        outcome: result.safeOutcome,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return retryResponse(requestId);
    }
    const succeeded = result.errorCount === 0;
    const settled = await finishGoogleCapEvent({
      receiptId: claim.receiptId,
      claimToken: claim.claimToken,
      succeeded,
      safeOutcome: result.safeOutcome,
      actionCount: result.actionCount,
      errorCount: result.errorCount,
    });

    if (!settled || !succeeded) {
      console.error("Google CAP event requires retry", {
        requestId,
        outcome: settled ? "action_failed" : "settlement_lost",
        actionCount: result.actionCount,
        errorCount: result.errorCount,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return retryResponse(requestId);
    }

    console.info("Google CAP event accepted", {
      requestId,
      outcome: result.safeOutcome,
      actionCount: result.actionCount,
      errorCount: result.errorCount,
      attemptCount: claim.attemptCount,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return acceptedResponse(requestId, false);
  } catch (error) {
    if (
      error instanceof GoogleCapRequestError ||
      error instanceof GoogleCapValidationError
    ) {
      const status =
        error instanceof GoogleCapRequestError ? error.status : 400;
      console.warn("Google CAP event rejected", {
        requestId,
        outcome: status === 413 ? "body_too_large" : "invalid_token",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return NextResponse.json(
        { error: "Invalid security event token" },
        {
          status,
          headers: {
            "x-request-id": requestId,
            "cache-control": "no-store",
          },
        },
      );
    }

    // A configuration, JWKS, database, auth-admin, or settlement failure must
    // stay retryable. Returning 400 here would tell Google to discard a valid
    // security event permanently.
    console.error("Google CAP event processing unavailable", {
      requestId,
      outcome: claim ? "post_claim_failure" : "pre_claim_failure",
      durationMs: Math.round(performance.now() - startedAt),
    });
    return retryResponse(requestId);
  }
}
