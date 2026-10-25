import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import {
  executeReplaySafeHoursPublicationRpc,
  type HoursPublicationRpcResult,
} from "./hours-publication-rpc";

export type PublicationDelivery = {
  deliveryId: string;
  state: string;
  payloadPrepared: boolean;
  idempotencyKey: string;
  certificateId: string;
  volunteerName: string | null;
  volunteerEmail: string | null;
  eventStart: string;
  eventEnd: string;
  creditedMinutes?: number | null;
  attendanceRevision?: number;
};

export type TransactionalPublication = {
  outcome: "accepted" | "replayed";
  receiptId: string;
  requestKey: string;
  certificatesCreated: number;
  projectTitle: string;
  projectTimezone: string | null;
  publicationOrigin: "manual" | "automatic";
  deliveries: PublicationDelivery[];
};

export function isTransactionalPublication(
  value: unknown,
): value is TransactionalPublication {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.outcome === "accepted" || candidate.outcome === "replayed") &&
    typeof candidate.receiptId === "string" &&
    typeof candidate.requestKey === "string" &&
    typeof candidate.certificatesCreated === "number" &&
    typeof candidate.projectTitle === "string" &&
    (typeof candidate.projectTimezone === "string" ||
      candidate.projectTimezone === null) &&
    (candidate.publicationOrigin === "manual" ||
      candidate.publicationOrigin === "automatic") &&
    Array.isArray(candidate.deliveries)
  );
}

export async function publishVolunteerHoursTransaction(input: {
  actorId: string;
  projectId: string;
  scheduleId: string;
  entries: Array<{
    signupId: string;
    checkIn: string;
    checkOut: string;
    intervals?: Array<{ checkIn: string; checkOut: string }>;
    attendanceRevision?: number;
    timeExceptionReason?: string;
  }>;
  requestKey: string;
  origin?: "manual" | "automatic";
  // The entries are a database claim. Publication is refused when the
  // session's required attendance no longer equals them.
  claimedSnapshot?: boolean;
}): Promise<HoursPublicationRpcResult<TransactionalPublication>> {
  const admin = getAdminClient();
  const rpcArguments = {
    p_actor_id: input.actorId,
    p_project_id: input.projectId,
    p_schedule_id: input.scheduleId,
    p_entries: input.entries,
    p_request_key: input.requestKey,
  };
  const automaticRpc = input.claimedSnapshot
    ? "publish_claimed_volunteer_hours_automatic"
    : "publish_volunteer_hours_transactional_automatic";

  return executeReplaySafeHoursPublicationRpc(
    async () =>
      await admin.rpc(
        input.origin === "automatic"
          ? automaticRpc
          : "publish_volunteer_hours_transactional",
        rpcArguments,
      ),
    isTransactionalPublication,
  );
}

export type SupplementalCertificateRecovery = {
  issued: number;
  publication: TransactionalPublication | null;
  recoveryRequired: boolean;
};

function isSupplementalCertificateRecovery(
  value: unknown,
): value is SupplementalCertificateRecovery {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(candidate.issued) &&
    Number(candidate.issued) >= 0 &&
    typeof candidate.recoveryRequired === "boolean" &&
    (candidate.publication === null ||
      isTransactionalPublication(candidate.publication))
  );
}

/**
 * Issue missing awards for a published session together with their receipt
 * and email ledger. A repeated call issues nothing new and returns the
 * requested awards' existing deliveries, so a lost response is safe to retry.
 */
export async function recoverSupplementalCertificates(input: {
  actorId: string;
  projectId: string;
  scheduleId: string;
  signupIds: string[];
}): Promise<HoursPublicationRpcResult<SupplementalCertificateRecovery>> {
  const admin = getAdminClient();
  const rpcArguments = {
    p_project_id: input.projectId,
    p_schedule_id: input.scheduleId,
    p_signup_ids: input.signupIds,
    p_actor_id: input.actorId,
  };
  return executeReplaySafeHoursPublicationRpc(
    async () =>
      await admin.rpc(
        "recover_supplemental_verified_certificates",
        rpcArguments,
      ),
    isSupplementalCertificateRecovery,
  );
}

export async function requestCorrectedCertificateDelivery(input: {
  actorId: string;
  projectId: string;
  certificateId: string;
  expectedRevision: number;
  requestId: string;
}): Promise<HoursPublicationRpcResult<TransactionalPublication>> {
  const admin = getAdminClient();
  const rpcArguments = {
    p_actor_id: input.actorId,
    p_project_id: input.projectId,
    p_certificate_id: input.certificateId,
    p_expected_revision: input.expectedRevision,
    p_request_id: input.requestId,
  };
  return executeReplaySafeHoursPublicationRpc(
    async () =>
      await admin.rpc("request_corrected_certificate_delivery", rpcArguments),
    isTransactionalPublication,
  );
}
