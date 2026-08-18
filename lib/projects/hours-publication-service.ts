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

function isTransactionalPublication(
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
  entries: Array<{ signupId: string; checkIn: string; checkOut: string }>;
  requestKey: string;
  origin?: "manual" | "automatic";
}): Promise<HoursPublicationRpcResult<TransactionalPublication>> {
  const admin = getAdminClient();
  const rpcArguments = {
    p_actor_id: input.actorId,
    p_project_id: input.projectId,
    p_schedule_id: input.scheduleId,
    p_entries: input.entries,
    p_request_key: input.requestKey,
  };

  return executeReplaySafeHoursPublicationRpc(
    async () =>
      await admin.rpc(
        input.origin === "automatic"
          ? "publish_volunteer_hours_transactional_automatic"
          : "publish_volunteer_hours_transactional",
        rpcArguments,
      ),
    isTransactionalPublication,
  );
}
