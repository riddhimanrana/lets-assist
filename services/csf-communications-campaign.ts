import "server-only";

import type { CsfPluginRpc } from "@/services/csf-communications-worker";
import {
  boundedRpcFaultCode,
  CsfWorkerRpcError,
} from "@/services/csf-communications-worker";

/**
 * The minimum server-only surface needed to bring a CSF campaign from draft to
 * queued work.
 *
 * Deliberately small. This packet needs enough to create, snapshot, finalize, and
 * queue a synthetic campaign so the dispatch path is executable end to end; it is
 * not a campaign management API and there is no browser-callable action here.
 *
 * WHAT A CALLER MAY NOT SUPPLY
 *
 * Nothing about addressing or provider identity. The sender, reply-to, provider
 * topic, recipient snapshot, content digest, tags, and idempotency key are all
 * derived by the ledger from stored rows. A caller supplies the campaign's editable
 * draft content, the audience it wants snapshotted, and an actor -- and the database
 * decides the rest. That is what makes "the payload the worker sends is the payload
 * the ledger hashed" true rather than aspirational.
 *
 * `server-only` is imported for the same reason as the worker: the queued work this
 * produces results in real mail.
 */

export type CsfCampaignRecipient = {
  email: string;
  name?: string;
  provenance:
    | "response_contact"
    | "preferred_contact"
    | "account_email"
    | "representative_record"
    | "staff_entry"
    | "import_record";
  profileId?: string;
  userId?: string;
  clubRepresentativeId?: string;
  partnerClubTermId?: string;
  responseContactEmail?: string;
  preferredContactEmail?: string;
  exclusionReason?: "invalid_address" | "duplicate" | "not_eligible";
};

export type CsfSnapshotSummary = {
  recorded: number;
  alreadyRecorded: number;
  included: number;
  excluded: number;
};

export type CsfFinalizeSummary = {
  audienceDigest: string;
  audienceSize: number;
  includedRecipients: number;
  deliveriesCreated: number;
  attemptsEnqueued: number;
  idempotentReplay: boolean;
};

function unwrap<T>(
  response: { data: unknown; error: { message: string; code?: string } | null },
  operation: string,
): T {
  if (response.error) {
    // Bounded: the ledger's diagnostics deliberately name rows and addresses for an
    // operator reading the database. None of that may reach a caller.
    throw new CsfWorkerRpcError(
      operation,
      boundedRpcFaultCode(response.error.code, "rpc_failed"),
    );
  }
  return response.data as T;
}

/**
 * Snapshot an audience onto a draft campaign.
 *
 * Idempotent per address: a replayed call records only the addresses not already
 * present, and refuses outright if a replayed row would differ materially.
 */
export async function snapshotCsfCampaignAudience(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    campaignId: string;
    recipients: CsfCampaignRecipient[];
  },
): Promise<CsfSnapshotSummary> {
  const response = await plugin.rpc("csf_snapshot_communication_recipients", {
    p_organization_id: input.organizationId,
    p_campaign_id: input.campaignId,
    p_recipients: input.recipients,
  });

  const data = unwrap<Record<string, unknown>>(
    response,
    "snapshotting a campaign audience",
  );

  return {
    recorded: Number(data.recorded ?? 0),
    alreadyRecorded: Number(data.alreadyRecorded ?? 0),
    included: Number(data.included ?? 0),
    excluded: Number(data.excluded ?? 0),
  };
}

/**
 * Declare the draft copy ready.
 *
 * This is the transition that derives the content digest and freezes sender,
 * subject, bodies, metadata, topic, term, audience kind, and the provider topic
 * together. Before it, the draft is editable; after it, none of those may move.
 */
export async function finalizeCsfCampaignContent(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    campaignId: string;
    actorUserId: string;
    correlationId?: string;
  },
): Promise<{ contentHash: string | null; idempotentReplay: boolean }> {
  const response = await plugin.rpc(
    "csf_finalize_communication_campaign_content",
    {
      p_organization_id: input.organizationId,
      p_campaign_id: input.campaignId,
      p_actor_user_id: input.actorUserId,
      p_correlation_id: input.correlationId ?? null,
    },
  );

  const data = unwrap<Record<string, unknown>>(
    response,
    "finalizing campaign content",
  );

  return {
    contentHash: (data.contentHash as string | null) ?? null,
    idempotentReplay: data.idempotentReplay === true,
  };
}

/**
 * Close the audience and open the dispatch ledger.
 *
 * `expectedIncludedCount` is not decoration: finalization refuses if the audience is
 * not the size the caller counted, which is what stops a half-built audience from
 * being dispatched as though it were complete.
 */
export async function finalizeCsfCampaignAudience(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    campaignId: string;
    expectedIncludedCount?: number;
  },
): Promise<CsfFinalizeSummary> {
  const response = await plugin.rpc(
    "csf_finalize_communication_recipient_snapshot",
    {
      p_organization_id: input.organizationId,
      p_campaign_id: input.campaignId,
      p_expected_included_count: input.expectedIncludedCount ?? null,
    },
  );

  const data = unwrap<Record<string, unknown>>(
    response,
    "finalizing a campaign audience",
  );

  return {
    audienceDigest: String(data.audienceDigest ?? ""),
    audienceSize: Number(data.audienceSize ?? 0),
    includedRecipients: Number(data.includedRecipients ?? 0),
    deliveriesCreated: Number(data.deliveriesCreated ?? 0),
    attemptsEnqueued: Number(data.attemptsEnqueued ?? 0),
    idempotentReplay: data.idempotentReplay === true,
  };
}

/**
 * Withdraw a campaign.
 *
 * Requires an actor holding the tenant-scoped staff capability, settles the
 * outstanding work, and never enqueues a retry behind it.
 */
export async function cancelCsfCampaign(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    campaignId: string;
    reason: string;
    actorUserId: string;
    correlationId?: string;
  },
): Promise<{ status: string; attemptsSettled: number; idempotentReplay: boolean }> {
  const response = await plugin.rpc("csf_cancel_communication_campaign", {
    p_organization_id: input.organizationId,
    p_campaign_id: input.campaignId,
    p_reason: input.reason,
    p_actor_user_id: input.actorUserId,
    p_correlation_id: input.correlationId ?? null,
  });

  const data = unwrap<Record<string, unknown>>(response, "cancelling a campaign");

  return {
    status: String(data.status ?? "unknown"),
    attemptsSettled: Number(data.attemptsSettled ?? 0),
    idempotentReplay: data.idempotentReplay === true,
  };
}
