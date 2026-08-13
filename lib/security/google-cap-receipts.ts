import "server-only";

import { createHash } from "node:crypto";

import type { GoogleCapEventDescriptor } from "@/lib/security/google-cap";
import { getAdminClient } from "@/lib/supabase/admin";

type ClaimRow = {
  receipt_id: string;
  decision: "execute" | "in_progress" | "replayed";
  claim_token: string | null;
  attempt_count: number;
  user_id: string | null;
};

export type GoogleCapClaim = {
  receiptId: string;
  decision: ClaimRow["decision"];
  claimToken: string | null;
  attemptCount: number;
  userId: string | null;
};

type EffectRow = {
  decision: "execute" | "identity_changed" | "lease_lost" | "no_local_user";
  user_id: string | null;
};

export type GoogleCapEffectAuthorization = {
  decision: EffectRow["decision"];
  userId: string | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function oneClaimRow(value: unknown): ClaimRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const candidate = row as Partial<ClaimRow>;
  if (
    typeof candidate.receipt_id !== "string" ||
    !["execute", "in_progress", "replayed"].includes(
      candidate.decision ?? "",
    ) ||
    (candidate.claim_token !== null &&
      typeof candidate.claim_token !== "string") ||
    !Number.isInteger(candidate.attempt_count) ||
    (candidate.user_id !== null && typeof candidate.user_id !== "string")
  ) {
    return null;
  }
  return candidate as ClaimRow;
}

function oneEffectRow(value: unknown): EffectRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const candidate = row as Partial<EffectRow>;
  if (
    !["execute", "identity_changed", "lease_lost", "no_local_user"].includes(
      candidate.decision ?? "",
    ) ||
    (candidate.user_id !== null && typeof candidate.user_id !== "string") ||
    (candidate.decision === "execute" &&
      typeof candidate.user_id !== "string") ||
    (candidate.decision !== "execute" && candidate.user_id !== null)
  ) {
    return null;
  }
  return candidate as EffectRow;
}

export async function claimGoogleCapEvent(
  descriptor: GoogleCapEventDescriptor,
  rawToken: string,
): Promise<GoogleCapClaim> {
  const service = getAdminClient();
  const subjectCoordinate = descriptor.googleSubject
    ? `${descriptor.issuer}\0${descriptor.googleSubject}`
    : `${descriptor.issuer}\0unmapped\0${descriptor.eventType}`;
  const { data, error } = await service.rpc("claim_google_cap_event", {
    p_jti_hash: sha256(`${descriptor.issuer}\0${descriptor.jti}`),
    p_token_hash: sha256(rawToken),
    p_subject_hash: sha256(subjectCoordinate),
    p_event_type: descriptor.eventType,
    p_issued_at: descriptor.issuedAt.toISOString(),
    p_google_subject: descriptor.googleSubject ?? "__unmapped__",
  });
  if (error) {
    throw new Error("Failed to claim Google CAP event");
  }

  const row = oneClaimRow(data);
  if (!row) {
    throw new Error("Google CAP claim returned an invalid result");
  }

  return {
    receiptId: row.receipt_id,
    decision: row.decision,
    claimToken: row.claim_token,
    attemptCount: row.attempt_count,
    userId: row.user_id,
  };
}

export async function beginGoogleCapEventEffect(options: {
  receiptId: string;
  claimToken: string;
  googleSubject: string;
}): Promise<GoogleCapEffectAuthorization> {
  const service = getAdminClient();
  const { data, error } = await service.rpc("begin_google_cap_event_effect", {
    p_receipt_id: options.receiptId,
    p_claim_token: options.claimToken,
    p_google_subject: options.googleSubject,
  });
  if (error) {
    throw new Error("Failed to fence Google CAP Auth effect");
  }

  const row = oneEffectRow(data);
  if (!row) {
    throw new Error(
      "Google CAP effect authorization returned an invalid result",
    );
  }

  return {
    decision: row.decision,
    userId: row.user_id,
  };
}

export async function finishGoogleCapEvent(options: {
  receiptId: string;
  claimToken: string;
  succeeded: boolean;
  safeOutcome: string;
  actionCount: number;
  errorCount: number;
}): Promise<boolean> {
  const service = getAdminClient();
  const { data, error } = await service.rpc("finish_google_cap_event", {
    p_receipt_id: options.receiptId,
    p_claim_token: options.claimToken,
    p_succeeded: options.succeeded,
    p_safe_outcome: options.safeOutcome,
    p_action_count: options.actionCount,
    p_error_count: options.errorCount,
  });
  if (error) {
    throw new Error("Failed to settle Google CAP event");
  }
  return data === true;
}
