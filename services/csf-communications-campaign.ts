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

export type CsfCampaignDraft = {
  campaignId: string;
  status: string;
  campaignKind: string;
};

/**
 * Who may record a topic-consent decision.
 *
 * Exactly two, and `"provider"` is absent by construction rather than validated
 * away at runtime. A Resend event names an address and a message, never a chapter
 * and a CSF topic, so provider feedback is address-safety evidence and never
 * topic-consent authority.
 */
export type CsfPreferenceActorKind = "recipient" | "staff";

export type CsfBroadcastPreferenceResult = {
  organizationId: string;
  topicKey: string;
  /** The SHA-256 of the address. The address itself is never returned. */
  recipientEmailHash: string;
  subscriptionState: "subscribed" | "unsubscribed";
  applied: boolean;
  created: boolean;
  reason?: string;
};

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
 * Create one draft campaign.
 *
 * THE SENDER IS NOT A PARAMETER, and that is the point. `from`, `replyTo`, the
 * channel, the content digest, the provider idempotency key, and every lifecycle
 * timestamp are derived by the ledger. A caller supplies editable copy, the
 * audience shape it wants, and an actor; it can never propose a different From or
 * Reply-To, because there is nowhere to put one.
 *
 * Authorization is the database's, not this wrapper's:
 * `csf_create_communication_campaign_draft` proves the actor holds the
 * tenant-scoped CSF staff capability and raises 42501 otherwise. This function
 * deliberately performs no check of its own -- a second, weaker copy of an
 * authorization rule is how the two drift apart.
 */
export async function createCsfCampaignDraft(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    campaignKind: "broadcast" | "transactional";
    subject: string;
    bodyText: string;
    actorUserId: string;
    termId?: string;
    audienceKind?: string;
    bodyHtml?: string;
    broadcastTopicKey?: string;
    resendTopicId?: string;
    tags?: Record<string, string>;
    correlationId?: string;
  },
): Promise<CsfCampaignDraft> {
  const response = await plugin.rpc("csf_create_communication_campaign_draft", {
    p_organization_id: input.organizationId,
    p_campaign_kind: input.campaignKind,
    p_subject: input.subject,
    p_body_text: input.bodyText,
    p_actor_user_id: input.actorUserId,
    p_term_id: input.termId ?? null,
    p_audience_kind: input.audienceKind ?? null,
    p_body_html: input.bodyHtml ?? null,
    p_broadcast_topic_key: input.broadcastTopicKey ?? null,
    p_resend_topic_id: input.resendTopicId ?? null,
    p_tags: input.tags ?? {},
    p_correlation_id: input.correlationId ?? null,
  });

  const data = unwrap<Record<string, unknown>>(
    response,
    "creating a campaign draft",
  );

  return {
    campaignId: String(data.campaignId ?? ""),
    status: String(data.status ?? "draft"),
    campaignKind: String(data.campaignKind ?? input.campaignKind),
  };
}

/**
 * Edit a draft campaign's content.
 *
 * Only while it is a draft. Once content is finalized the digest binds the
 * recipient snapshot and every allocated provider idempotency key, so editing
 * behind it would make the stored digest describe a document nobody sent -- the
 * RPC raises 23514 rather than allowing it.
 *
 * Sender identity, kind, topic, term, and audience are not editable here at all.
 */
export async function updateCsfCampaignDraft(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    campaignId: string;
    actorUserId: string;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
    correlationId?: string;
  },
): Promise<{ campaignId: string; status: string; updated: boolean }> {
  const response = await plugin.rpc("csf_update_communication_campaign_draft", {
    p_organization_id: input.organizationId,
    p_campaign_id: input.campaignId,
    p_actor_user_id: input.actorUserId,
    p_subject: input.subject ?? null,
    p_body_text: input.bodyText ?? null,
    p_body_html: input.bodyHtml ?? null,
    p_correlation_id: input.correlationId ?? null,
  });

  const data = unwrap<Record<string, unknown>>(
    response,
    "updating a campaign draft",
  );

  return {
    campaignId: String(data.campaignId ?? input.campaignId),
    status: String(data.status ?? "draft"),
    updated: data.updated === true,
  };
}

/**
 * Record one broadcast opt-out or resubscribe.
 *
 * BROADCASTS ONLY. The topic is required and the reserved key 'transactional' is
 * refused: a chapter's mandatory operational mail cannot be switched off through
 * this path, by construction rather than by convention.
 *
 * The three actor paths are different claims and the RPC keeps them apart:
 *
 *   recipient -- names no account and must present the SHA-256 of the exact
 *     address it verified, so a verified self-service path can only ever affect
 *     its own address-bound identity.
 *   staff     -- names an account holding the tenant capability, plus a mandatory
 *     documented reason for the request being relayed.
 *
 * THERE IS NO PROVIDER PATH, AND IT IS NOT EXPRESSIBLE HERE.
 *
 * `actorKind` admits exactly two values and there is no field for a provider
 * event coordinate, so a provider decision cannot be constructed -- it is a type
 * error, not a runtime rejection. The database refuses it too, with 42501.
 *
 * The reason is that Resend's events do not carry the facts the decision needs.
 * `email.bounced`, `email.complained`, and `email.suppressed` are statements about
 * an ADDRESS and a MESSAGE; `contact.updated` carries contact-level or global
 * subscription state with no CSF organization and no CSF topic in it. None of
 * them can be mapped onto "this person withdrew consent for this chapter's this
 * topic" without a durable provider-contact binding that does not exist yet.
 * Provider feedback updates address safety instead, which blocks delivery on its
 * own terms and is deliberately separate from consent.
 *
 * REMAINING ITEM, STATED PLAINLY: there is no browser-facing unsubscribe token
 * route yet. This wrapper and its RPC are the server contract a token route would
 * call once it has verified a token and resolved it to an address; the token
 * surface itself is not implemented and is not simulated here.
 */
export async function recordCsfBroadcastPreferenceDecision(
  plugin: CsfPluginRpc,
  input: {
    organizationId: string;
    topicKey: string;
    recipientEmail: string;
    decision: "opt_out" | "resubscribe";
    /**
     * Two values, deliberately. See the note above: a provider decision is not
     * a shape this function can express.
     */
    actorKind: CsfPreferenceActorKind;
    reason?: string;
    actorUserId?: string;
    /** Required for the recipient path: SHA-256 of the verified address. */
    verifiedRecipientEmailHash?: string;
    correlationId?: string;
  },
): Promise<CsfBroadcastPreferenceResult> {
  const response = await plugin.rpc(
    "csf_record_broadcast_preference_decision",
    {
      p_organization_id: input.organizationId,
      p_topic_key: input.topicKey,
      p_recipient_email: input.recipientEmail,
      p_decision: input.decision,
      p_actor_kind: input.actorKind,
      p_reason: input.reason ?? null,
      p_actor_user_id: input.actorUserId ?? null,
      p_verified_recipient_email_hash: input.verifiedRecipientEmailHash ?? null,
      // p_provider_event_row_id is absent, not null: the parameter no longer
      // exists on the RPC, and sending it would fail to resolve the overload.
      p_correlation_id: input.correlationId ?? null,
    },
  );

  const data = unwrap<Record<string, unknown>>(
    response,
    "recording a broadcast preference decision",
  );

  return {
    organizationId: String(data.organizationId ?? input.organizationId),
    topicKey: String(data.topicKey ?? input.topicKey),
    recipientEmailHash: String(data.recipientEmailHash ?? ""),
    subscriptionState:
      data.subscriptionState === "unsubscribed" ? "unsubscribed" : "subscribed",
    applied: data.applied === true,
    created: data.created === true,
    ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
  };
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
