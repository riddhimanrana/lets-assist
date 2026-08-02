import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * Resend webhook implementation for DVHS CSF durable communications.
 *
 * Ordering is the whole security property here:
 *
 *   1. require the three Svix headers, before any body is consumed,
 *   2. read the raw body as an exact string,
 *   3. verify the provider signature over THAT string,
 *   4. only then look at anything inside it.
 *
 * Step 1 exists so a request that cannot possibly verify is refused without
 * buffering an arbitrary payload from an unauthenticated caller. It reads no
 * body, so it cannot weaken step 3: the bytes handed to the verifier are still
 * the exact bytes that arrived, read once and inspected by nothing before it.
 *
 * Nothing in this file parses, routes on, or logs the payload before step 3.
 * The routing decision is taken from signed, allowlisted tags carried inside
 * the verified body -- never from a query parameter, header, or any other
 * caller-controlled channel outside the signature.
 *
 * PII: recipient addresses, sender addresses, subjects, bodies, and the raw
 * provider payload are never logged. Only the SHA-256 of the exact raw body is
 * persisted, alongside allowlisted operational scalars.
 */

export const runtime = "nodejs";

/** Signed tag that marks an event as belonging to the DVHS CSF plugin. */
export const CSF_PLUGIN_TAG = "csf_plugin";
export const CSF_PLUGIN_TAG_VALUE = "dvhs_csf";
/** Signed tag carrying the owning organization. */
export const CSF_ORGANIZATION_TAG = "csf_organization_id";
/** Signed tag carrying the campaign coordinate. */
export const CSF_CAMPAIGN_TAG = "csf_campaign_id";
/**
 * Signed tag carrying the dispatch attempt. This is what makes a webhook that
 * arrives BEFORE the worker's own settlement recoverable: the ledger can bind the
 * provider message identity to the right attempt and delivery without reading a
 * single byte of message content or a recipient address.
 */
export const CSF_ATTEMPT_TAG = "csf_attempt_id";
/** Signed tag carrying the broadcast topic, when the send was a broadcast. */
export const CSF_TOPIC_TAG = "csf_topic_key";

/**
 * Provider event types the CSF ledger models. Anything else that is signed and
 * CSF-tagged is still recorded -- the database keeps unknown types as evidence
 * and refuses to let them mutate delivery state -- so this list exists only to
 * decide what is worth sending on, not to gate correctness.
 */
export const CSF_SUPPORTED_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
  "email.delivery_delayed",
] as const;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type LegacySignedTag = { name?: unknown; value?: unknown };

export type CsfRouting = {
  isCsf: boolean;
  organizationId: string | null;
  campaignId: string | null;
  attemptId: string | null;
  topicKey: string | null;
};

/** SHA-256 of the exact raw request body, hex encoded. */
export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function isCsfSupportedEvent(eventType: unknown): boolean {
  return (
    typeof eventType === "string" &&
    (CSF_SUPPORTED_EVENT_TYPES as readonly string[]).includes(eventType)
  );
}

/**
 * Read one routing tag from a verified event.
 *
 * WEBHOOK TAGS ARE AN OBJECT, NOT AN ARRAY. Resend's send API accepts
 * `tags: [{name, value}]`, and it is easy to assume the webhook echoes that shape
 * back. It does not: `WebhookEvent.data.tags` is typed `Record<string, string>`,
 * e.g. `{"category": "confirm_email"}`. Reading only the array form meant every
 * routing tag came back null, so every real CSF webhook was silently
 * acknowledged as "some other product" and never reached the ledger.
 *
 * The object shape is therefore canonical and is checked first. The array branch
 * is kept only as a defensive path for a hand-built or proxied payload; it costs
 * nothing and removing it would turn a shape surprise back into silent data loss.
 */
function readSignedTag(event: unknown, tagName: string): string | null {
  const tags = (event as { data?: { tags?: unknown } })?.data?.tags;
  if (!tags || typeof tags !== "object") return null;

  if (!Array.isArray(tags)) {
    const value = (tags as Record<string, unknown>)[tagName];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  for (const candidate of tags as LegacySignedTag[]) {
    if (
      candidate &&
      typeof candidate === "object" &&
      candidate.name === tagName &&
      typeof candidate.value === "string" &&
      candidate.value.length > 0
    ) {
      return candidate.value;
    }
  }

  return null;
}

function readUuidTag(event: unknown, tagName: string): string | null {
  const value = readSignedTag(event, tagName);
  return value !== null && UUID_PATTERN.test(value) ? value : null;
}

/**
 * Decide whether a verified event belongs to CSF, using only tags that were
 * inside the signed body. A caller cannot route its own event into a tenant by
 * appending `?org=` to the URL, because nothing here reads the URL.
 *
 * The attempt and campaign coordinates are forwarded so the ledger can validate
 * them against the organization it already trusts. They are hints for routing,
 * never authority: the database re-resolves both tenant-scoped and refuses a pair
 * that disagrees.
 */
export function extractCsfRouting(event: unknown): CsfRouting {
  const plugin = readSignedTag(event, CSF_PLUGIN_TAG);
  const organizationId = readUuidTag(event, CSF_ORGANIZATION_TAG);
  const topicKey = readSignedTag(event, CSF_TOPIC_TAG);

  const isCsf = plugin === CSF_PLUGIN_TAG_VALUE && organizationId !== null;

  return {
    isCsf,
    organizationId: isCsf ? organizationId : null,
    campaignId: isCsf ? readUuidTag(event, CSF_CAMPAIGN_TAG) : null,
    attemptId: isCsf ? readUuidTag(event, CSF_ATTEMPT_TAG) : null,
    topicKey: isCsf && topicKey ? topicKey : null,
  };
}

export function resolveProviderMessageId(event: unknown): string | null {
  const emailId = (event as { data?: { email_id?: unknown } })?.data?.email_id;
  return typeof emailId === "string" && emailId.length > 0 ? emailId : null;
}

/**
 * The provider occurrence time, or null when the provider did not supply one.
 * Null is meaningful: the database records such an event as evidence but never
 * lets it move delivery truth, because it cannot be ordered against what is
 * already recorded.
 */
export function resolveOccurredAt(event: unknown): string | null {
  const envelope = event as { created_at?: unknown; data?: { created_at?: unknown } };
  const raw = envelope?.created_at ?? envelope?.data?.created_at;
  if (typeof raw !== "string" || raw.length === 0) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

/**
 * The one documented `email.suppressed` subtype, exact and case-sensitive.
 *
 * https://resend.com/docs/webhooks/emails/suppressed
 *
 * Resend types `EmailSuppressed.type` as a plain `string`, not an enum (resend
 * 6.18.1), so this is a value the provider may extend at any time. That is
 * precisely why the comparison lives in SQL against this exact literal and why
 * anything else is treated as unrecognized rather than guessed at.
 */
export const RESEND_ACCOUNT_SUPPRESSION_TYPE = "OnAccountSuppressionList";

/**
 * A provider token we are willing to persist: ASCII, 1-64 characters, starting
 * with a letter.
 *
 * Anchored with `^`/`$` and no `m` flag, so in JavaScript this matches the whole
 * string with no trailing-newline exception. `[A-Za-z]` is ASCII-only, so a
 * Cyrillic or fullwidth confusable never satisfies it.
 */
const PROVIDER_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** What we persist when the provider gave us anything that is not a token. */
export const UNKNOWN_PROVIDER_TOKEN = "Unknown";

/**
 * Read `data.suppressed.type` and nothing else.
 *
 * `data.suppressed.message` IS DELIBERATELY NEVER READ. It is provider free text:
 * it can contain the recipient's address, the documented token itself, SQL-shaped
 * text, and log-injection control characters. Retaining it -- in metadata, in a
 * hashed operator reason, in a log line, or as a classification input -- would
 * hand an outside party a channel into our own audit trail. There is no code path
 * from that field to anywhere, and this function is the reason.
 *
 * Classification is likewise never derived from `broadcast_id`, the provider
 * topic, the CSF topic tag, or a case-folded subtype. Only this one field, only
 * as an exact bounded token.
 *
 * Anything that is not a well-formed token -- missing, null, a number, an object,
 * an array, overlong, padded, control-bearing, or Unicode-confusable -- becomes
 * the fixed literal `Unknown`. Persisting `Unknown` rather than omitting the key
 * is deliberate: "we looked and it was not a token" and "we never looked" must be
 * distinguishable to whoever reads this evidence later.
 */
/**
 * The bounce types Resend documents, exact and case-sensitive.
 *
 * https://resend.com/docs/webhooks/emails/bounced
 *
 * The installed SDK types this field as a bare `string`, so the provider may
 * extend it. That is why the reviewed set lives here and anything outside it
 * becomes `Unknown` rather than being passed through: the database decides how
 * long to block a real address from this value, and an unreviewed token must
 * never reach that decision.
 */
export const RESEND_BOUNCE_TYPES = [
  "Permanent",
  "Transient",
  "Undetermined",
] as const;

/**
 * Read `data.bounce.type` as a reviewed, exact token.
 *
 * Previously this went through a generic `slice(0, 200)`, so any 200-character
 * prefix of anything the provider sent -- an address, a paragraph of prose, SQL,
 * control bytes -- was persisted and then interpolated into a durable
 * operator-facing safety reason. Exactness is the whole contract: no trimming, no
 * case folding, no alias.
 */
export function resolveBounceType(event: unknown): string {
  const type = (event as { data?: { bounce?: { type?: unknown } } })?.data
    ?.bounce?.type;
  if (typeof type !== "string") return UNKNOWN_PROVIDER_TOKEN;
  return (RESEND_BOUNCE_TYPES as readonly string[]).includes(type)
    ? type
    : UNKNOWN_PROVIDER_TOKEN;
}

/**
 * Read `data.bounce.subType` as a bounded token, and never classify on it.
 *
 * Resend's subtype values are provider-evolving strings with no documented closed
 * set, so there is no reviewed vocabulary to pin them against. Rather than invent
 * one, this keeps the subtype as diagnostic evidence only: it is bounded to the
 * same ASCII token shape as every other provider token, and NOTHING in the
 * database reads it to decide anything. An address block is decided by
 * `bounceType` alone.
 *
 * That bound is what keeps a confusable, padded, newline-bearing, NUL-bearing,
 * escape-bearing, address-shaped, SQL-shaped, or overlong value from surviving:
 * none of them is a token, so all of them become `Unknown`.
 */
export function resolveBounceSubtype(event: unknown): string {
  const bounce = (event as {
    data?: { bounce?: { subType?: unknown; sub_type?: unknown } };
  })?.data?.bounce;
  const subtype = bounce?.subType ?? bounce?.sub_type;
  if (typeof subtype !== "string") return UNKNOWN_PROVIDER_TOKEN;
  return PROVIDER_TOKEN_PATTERN.test(subtype)
    ? subtype
    : UNKNOWN_PROVIDER_TOKEN;
}

export function resolveSuppressionType(event: unknown): string {
  const suppressed = (event as { data?: { suppressed?: unknown } })?.data
    ?.suppressed;

  if (typeof suppressed !== "object" || suppressed === null) {
    return UNKNOWN_PROVIDER_TOKEN;
  }
  if (Array.isArray(suppressed)) return UNKNOWN_PROVIDER_TOKEN;

  const type = (suppressed as { type?: unknown }).type;
  if (typeof type !== "string") return UNKNOWN_PROVIDER_TOKEN;

  return PROVIDER_TOKEN_PATTERN.test(type) ? type : UNKNOWN_PROVIDER_TOKEN;
}

function boundedScalar(value: unknown): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value.slice(0, 200);
  return null;
}

/**
 * Allowlisted operational metadata. Deliberately built by naming each field
 * rather than by filtering the payload, so a new provider field can never
 * arrive here by default. Keys match the database allowlist, which compares
 * names with case and punctuation removed.
 *
 * Message content -- subject, body, snippets, headers, attachments, and the
 * `bounce.message` free-text field -- is never copied.
 */
export function buildProviderEventMetadata(
  event: unknown,
  routing: CsfRouting,
): Record<string, string | number | boolean> {
  const data = (event as { data?: Record<string, unknown> })?.data ?? {};
  const eventType = (event as { type?: unknown })?.type;

  const candidates: Record<string, unknown> = {
    emailId: data.email_id,
    broadcastId: data.broadcast_id,
    topicKey: routing.topicKey,
    // ALWAYS PRESENT ON A BOUNCE EVENT, EVEN WHEN UNREVIEWED, for the same
    // reason as suppressionType below: "the provider sent a type we do not
    // model" must be a recorded fact rather than an absence. bounceType decides
    // how long a real address stays blocked, so only a reviewed exact literal
    // reaches it; bounceSubtype is bounded diagnostic evidence that nothing
    // classifies on.
    ...(eventType === "email.bounced"
      ? {
          bounceType: resolveBounceType(event),
          bounceSubtype: resolveBounceSubtype(event),
        }
      : {}),
    // ALWAYS PRESENT ON A SUPPRESSION EVENT, EVEN WHEN UNRECOGNIZED.
    //
    // The database decides what an address-level block means from this key
    // alone, and only the exact literal above earns one. Emitting `Unknown`
    // rather than omitting the key makes "the provider sent a subtype we do not
    // model" a recorded fact instead of an absence, which is what the SQL
    // escalation path and any later audit both need.
    //
    // Note the key is `suppressionType`, not `suppressionReason`: a *Reason* key
    // invites somebody to put the provider's free-text message in it.
    ...(eventType === "email.suppressed"
      ? { suppressionType: resolveSuppressionType(event) }
      : {}),
  };

  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(candidates)) {
    const scalar = boundedScalar(raw);
    if (scalar !== null) metadata[key] = scalar;
  }

  return metadata;
}

/**
 * PII-free structured log. Only type names, opaque provider/tenant identifiers,
 * and ledger outcomes. Never an address, a subject, a body, or a raw payload.
 */
function logWebhook(
  level: "info" | "error",
  message: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  const line = { scope: "resend.webhook", ...fields };
  if (level === "error") {
    console.error(message, line);
  } else {
    console.info(message, line);
  }
}

export type LedgerError = { message: string; code: string | null };

/**
 * THE CLOSED QUARANTINE VOCABULARY. ONE LIST, TWO LAYERS.
 *
 * Every code this route may pass as `p_reason_code`. It is exported because the
 * SQL side enforces the SAME list twice -- in
 * `csf_comm_webhook_quarantine_reason_check` and in the quarantine RPC's own
 * argument validation -- and a route mock cannot see either. Route tests proved
 * the route emitted `cross_tenant_evidence`; nothing proved the table would
 * accept it, and it would not have: the CHECK still admitted an older vocabulary
 * (`cross_tenant_provider_message`, `contradictory_routing_tags`,
 * `permanent_application_conflict`). A real permanent conflict would have reached
 * `quarantineAndAcknowledge()`, violated the CHECK, and returned 503 -- so Resend
 * would retry forever the exact class of fault the quarantine exists to make
 * durable.
 *
 * `quarantine-reason-contract.test.ts` reads the migration and holds these three
 * lists identical. Adding a code here without adding it there fails that test.
 */
export const CSF_ROUTE_QUARANTINE_REASON_CODES = [
  "unroutable_tenant",
  "malformed_event_shape",
  "unsupported_event_shape",
  "immutable_replay_conflict",
  "contradictory_routing_evidence",
  "cross_tenant_evidence",
  "unknown_tenant_coordinate",
] as const;

export type CsfQuarantineReasonCode =
  (typeof CSF_ROUTE_QUARANTINE_REASON_CODES)[number];

/**
 * The one code the DATABASE authors and the route may never send.
 *
 * The RPC writes it when the same envelope and reason arrive carrying a different
 * raw-body digest. It is in the table's CHECK but deliberately absent from the
 * route's list, and the RPC rejects it as caller input -- that asymmetry is what
 * keeps the conflict record something only the serialized compare-then-act path
 * can produce.
 */
export const CSF_RPC_AUTHORED_QUARANTINE_REASON_CODES = [
  "conflicting_quarantine_evidence",
] as const;

const ROUTE_QUARANTINE_REASON_SET: ReadonlySet<string> = new Set(
  CSF_ROUTE_QUARANTINE_REASON_CODES,
);

/** Whether a code may be handed to the quarantine RPC at all. */
export function isQuarantineReasonCode(
  code: string,
): code is CsfQuarantineReasonCode {
  return ROUTE_QUARANTINE_REASON_SET.has(code);
}

/**
 * The ledger diagnostics that mean "no retry can ever fix this", each with the
 * code it quarantines under and the sentence that travels with it.
 *
 * ONE TABLE, BECAUSE THREE PARALLEL ONES COULD DISAGREE. Permanence, the reason
 * code, and the authored detail used to live in three separate lists that had to
 * be kept in lockstep by hand. Nothing enforced it, and the failure mode was
 * specific: a marker present in the permanence list but absent from the code list
 * would classify as permanent, derive `unclassified_ledger_failure`, and try to
 * quarantine a code no CHECK admits. Deriving all three from one row makes
 * "permanent" and "has a quarantine code" the same fact.
 *
 * NEITHER HALF IS SUFFICIENT ALONE, SO BOTH ARE REQUIRED.
 *
 * The SQLSTATE alone is far too broad. `23505` is generic unique_violation: the
 * ledger raises it for the immutable replay conflict, but PostgreSQL also raises
 * it for an ordinary concurrent-insert race a retry WOULD resolve. `23503` is
 * every foreign-key violation in the schema.
 *
 * The message alone is no better, and that was the live defect. `error.message`
 * is whatever the client hands us, and the layers between this route and the
 * ledger are numerous: a PostgREST envelope, a connection pooler, a proxy, a
 * resource-exhaustion notice, a driver-authored string. Any of them can carry a
 * sentence containing "belongs to another organization" -- for instance by
 * echoing a failed request body, or by wrapping the ledger's own text in a
 * transport error that is emphatically retryable. Matching the substring alone
 * meant such a failure was acknowledged 200 and filed as permanently
 * quarantined, and the event was never retried.
 *
 * Requiring BOTH an exact authored SQLSTATE and the marker makes a false
 * positive require a transport that reproduces the ledger's sentence AND
 * surfaces the ledger's exact five-character code. A missing or malformed code,
 * a different code with the same message, or the right code without the marker
 * all stay retryable -- which is the recoverable direction.
 *
 * Every `detail` is authored here. None is derived from the database's own
 * message -- a ledger diagnostic interpolates the coordinate it was given, and a
 * constraint violation's `details`/`hint` routinely carries the offending ROW,
 * which for these tables means a recipient address.
 */
const PERMANENT_LEDGER_FAULTS: ReadonlyArray<{
  readonly sqlstate: string;
  readonly marker: string;
  readonly code: CsfQuarantineReasonCode;
  readonly detail: string;
}> = [
  {
    // unique_violation, raised by the provider-event envelope uniqueness guard.
    sqlstate: "23505",
    marker: "was already recorded with different immutable evidence",
    code: "immutable_replay_conflict",
    detail: "envelope already recorded with different immutable evidence",
  },
  {
    // check_violation, raised by the resolver's contradictory-binding guard.
    sqlstate: "23514",
    marker: "refusing to bind contradictory evidence",
    code: "contradictory_routing_evidence",
    detail:
      "signed routing tags name a dispatch attempt and a provider message belonging to different deliveries",
  },
  {
    // foreign_key_violation: the coordinate resolves, but not in this tenant.
    sqlstate: "23503",
    marker: "belongs to another organization",
    code: "cross_tenant_evidence",
    detail: "signed routing coordinate belongs to another organization",
  },
  {
    // foreign_key_violation: the coordinate does not resolve here at all.
    sqlstate: "23503",
    marker: "does not exist in this organization",
    code: "unknown_tenant_coordinate",
    detail: "signed routing coordinate does not exist in this organization",
  },
];

/**
 * The code a permanent fault quarantines under, or null when it is not permanent.
 *
 * Null is the only honest answer for an unrecognized failure, and it is what keeps
 * `unclassified_ledger_failure` out of the durable vocabulary entirely -- see
 * `ledgerReasonCode()`.
 *
 * The SQLSTATE goes through `boundedSqlState()` first, so a code of the wrong
 * shape is null here and matches nothing rather than being compared raw.
 */
function permanentQuarantineFault(
  error: LedgerError,
): (typeof PERMANENT_LEDGER_FAULTS)[number] | null {
  const sqlstate = boundedSqlState(error.code);
  if (sqlstate === null) return null;

  const message = error.message ?? "";
  return (
    PERMANENT_LEDGER_FAULTS.find(
      (fault) => fault.sqlstate === sqlstate && message.includes(fault.marker),
    ) ?? null
  );
}

/** SQLSTATE is exactly five uppercase alphanumerics. Anything else is not one. */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * A validated SQLSTATE, or null.
 *
 * PostgREST normally surfaces the real five-character class, but `error.code` is
 * typed loosely and a proxy, a mock, or a future client version can put an
 * arbitrary string there. Logging it unchecked would be one more channel for
 * unbounded text, so the shape is proved before the value is used.
 */
export function boundedSqlState(code: string | null | undefined): string | null {
  return typeof code === "string" && SQLSTATE_PATTERN.test(code) ? code : null;
}

/**
 * Map a ledger failure to one of this module's own reason codes.
 *
 * RAW DATABASE TEXT IS NOT A LOG FIELD. The previous version logged
 * `reason: error.message` on the strength of a comment claiming those sentences
 * are authored in this repository and carry no PII. Both halves are wrong in
 * practice: several ledger diagnostics interpolate a value they were given --
 * a provider message identity, a campaign status, a state name -- and the client
 * can surface a PostgREST envelope, a connection error, or a driver message that
 * this repository never wrote at all. A `details`/`hint` pair on a constraint
 * violation routinely carries the offending ROW, which for these tables means a
 * recipient address.
 *
 * So the message is read here, once, to pick a slug from a closed list, and the
 * slug is what travels. Nothing unrecognized becomes text.
 *
 * `unclassified_ledger_failure` IS NOT A QUARANTINE REASON. It is what this
 * function answers for a failure no marker matched -- a storage outage, schema
 * drift, a PostgREST envelope, a driver message. Those are retryable by
 * definition, so the code exists only as a bounded LOG value and is deliberately
 * absent from `CSF_ROUTE_QUARANTINE_REASON_CODES` and from the table CHECK.
 * Admitting it to the durable vocabulary would have meant inventing a triage
 * bucket whose whole content is "we do not know", and pretending an unclassified
 * fault was a decided one. It stays fail-closed instead: nothing unclassified can
 * be quarantined, because nothing unclassified is ever permanent.
 */
export function ledgerReasonCode(error: LedgerError): string {
  return permanentQuarantineFault(error)?.code ?? "unclassified_ledger_failure";
}

/**
 * Classify a thrown value without reading any text off it.
 *
 * `error.name` is a string an arbitrary throw site controls, so it is not a safe
 * log field either. Constructor identity is.
 */
export function thrownFaultKind(error: unknown): string {
  if (error instanceof TypeError) return "type_error";
  if (error instanceof RangeError) return "range_error";
  if (error instanceof SyntaxError) return "syntax_error";
  if (error instanceof Error) return "error";
  return "non_error";
}

/**
 * Classify a ledger failure as permanent or retryable.
 *
 * GETTING THIS WRONG COSTS REAL EVIDENCE, IN BOTH DIRECTIONS. Calling a transient
 * fault permanent quarantines an event that would have applied on the next attempt;
 * calling a permanent conflict retryable leaves Resend re-delivering it forever
 * while nothing is ever written. Anything unclassified is treated as retryable,
 * because a retry is recoverable and a wrongly-quarantined event is not.
 *
 * Read from the same rows as `ledgerReasonCode()`, so "permanent" and "has a
 * quarantine code the SQL contract admits" cannot come apart.
 */
export function ledgerFailureClass(error: LedgerError): "permanent" | "retryable" {
  return permanentQuarantineFault(error) ? "permanent" : "retryable";
}

/**
 * The sanitized detail that belongs with a derived reason code.
 *
 * QUARANTINING THE WRONG REASON IS QUARANTINING A LIE. The permanent-failure path
 * derived a real reason code and then filed every case as
 * `immutable_replay_conflict` with a replay sentence, so a cross-tenant routing
 * tag and an unknown organization coordinate -- both of which are security
 * evidence, not a duplicate webhook -- landed on the worklist wearing a benign
 * label an operator would reasonably close as a harmless retry.
 */
export function ledgerQuarantineDetail(reasonCode: string): string | null {
  return (
    PERMANENT_LEDGER_FAULTS.find((fault) => fault.code === reasonCode)?.detail ?? null
  );
}

/**
 * Whether the signed body claims to be ours.
 *
 * Read separately from full routing because the plugin tag and the tenant tag fail
 * independently: a signed event can say "I am DVHS CSF" while carrying a corrupt
 * organization tag, and that combination is CSF poison rather than another product's
 * traffic. Discarding it would delete the only evidence that our own send produced
 * an unroutable event.
 */
export function readsCsfPluginTag(event: unknown): boolean {
  const tags = (event as { data?: { tags?: unknown } })?.data?.tags;
  if (!tags || typeof tags !== "object") return false;

  if (!Array.isArray(tags)) {
    return (tags as Record<string, unknown>)[CSF_PLUGIN_TAG] === CSF_PLUGIN_TAG_VALUE;
  }

  return (tags as LegacySignedTag[]).some(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      candidate.name === CSF_PLUGIN_TAG &&
      candidate.value === CSF_PLUGIN_TAG_VALUE,
  );
}

/**
 * Durably record one signed event that cannot be routed or applied.
 *
 * Lazily imported for the same reason as the ledger binding: `@/lib/plugins/supabase`
 * pulls in `server-only`.
 */
export async function quarantineCsfProviderEvent(input: {
  providerEventId: string;
  rawBodyHash: string;
  reasonCode: string;
  reasonDetail: string;
  eventType: string | null;
  providerMessageId: string | null;
  claimedOrganizationId: string | null;
  claimedAttemptId: string | null;
  claimedCampaignId: string | null;
}): Promise<{ error: LedgerError | null; data: unknown }> {
  const { createPluginAdminClient } = await import("@/lib/plugins/supabase");
  const pluginDb = createPluginAdminClient();

  const { data, error } = await pluginDb.rpc("csf_quarantine_communication_webhook", {
    p_provider_event_id: input.providerEventId,
    p_raw_body_hash: input.rawBodyHash,
    p_reason_code: input.reasonCode,
    p_reason_detail: input.reasonDetail,
    p_event_type: input.eventType,
    p_provider_message_id: input.providerMessageId,
    p_claimed_organization_id: input.claimedOrganizationId,
    p_claimed_attempt_id: input.claimedAttemptId,
    p_claimed_campaign_id: input.claimedCampaignId,
  });

  return {
    data,
    error: error
      ? {
          message: error.message,
          code: typeof error.code === "string" ? error.code : null,
        }
      : null,
  };
}

/**
 * Indirection so the focused tests can exercise the route without a Supabase
 * client. The real implementation is imported lazily: `@/lib/plugins/supabase`
 * pulls in `server-only`, which must not load in a plain unit-test process
 * unless that test asks for it.
 */
export async function recordCsfProviderEvent(input: {
  organizationId: string;
  providerEventId: string;
  eventType: string;
  providerMessageId: string | null;
  occurredAt: string | null;
  rawBodyHash: string;
  signatureKeyId: string | null;
  metadata: Record<string, string | number | boolean>;
  attemptId: string | null;
  campaignId: string | null;
}): Promise<{ error: LedgerError | null; data: unknown }> {
  const { createPluginAdminClient } = await import("@/lib/plugins/supabase");
  const pluginDb = createPluginAdminClient();

  const { data, error } = await pluginDb.rpc(
    "csf_record_communication_provider_event",
    {
      p_organization_id: input.organizationId,
      p_provider_event_id: input.providerEventId,
      p_event_type: input.eventType,
      p_provider_message_id: input.providerMessageId,
      p_occurred_at: input.occurredAt,
      p_raw_body_hash: input.rawBodyHash,
      p_signature_verified: true,
      p_signature_scheme: "svix",
      p_signature_key_id: input.signatureKeyId,
      p_metadata: input.metadata,
      p_attempt_id: input.attemptId,
      p_campaign_id: input.campaignId,
    },
  );

  return {
    data,
    error: error
      ? {
          message: error.message,
          // PostgREST surfaces the raw SQLSTATE, which is how a structured
          // classification stays independent of exception wording.
          code: typeof error.code === "string" ? error.code : null,
        }
      : null,
  };
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  // VERIFICATION NEEDS THE WEBHOOK SECRET AND NOTHING ELSE.
  //
  // Resend's `webhooks.verify()` is a pure local Svix HMAC over the raw body; it
  // never touches the API key or the network. A deployment configured only to
  // RECEIVE webhooks therefore has everything it needs, and requiring
  // RESEND_API_KEY here would reject every legitimate event over a credential
  // that plays no part in verifying or storing one.
  //
  // The cost of getting this wrong is not a single lost event. Resend delivers at
  // least once and retries anything that is not a 200, so an endpoint that 4xxs
  // on a missing SEND credential does not fail quietly -- it fails repeatedly,
  // turning a configuration gap into a growing redelivery backlog while never
  // recording the evidence it was retrying to deliver.
  //
  // A missing WEBHOOK secret is different, and answers 500 below on purpose: that
  // is a real server-side fault, and being retried is exactly what we want, so the
  // event is still deliverable once an operator supplies the secret.
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET is not configured." },
      { status: 500 },
    );
  }

  // Step 1: the required Svix headers, BEFORE the body is consumed.
  //
  // A request missing any of the three cannot be verified no matter what it
  // carries, so reading its body first would mean buffering an arbitrary,
  // unauthenticated payload from any caller purely to discard it. Checking the
  // headers first makes an obviously unverifiable request cost a few header
  // lookups instead.
  //
  // This reordering does NOT weaken the verification contract below: nothing here
  // parses, hashes, logs, or routes anything, and once the headers exist the body
  // is still read exactly once, as a string, and handed to the verifier byte for
  // byte before anything else looks at it.
  const signature = req.headers.get("svix-signature");
  const timestamp = req.headers.get("svix-timestamp");
  const id = req.headers.get("svix-id");

  if (!signature || !timestamp || !id) {
    return NextResponse.json({ error: "Missing webhook headers." }, { status: 400 });
  }

  // Step 2: the exact bytes, as a string. Nothing is parsed yet.
  const payload = await req.text();

  /**
   * `svix-id` IS ATTACKER-CONTROLLED UNTIL THE SIGNATURE CHECKS OUT.
   *
   * Anyone can POST here with any header, so logging the raw value before
   * verification lets an unauthenticated caller write chosen text into our logs --
   * useful for log injection, for poisoning a grep, or simply for noise. A one-way
   * digest still correlates a rejected attempt across log lines without echoing
   * what the caller supplied.
   */
  const providerEventDigest = sha256Hex(id).slice(0, 16);

  // The constructor throws without a key, and only the local verifier is used
  // below, so a placeholder keeps webhook receipt independent of send credentials.
  // No method on this instance that touches the network is ever called.
  const resend = new Resend(
    process.env.RESEND_API_KEY ?? "re_local_verification_only",
  );

  // Step 3: verify. An unverified body is never inspected, hashed for storage,
  // routed, or logged.
  let event: unknown;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret,
    });
  } catch {
    // Deliberately carries neither the error nor any payload fragment nor the raw
    // envelope id: an attacker controls every one of those on a request that fails
    // verification.
    logWebhook("error", "Rejected unverified Resend webhook.", {
      providerEventDigest,
    });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  // Step 4: everything below runs only on verified content.
  const eventType = (event as { type?: unknown })?.type;
  const routing = extractCsfRouting(event);

  // The digest is over the exact verified string, so the stored evidence can be
  // re-verified later without keeping the message itself.
  const rawBodyHash = sha256Hex(payload);
  const boundedEventType =
    typeof eventType === "string" && eventType.length > 0 && eventType.length <= 100
      ? eventType
      : null;

  /**
   * The ONLY event-type value permitted to leave this handler.
   *
   * A VERIFIED SIGNATURE PROVES ORIGIN, NOT SAFETY. `boundedEventType` is bounded
   * in length and nothing else: it is attacker-influenced text from the request
   * body, and a valid signature only proves Resend relayed it. Bounded is not
   * sanitized. Passing it through meant an unmodelled type reached a durable
   * `reason_detail`, the quarantine row's `event_type` column, and a structured
   * log line verbatim -- so a value carrying control characters could corrupt a
   * log pipeline or a terminal, and one shaped like an address could plant text
   * that reads as recipient data inside an audit record that promises it holds
   * none.
   *
   * A SUPPORTED type is safe by construction: it is compared against
   * CSF_SUPPORTED_EVENT_TYPES, so what survives is one of this module's own
   * closed tokens, not the caller's string. Anything else collapses to the fixed
   * token `unsupported`. The event is still quarantined, still durable, still on
   * a worklist -- an operator reads the envelope id and goes to the provider's
   * own dashboard for the literal type, which is where unbounded provider text
   * belongs.
   */
  const safeEventType: string | null = isCsfSupportedEvent(boundedEventType)
    ? boundedEventType
    : boundedEventType === null
      ? null
      : "unsupported";

  /**
   * Durably capture a signed event we cannot route or apply, then acknowledge.
   *
   * RESEND EXPECTS HTTP 200 AND RETRIES EVERY OTHER RESPONSE. The previous 409 was
   * written on the assumption that a 4xx tells the provider to stop; it does not. A
   * signed event we kept refusing came back on a retry schedule forever, failed
   * identically each time, and -- because nothing was ever written -- did so
   * invisibly.
   *
   * The status is 200 exactly, not merely a 2xx. That distinction is load-bearing:
   * under this contract a 202 or 204 is not an acknowledgement either, so an
   * "acknowledge without a body" tidy-up here would silently restore the same
   * retry loop this branch exists to end.
   *
   * So the fault is made durable first and acknowledged second. 200 here does not
   * mean "applied": it means "we have taken responsibility for this event and an
   * operator can see it". If the quarantine write itself fails we return 5xx,
   * because then we genuinely have not -- and being retried is then the correct
   * outcome.
   */
  async function quarantineAndAcknowledge(
    reasonCode: CsfQuarantineReasonCode,
    detail: string,
  ): Promise<NextResponse> {
    // FAIL CLOSED ON A CODE THE SQL CONTRACT DOES NOT ADMIT.
    //
    // The parameter is typed, so this is unreachable from this module -- but the
    // cost of being wrong is asymmetric and silent. An unadmitted code makes the
    // RPC raise, which this function reports as a quarantine outage: 503, and
    // Resend retries forever while nothing is ever written. Refusing to make the
    // call at all produces the same 503 without a pointless round trip, and logs
    // a code an operator can actually search for.
    if (!isQuarantineReasonCode(reasonCode)) {
      logWebhook("error", "CSF webhook quarantine refused an unmodelled reason.", {
        providerEventId: id,
        eventType: safeEventType,
        reasonCode,
      });
      return NextResponse.json(
        { error: "Webhook quarantine unavailable." },
        { status: 503 },
      );
    }

    try {
      const { data, error } = await quarantineCsfProviderEvent({
        providerEventId: id!,
        rawBodyHash,
        reasonCode,
        reasonDetail: detail,
        // The closed token, never the caller's string. See safeEventType.
        eventType: safeEventType,
        providerMessageId: resolveProviderMessageId(event),
        claimedOrganizationId: routing.organizationId,
        claimedAttemptId: routing.attemptId,
        claimedCampaignId: routing.campaignId,
      });

      if (error) {
        logWebhook("error", "CSF webhook quarantine failed.", {
          providerEventId: id,
          eventType: safeEventType,
          reasonCode,
          quarantineFailureCode: ledgerReasonCode(error),
          sqlstate: boundedSqlState(error.code),
        });
        // Not durable, so not acknowledged. A retry is exactly what we want.
        return NextResponse.json(
          { error: "Webhook quarantine unavailable." },
          { status: 503 },
        );
      }

      const captured = (data ?? {}) as {
        quarantineId?: string;
        occurrenceCount?: number;
        firstCapture?: boolean;
        conflict?: boolean;
      };

      logWebhook("info", "Quarantined signed CSF webhook.", {
        providerEventId: id,
        eventType: safeEventType,
        reasonCode,
        firstCapture: captured.firstCapture ?? false,
        occurrenceCount: captured.occurrenceCount ?? 1,
        conflict: captured.conflict ?? false,
      });

      return NextResponse.json({
        received: true,
        csf: true,
        quarantined: true,
        reasonCode,
      });
    } catch (error) {
      logWebhook("error", "CSF webhook quarantine threw.", {
        providerEventId: id,
        reasonCode,
        faultKind: thrownFaultKind(error),
      });
      return NextResponse.json(
        { error: "Webhook quarantine unavailable." },
        { status: 503 },
      );
    }
  }

  // A SIGNED CSF-TAGGED EVENT WE CANNOT ROUTE IS CSF POISON, NOT SOMEBODY ELSE'S
  // EVENT.
  //
  // The plugin tag says this came from us. If the tenant tag is missing or
  // malformed, discarding it as "non-CSF" throws away the only record that our own
  // send produced an unroutable event -- and the tenant tag is exactly the field a
  // bug or a tampered integration would corrupt. It is quarantined with a null
  // organization, because no evidence proves one.
  const claimsCsf = readsCsfPluginTag(event);

  if (claimsCsf && !routing.organizationId) {
    return quarantineAndAcknowledge(
      "unroutable_tenant",
      "signed CSF event carried a missing or malformed organization tag",
    );
  }

  if (!routing.isCsf || !routing.organizationId) {
    // Genuinely another product's signed event. Acknowledged, not persisted.
    // Another product's event type is no more trustworthy than ours, and we model
    // it even less. It gets the same closed treatment.
    logWebhook("info", "Acknowledged non-CSF Resend webhook.", {
      providerEventId: id,
      eventType: safeEventType ?? "unknown",
      csf: false,
    });
    return NextResponse.json({ received: true, csf: false });
  }

  if (!boundedEventType) {
    // Signed, ours, and shapeless. Durable evidence beats a 400 the provider would
    // retry forever.
    return quarantineAndAcknowledge(
      "malformed_event_shape",
      "signed CSF event carried no usable event type",
    );
  }

  if (!isCsfSupportedEvent(boundedEventType)) {
    // A signed CSF event of a type this ledger does not model. The database would
    // retain it as inert evidence, but quarantining names it explicitly so a new
    // provider event type shows up on a worklist instead of silently doing nothing.
    //
    // THE DIAGNOSTIC IS STATIC. It used to interpolate the supplied type into a
    // durable reason_detail -- the one column on this row that an operator reads
    // as prose, in a table whose contract is that it holds no unbounded provider
    // text. The reason code and the envelope id are what make this triageable;
    // the literal type is available from the provider's own dashboard.
    return quarantineAndAcknowledge(
      "unsupported_event_shape",
      "signed CSF event type is not modelled by this ledger",
    );
  }

  // Past this point the envelope id is verified provider content, so logging it
  // is safe and is what makes an event traceable to the provider's dashboard.
  //
  // And past the allowlist guard above, boundedEventType is provably one of
  // CSF_SUPPORTED_EVENT_TYPES -- this module's own closed token, equal to
  // safeEventType -- so the remaining uses below carry no caller-supplied text.
  try {
    const { data, error } = await recordCsfProviderEvent({
      organizationId: routing.organizationId,
      providerEventId: id,
      eventType: boundedEventType,
      providerMessageId: resolveProviderMessageId(event),
      occurredAt: resolveOccurredAt(event),
      rawBodyHash,
      signatureKeyId: null,
      metadata: buildProviderEventMetadata(event, routing),
      attemptId: routing.attemptId,
      campaignId: routing.campaignId,
    });

    if (error) {
      // One lookup drives all three: whether this is permanent, the code it
      // quarantines under, and the sentence that travels with it. They cannot
      // disagree because they are the same row.
      const fault = permanentQuarantineFault(error);
      const classification: "permanent" | "retryable" = fault
        ? "permanent"
        : "retryable";

      logWebhook("error", "CSF provider event was refused by the ledger.", {
        providerEventId: id,
        eventType: boundedEventType,
        organizationId: routing.organizationId,
        // A slug from this module's own closed list -- never the database's own
        // sentence, which can interpolate a coordinate or arrive from a layer
        // this repository did not author. See ledgerReasonCode().
        reasonCode: fault?.code ?? "unclassified_ledger_failure",
        sqlstate: boundedSqlState(error.code),
        classification,
      });

      if (fault) {
        // A permanent application conflict -- a replayed envelope carrying
        // different immutable evidence, contradictory routing tags, a coordinate
        // owned by another tenant, or one that does not exist here. Retrying
        // cannot fix any of them, and anything other than a 200 would make Resend
        // retry anyway, so the conflict itself becomes the durable record -- filed
        // under the reason actually derived, with the sentence that matches it.
        return quarantineAndAcknowledge(fault.code, fault.detail);
      }

      // Storage outage, schema drift, or anything unclassified: ask for a retry.
      return NextResponse.json(
        { error: "Webhook ledger unavailable." },
        { status: 503 },
      );
    }

    const result = (data ?? {}) as {
      duplicate?: boolean;
      processingState?: string;
      reductionApplied?: boolean;
    };

    logWebhook("info", "Recorded CSF provider event.", {
      providerEventId: id,
      eventType: boundedEventType,
      organizationId: routing.organizationId,
      duplicate: result.duplicate ?? false,
      processingState: result.processingState ?? "unknown",
      reductionApplied: result.reductionApplied ?? false,
    });

    // An exact duplicate is a success: the ledger already holds this evidence.
    return NextResponse.json({
      received: true,
      csf: true,
      duplicate: result.duplicate ?? false,
      processingState: result.processingState ?? null,
    });
  } catch (error) {
    // A thrown transport or runtime fault is never a conflict. 5xx so the provider
    // retries once we are healthy again.
    logWebhook("error", "Failed to record CSF provider event.", {
      providerEventId: id,
      eventType: boundedEventType,
      organizationId: routing.organizationId,
      faultKind: thrownFaultKind(error),
    });
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 503 });
  }
}
