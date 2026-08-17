import "server-only";

import { decrypt, encrypt } from "@/lib/encryption";
import { getAdminClient } from "@/lib/supabase/admin";

import {
  GOOGLE_OAUTH_ATTEMPT_LEASE_SECONDS,
  GOOGLE_OAUTH_ATTEMPT_TTL_SECONDS,
  type GoogleOAuthAttemptSecrets,
} from "./google-oauth-attempt";
import type {
  GoogleOAuthConnectionPurpose,
  GoogleOAuthCsfImportCapability,
} from "./google-oauth-state";

/**
 * Server-only access to the durable Google OAuth attempt ledger.
 *
 * The ledger itself lives in `app_private`, which is outside PostgREST's
 * exposed schemas; these calls therefore go through the service_role-only
 * `public` wrappers created alongside it. No browser-reachable role holds
 * EXECUTE on either the wrappers or the implementations.
 */

export type GoogleOAuthAttemptBinding = {
  purpose: GoogleOAuthConnectionPurpose;
  organizationId: string | null;
  pluginKey: "dvhs-csf" | null;
  requestedCapability: GoogleOAuthCsfImportCapability | null;
};

export type GoogleOAuthClaimVerdict =
  | "claimed"
  | "in_progress"
  | "already_settled"
  | "expired"
  | "unknown_attempt"
  | "cookie_mismatch"
  | "user_mismatch"
  | "session_mismatch";

export type GoogleOAuthClaim =
  | {
      verdict: "claimed";
      attemptId: string;
      claimEpoch: number;
      binding: GoogleOAuthAttemptBinding;
      returnTo: string;
      codeVerifier: string;
      correlationId: string;
    }
  | {
      verdict: "in_progress";
      returnTo: string;
      correlationId: string;
    }
  | {
      verdict: "already_settled";
      binding: GoogleOAuthAttemptBinding;
      returnTo: string;
      correlationId: string;
      recordedStatus: "succeeded" | "failed" | "unknown";
      recordedOutcomeCode: string | null;
      recordedConnectionId: string | null;
    }
  | {
      verdict: "expired";
      returnTo: string | null;
      correlationId: string | null;
    }
  | {
      verdict:
        | "unknown_attempt"
        | "cookie_mismatch"
        | "user_mismatch"
        | "session_mismatch";
      correlationId: string | null;
    };

type ClaimRow = {
  verdict: GoogleOAuthClaimVerdict;
  attempt_id: string | null;
  claim_epoch: number | null;
  purpose: GoogleOAuthConnectionPurpose | null;
  organization_id: string | null;
  plugin_key: "dvhs-csf" | null;
  requested_capability: GoogleOAuthCsfImportCapability | null;
  return_to: string | null;
  code_verifier_encrypted: string | null;
  correlation_id: string | null;
  recorded_status: "succeeded" | "failed" | "unknown" | null;
  recorded_outcome_code: string | null;
  recorded_connection_id: string | null;
};

/**
 * Record a pending attempt.
 *
 * Returns false when the ledger write fails. The caller must not send the
 * browser to Google in that case: without a durable record the callback could
 * not be claimed, verified, or made idempotent, so an unrecorded attempt is
 * strictly worse than a clear failure at the start.
 */
export async function beginGoogleOAuthAttempt(input: {
  secrets: GoogleOAuthAttemptSecrets;
  userId: string;
  sessionDigest: string;
  binding: GoogleOAuthAttemptBinding;
  returnTo: string;
}): Promise<boolean> {
  const admin = getAdminClient();
  const { error } = await admin.rpc("begin_google_oauth_attempt", {
    p_attempt_ref: input.secrets.attemptRef,
    p_state_digest: input.secrets.stateDigest,
    p_cookie_digest: input.secrets.cookieDigest,
    p_user_id: input.userId,
    p_session_digest: input.sessionDigest,
    p_purpose: input.binding.purpose,
    p_organization_id: input.binding.organizationId,
    p_plugin_key: input.binding.pluginKey,
    p_requested_capability: input.binding.requestedCapability,
    p_return_to: input.returnTo,
    p_code_challenge: input.secrets.codeChallenge,
    // The verifier is a credential for the pending exchange, so it is never
    // written in the clear even inside a server-only schema.
    p_code_verifier_encrypted: encrypt(input.secrets.codeVerifier),
    p_correlation_id: input.secrets.correlationId,
    p_ttl_seconds: GOOGLE_OAUTH_ATTEMPT_TTL_SECONDS,
  });

  if (error) {
    console.error("Failed to record Google OAuth attempt", {
      correlationId: input.secrets.correlationId,
      code: error.code ?? null,
    });
    return false;
  }

  return true;
}

function toBinding(row: ClaimRow): GoogleOAuthAttemptBinding {
  return {
    purpose: row.purpose as GoogleOAuthConnectionPurpose,
    organizationId: row.organization_id,
    pluginKey: row.plugin_key,
    requestedCapability: row.requested_capability,
  };
}

/**
 * Atomically claim the attempt named by this callback.
 *
 * Exactly one caller receives `claimed` and the PKCE verifier. A duplicate is
 * told whether the original exchange is still running (`in_progress`) or has
 * already settled (`already_settled`, carrying the recorded outcome), so a
 * replayed callback can never exchange the authorization code twice.
 */
export async function claimGoogleOAuthAttempt(input: {
  stateDigest: string;
  cookieSecretDigest: string;
  userId: string;
  sessionDigest: string;
}): Promise<GoogleOAuthClaim> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("claim_google_oauth_attempt", {
    p_state_digest: input.stateDigest,
    p_cookie_digest: input.cookieSecretDigest,
    p_user_id: input.userId,
    p_session_digest: input.sessionDigest,
    p_lease_seconds: GOOGLE_OAUTH_ATTEMPT_LEASE_SECONDS,
  });

  if (error) {
    console.error("Failed to claim Google OAuth attempt", {
      code: error.code ?? null,
    });
    return { verdict: "unknown_attempt", correlationId: null };
  }

  const row = (Array.isArray(data) ? data[0] : data) as ClaimRow | undefined;
  if (!row) return { verdict: "unknown_attempt", correlationId: null };

  switch (row.verdict) {
    case "claimed": {
      if (!row.attempt_id || row.claim_epoch === null || !row.return_to) {
        return { verdict: "unknown_attempt", correlationId: null };
      }
      let codeVerifier: string;
      try {
        codeVerifier = decrypt(row.code_verifier_encrypted ?? "");
      } catch {
        // An undecryptable verifier means the attempt cannot complete PKCE.
        // Settle it rather than attempting an exchange that Google will reject.
        await finalizeGoogleOAuthAttempt({
          attemptId: row.attempt_id,
          claimEpoch: row.claim_epoch,
          status: "failed",
          outcomeCode: "attempt_unreadable",
          connectionId: null,
        });
        return {
          verdict: "expired",
          returnTo: row.return_to,
          correlationId: row.correlation_id,
        };
      }
      return {
        verdict: "claimed",
        attemptId: row.attempt_id,
        claimEpoch: row.claim_epoch,
        binding: toBinding(row),
        returnTo: row.return_to,
        codeVerifier,
        correlationId: row.correlation_id ?? "",
      };
    }
    case "in_progress":
      return {
        verdict: "in_progress",
        returnTo: row.return_to ?? "/account/calendar",
        correlationId: row.correlation_id ?? "",
      };
    case "already_settled":
      return {
        verdict: "already_settled",
        binding: toBinding(row),
        returnTo: row.return_to ?? "/account/calendar",
        correlationId: row.correlation_id ?? "",
        recordedStatus: row.recorded_status ?? "failed",
        recordedOutcomeCode: row.recorded_outcome_code,
        recordedConnectionId: row.recorded_connection_id,
      };
    case "expired":
      return {
        verdict: "expired",
        returnTo: row.return_to,
        correlationId: row.correlation_id,
      };
    default:
      return { verdict: row.verdict, correlationId: row.correlation_id };
  }
}

/**
 * Record the terminal outcome for the current claimant.
 *
 * A false return means this worker's lease had already lapsed and another
 * callback took over; the caller must not treat its own result as authoritative
 * and should surface the recovery state instead.
 */
export async function finalizeGoogleOAuthAttempt(input: {
  attemptId: string;
  claimEpoch: number;
  status: "succeeded" | "failed" | "unknown";
  outcomeCode: string;
  connectionId: string | null;
}): Promise<boolean> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("finalize_google_oauth_attempt", {
    p_attempt_id: input.attemptId,
    p_claim_epoch: input.claimEpoch,
    p_status: input.status,
    p_outcome_code: input.outcomeCode,
    p_connection_id: input.connectionId,
  });

  if (error) {
    console.error("Failed to finalize Google OAuth attempt", {
      attemptId: input.attemptId,
      code: error.code ?? null,
    });
    return false;
  }

  return data === true;
}

/**
 * Record that this attempt's single-use authorization code has been presented
 * to Google. After this the attempt is never retryable: a later callback that
 * finds the lease lapsed reconciles to an explicit unknown outcome instead of
 * re-exchanging a spent code and reporting a misleading provider failure.
 */
export async function markGoogleOAuthAttemptExchanged(input: {
  attemptId: string;
  claimEpoch: number;
}): Promise<boolean> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc(
    "mark_google_oauth_attempt_exchanged",
    { p_attempt_id: input.attemptId, p_claim_epoch: input.claimEpoch },
  );

  if (error) {
    console.error("Failed to mark Google OAuth code exchange", {
      attemptId: input.attemptId,
      code: error.code ?? null,
    });
    return false;
  }

  return data === true;
}
