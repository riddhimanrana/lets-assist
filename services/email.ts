import { Resend } from "resend";
import * as React from "react";

/**
 * Construct the provider client, or say precisely why not.
 *
 * `new Resend(...)` throws on a missing key, and it used to be called bare: with
 * the constructor inside the send try/catch that failure was classified as
 * `unknown_outcome`, i.e. "a real person may already have been mailed" -- for a
 * client that was never built and a socket that was never opened. Outside that
 * catch it would instead have escaped as a raw throw. Neither is true or useful.
 *
 * A setup result is a bounded discriminant, not an exception.
 */
type ResendSetup =
  | { ok: true; client: Resend }
  | { ok: false; configured: false }
  | { ok: false; configured: true; code: string };

function getResendClientForKey(apiKey: string | undefined): ResendSetup {
  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, configured: false };
  }

  try {
    return { ok: true, client: new Resend(apiKey) };
  } catch {
    // The key is present but the SDK refused it. Nothing was sent, so this is a
    // pre-send fault the operator can fix -- never provider ambiguity.
    return { ok: false, configured: true, code: "resend_client_setup_failed" };
  }
}

/** Sending-only provider client used by every delivery worker. */
export function getResendClient(): ResendSetup {
  return getResendClientForKey(process.env.RESEND_API_KEY);
}

export type EmailType = "project_updates" | "general" | "transactional";

export interface EmailAttachment {
  filename: string;
  content: string;
}

export type EmailTag = {
  name: string;
  value: string;
};

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  react?: React.ReactElement;
  userId?: string; // Optional: if provided, checks user preferences
  type: EmailType;
  attachments?: EmailAttachment[];
  from?: string;
  replyTo?: string | string[];
  tags?: EmailTag[];
  /**
   * Extra provider headers.
   *
   * The DVHS CSF ledger hashes the COMPLETE canonical provider request --
   * headers included -- and derives each attempt's idempotency key from that
   * digest. Without a passthrough here a campaign that declares headers could
   * not actually transmit them, so the request the worker sent would differ
   * from the one the stored key was allocated against.
   */
  headers?: Record<string, string>;
  /**
   * Provider topic for a broadcast, which is what puts a working one-click
   * unsubscribe in the recipient's mail client. The installed SDK forwards it to
   * the API as `topic_id`.
   *
   * OMITTED MEANS THE KEY IS ABSENT, NOT NULL. The CSF ledger hashes the exact
   * transmitted request, so emitting `topicId: null` on a transactional send would
   * change what the provider receives relative to the request the stored digest
   * describes. Transactional mail carries no topic at all: offering an
   * unsubscribe from an application decision would let one click suppress mail the
   * chapter is obliged to send.
   */
  topicId?: string;
  idempotencyKey?: string;
  /**
   * Optional caller-owned cancellation for the provider request only.
   *
   * Once the request begins, an abort is an unknown provider outcome, never a
   * retryable pre-send failure. Callers with a hard execution deadline use this
   * to leave enough time to durably settle that ambiguity.
   */
  signal?: AbortSignal;
}

/**
 * Where in the send a result was decided. The distinction that matters is
 * `provider_request` versus everything before it: nothing before it can possibly
 * have reached the provider, and anything at or after it might have.
 */
export type EmailDispatchPhase =
  | "local_validation"
  | "preference_check"
  | "transport_setup"
  | "provider_request"
  | "provider_response";

/**
 * The legacy-compatible summary carried in `SendEmailResult.error`.
 *
 * AT RUNTIME THIS IS ALWAYS A BOUNDED, SANITIZED STRING. Nothing in this module
 * ever produces an `Error` here: the provider's own message is where the recipient
 * address and occasionally the API key live, and it is never propagated.
 * `services/email-contract.test.ts` asserts that invariant directly rather than
 * leaving it to the type.
 *
 * The `Error` arm exists purely so existing call sites that narrow with
 * `typeof === 'string'` / `instanceof Error` keep compiling -- including one in the
 * private plugin that this pass is not permitted to edit. Removing the arm would
 * break their build without making a single runtime value safer.
 */
export type SendEmailErrorSummary = string | Error;

/**
 * The honest set of things that can happen to a send.
 *
 * The previous shape was `{ success: boolean; error?: string | Error }`, which
 * cannot express the one distinction that decides whether retrying is safe. A
 * validation rejection and a socket that died mid-request both arrived as
 * `success: false`, so a caller had exactly two options: never retry (and lose
 * mail to transient faults) or always retry (and mail people twice). It also
 * returned the raw `Error`, which for Resend routinely contains the recipient
 * address and sometimes the API key, straight into whatever logged it.
 *
 *   accepted           -- the provider acknowledged and named the message.
 *   definitive_failure -- rejected on its merits. An identical retry fails identically.
 *   retryable_pre_send -- refused outright BEFORE acceptance. Nothing was sent; retry is safe.
 *   unknown_outcome    -- the request may or may not have been accepted. NEVER retry automatically.
 *   skipped            -- deliberately not sent (recipient preference, transport off).
 *
 * Every member carries only bounded, sanitized fields. `code` comes from a closed
 * set, `error` is a short constructed sentence, and the provider's own message --
 * which is where the PII lives -- is never propagated.
 *
 * `success`, `skipped`, `reason`, `error`, and `data` are retained so the existing
 * call sites across the app keep compiling and behaving. `error` is now a bounded
 * string rather than an Error, which is strictly safer for the call sites that log
 * it. The inapplicable ones are declared as optional-undefined on each member so
 * unnarrowed property access still type-checks while `outcome` remains a real
 * discriminant.
 */
export type SendEmailResult =
  | {
      outcome: "accepted";
      success: true;
      skipped: false;
      phase: "provider_response";
      messageId: string;
      transport: "resend" | "mailpit";
      data: { id: string; transport?: string };
      code?: undefined;
      status?: undefined;
      error?: undefined;
      reason?: undefined;
    }
  | {
      outcome: "definitive_failure" | "retryable_pre_send";
      success: false;
      skipped: false;
      phase: EmailDispatchPhase;
      code: string;
      status: number | null;
      error: SendEmailErrorSummary;
      retryAfterSeconds?: number;
      messageId?: undefined;
      transport?: undefined;
      data?: undefined;
      reason?: undefined;
    }
  | {
      outcome: "unknown_outcome";
      success: false;
      skipped: false;
      phase: "provider_request" | "provider_response";
      code: string;
      status: number | null;
      error: SendEmailErrorSummary;
      messageId?: undefined;
      transport?: undefined;
      data?: undefined;
      reason?: undefined;
    }
  | {
      outcome: "skipped";
      success: false;
      skipped: true;
      phase: "preference_check" | "transport_setup";
      code: string;
      reason: string;
      status?: undefined;
      messageId?: undefined;
      transport?: undefined;
      data?: undefined;
      error?: undefined;
    };

/**
 * Resend's error names, sorted by what they let us conclude about acceptance.
 *
 * This is the whole safety argument, so it is a table rather than a heuristic:
 *
 *   rejected  -- the API evaluated the request and refused it. Nothing was queued,
 *                so a corrected retry is safe and an identical retry is pointless.
 *   throttled -- refused before acceptance for capacity reasons. Nothing was sent;
 *                the SAME request may be retried later.
 *   ambiguous -- a server-side fault. The request may have been accepted before the
 *                failure, so retrying can double-send.
 *
 * An unrecognized name is treated as ambiguous on purpose. A new provider error
 * code must not silently become "safe to retry".
 */
const PROVIDER_ERROR_CLASSIFICATION: Record<
  string,
  "rejected" | "throttled" | "ambiguous"
> = {
  invalid_idempotency_key: "rejected",
  validation_error: "rejected",
  missing_api_key: "rejected",
  restricted_api_key: "rejected",
  invalid_api_key: "rejected",
  not_found: "rejected",
  method_not_allowed: "rejected",
  invalid_attachment: "rejected",
  invalid_from_address: "rejected",
  invalid_access: "rejected",
  invalid_parameter: "rejected",
  invalid_region: "rejected",
  missing_required_field: "rejected",
  security_error: "rejected",

  rate_limit_exceeded: "throttled",
  daily_quota_exceeded: "throttled",
  monthly_quota_exceeded: "throttled",

  application_error: "ambiguous",
  internal_server_error: "ambiguous",
  // NOT THROTTLING. Resend returns this when ANOTHER REQUEST CARRYING THE SAME
  // IDEMPOTENCY KEY IS CURRENTLY IN PROGRESS -- not when it refused this one for
  // capacity. The in-flight request may be accepted immediately after this
  // response is written, and nothing observable from here distinguishes that
  // from a request that will fail.
  //
  // Calling it throttled made it `retryable_pre_send`, which asserts "nothing
  // was sent". The CSF ledger believes that assertion: it settles
  // `retryable_failure` and inserts a SUCCESSOR attempt, whose provider
  // idempotency key is derived from attempt_number + 1 and is therefore
  // DIFFERENT from the key already in flight. Resend's own deduplication cannot
  // catch the successor, so the concurrent request and the retry both land and
  // a real person is mailed twice.
  concurrent_idempotent_requests: "ambiguous",
  // The same idempotency key was presented with a different payload, which means
  // Resend already holds a request under that key. Whether THAT request was
  // accepted is exactly what we cannot tell from here.
  invalid_idempotent_request: "ambiguous",
};

const PROVIDER_ERROR_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;

/** A bounded, PII-free code. An unrecognized provider name is not echoed back. */
function safeProviderCode(name: unknown): string {
  if (typeof name !== "string" || !PROVIDER_ERROR_NAME_PATTERN.test(name)) {
    return "unclassified_provider_error";
  }
  return name;
}

function providerStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Classify one Resend `{ error }` response.
 *
 * Reaching this function at all means the API answered, so the request definitely
 * arrived. What remains is whether it was accepted.
 */
export function classifyProviderError(
  error: {
    name?: unknown;
    statusCode?: unknown;
  },
  headers: Record<string, string> | null = null,
): SendEmailResult & {
  outcome: "definitive_failure" | "retryable_pre_send" | "unknown_outcome";
} {
  const code = safeProviderCode(error?.name);
  const status = providerStatus(error?.statusCode);
  const classification = PROVIDER_ERROR_CLASSIFICATION[code] ?? "ambiguous";

  if (classification === "rejected") {
    return {
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "provider_response",
      code,
      status,
      error: `provider rejected the request (${code})`,
    };
  }

  if (classification === "throttled") {
    return {
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "provider_response",
      code,
      status,
      retryAfterSeconds: parseRetryAfterSeconds(headers) ?? 60,
      error: `provider refused the request before acceptance (${code})`,
    };
  }

  return {
    outcome: "unknown_outcome",
    success: false,
    skipped: false,
    phase: "provider_response",
    code,
    status,
    error: `provider outcome could not be determined (${code})`,
  };
}

/** Parse provider Retry-After seconds or an HTTP date into a bounded delay. */
export function parseRetryAfterSeconds(
  headers: Record<string, string> | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!headers) return null;
  const raw = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "retry-after",
  )?.[1];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9]{1,6}$/u.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds <= 86_400 ? seconds : 86_400;
  }
  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return null;
  return Math.min(86_400, Math.max(0, Math.ceil((retryAt - nowMs) / 1_000)));
}

type EmailLogAttributes = {
  type: EmailType;
  recipient_count: number;
  has_user_context: boolean;
};

export function emailLogAttributes({
  to,
  type,
  userId,
}: Pick<SendEmailParams, "to" | "type" | "userId">): EmailLogAttributes {
  return {
    type,
    recipient_count: Array.isArray(to) ? to.length : 1,
    has_user_context: Boolean(userId),
  };
}

export function safeLogToken(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  return /^[a-z0-9_.:-]{1,64}$/iu.test(value) ? value : "unknown";
}

export function shouldUseMailpitTransport(): boolean {
  const configured = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (configured === "mailpit") return true;
  if (configured === "resend") return false;

  // The environment fallback MUST key off VERCEL_ENV, never NODE_ENV.
  //
  // Next.js sets NODE_ENV=production for every built deployment, Preview
  // included, so NODE_ENV cannot tell a Preview build from Production. Keying
  // the fallback off it meant Preview selected the Resend transport and mailed
  // real people from a non-production environment -- signup verifications,
  // anonymous-signup confirmations, and feedback requests all went out live
  // whenever EMAIL_TRANSPORT happened to be unset, which it was.
  //
  // VERCEL_ENV is "production" only on Production deployments; it is "preview"
  // or "development" on other Vercel environments and undefined off-Vercel
  // (local, CI, tests). Preview therefore falls back to the local transport,
  // which has no reachable catcher on Vercel and fails closed rather than
  // delivering to a real inbox.
  return process.env.VERCEL_ENV?.trim().toLowerCase() !== "production";
}

type DevelopmentProviderGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "development_sender_domain_missing"
        | "development_sender_domain_mismatch"
        | "development_recipient_blocked";
    };

function emailAddress(value: string): string | null {
  const bracketed = value.match(/<([^<>]+)>/u)?.[1] ?? value;
  const normalized = bracketed.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/u.test(normalized) ? normalized : null;
}

function configuredDevelopmentRecipients(): Set<string> {
  return new Set(
    (process.env.RESEND_DEV_RECIPIENT_ALLOWLIST ?? "")
      .split(",")
      .map((value) => emailAddress(value))
      .filter((value): value is string => value !== null),
  );
}

/**
 * A Preview may deliberately opt into Resend for provider acceptance, but that
 * must never turn a branch deployment into a general-purpose mail sender.
 * Production is governed by its separate environment and is intentionally not
 * affected by this Development-only gate.
 */
export function guardDevelopmentProviderSend(input: {
  to: string | string[];
  from: string;
}): DevelopmentProviderGuardResult {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnvironment !== "preview" && vercelEnvironment !== "development") {
    return { allowed: true };
  }

  const allowedDomain =
    process.env.RESEND_DEV_FROM_DOMAIN?.trim().toLowerCase();
  if (!allowedDomain) {
    return { allowed: false, code: "development_sender_domain_missing" };
  }

  const sender = emailAddress(input.from);
  if (!sender || !sender.endsWith(`@${allowedDomain}`)) {
    return { allowed: false, code: "development_sender_domain_mismatch" };
  }

  const allowlist = configuredDevelopmentRecipients();
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const allRecipientsAreSafe = recipients.every((recipient) => {
    const normalized = emailAddress(recipient);
    return (
      normalized !== null &&
      (normalized.endsWith("@resend.dev") || allowlist.has(normalized))
    );
  });

  return allRecipientsAreSafe
    ? { allowed: true }
    : { allowed: false, code: "development_recipient_blocked" };
}

export async function sendViaMailpit({
  to,
  subject,
  html,
  text,
  attachments,
  from,
  replyTo,
  tags,
  headers: providerHeaders,
  topicId,
  idempotencyKey,
}: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  from?: string;
  replyTo?: string | string[];
  tags?: EmailTag[];
  headers?: Record<string, string>;
  topicId?: string;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  // SETUP IS NOT DISPATCH, AND ITS FAILURES ARE NOT AMBIGUOUS.
  //
  // The dynamic import and createTransport() both sat outside any catch. A missing
  // module, a bad MAILPIT_SMTP_PORT, or an option nodemailer rejects therefore
  // escaped sendEmail() as a raw throw -- past every classification this module
  // exists to provide. Whatever caught it upstream had a raw Error carrying
  // whatever the transport chose to put in it, and the CSF worker would have had to
  // guess whether anything was sent.
  //
  // Nothing here has opened a socket yet, so these are provably pre-send. They are
  // retryable: the operator fixes the configuration and the same send is valid.
  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch {
    return {
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "transport_setup",
      code: "mailpit_module_unavailable",
      status: null,
      error: "the local transport module could not be loaded",
    };
  }

  const host = process.env.MAILPIT_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.MAILPIT_SMTP_PORT || "54325");

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    // A misconfigured port is a local configuration fault, definitively.
    return {
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "transport_setup",
      code: "mailpit_port_invalid",
      status: null,
      error: "the local transport port is not a valid TCP port",
    };
  }

  const localFrom =
    from ??
    process.env.MAILPIT_FROM_EMAIL?.trim() ??
    "Let's Assist <no-reply@local.lets-assist.test>";
  // Local evidence only. A header named after the topic is NOT provider consent
  // enforcement -- Mailpit has no topics and no unsubscribe machinery. It exists so
  // a developer can see in the sink that the topic was carried, and so the Mailpit
  // path proves the same fields reached the transport that Resend would have got.
  const headers = Object.fromEntries([
    ...Object.entries(providerHeaders ?? {}),
    ...(idempotencyKey
      ? [["X-Lets-Assist-Idempotency-Key", idempotencyKey] as const]
      : []),
    ...(topicId ? [["X-Lets-Assist-Topic-Id", topicId] as const] : []),
    ...(tags ?? []).map(
      (tag) => [`X-Lets-Assist-Tag-${tag.name}`, tag.value] as const,
    ),
  ]);

  let transporter: ReturnType<typeof nodemailer.createTransport>;
  try {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      // CONTENT ACCESS IS DISABLED BECAUSE THIS WRAPPER NEEDS NEITHER.
      //
      // Nodemailer will, by default, read a local file or fetch a URL when a
      // message part supplies `path`/`href` -- and 9.0.1 patched a bypass where
      // a raw path or href slipped past earlier guards (GHSA-p6gq-j5cr-w38f).
      // Every caller here supplies inline text/HTML and base64 attachment
      // content, so there is nothing legitimate to lose and an
      // SSRF/local-file-read primitive to remove. Attachment content below
      // stays inline base64.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch {
    // Constructing a transport opens nothing. Still pre-send, still retryable.
    return {
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "transport_setup",
      code: "mailpit_transport_setup_failed",
      status: null,
      error: "the local transport could not be constructed",
    };
  }

  let response: { messageId: string };
  try {
    response = await transporter.sendMail({
      from: localFrom,
      to,
      subject,
      html,
      text,
      replyTo,
      headers,
      attachments: attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        encoding: "base64",
      })),
    });
  } catch {
    // Mailpit IS the transport on this path, so a throw part-way through an SMTP
    // dispatch is genuinely ambiguous -- the message may already be in the sink.
    // Classifying it as a definitive failure would be a convenient lie, and the
    // CSF ledger would then happily enqueue a retry.
    return {
      outcome: "unknown_outcome",
      success: false,
      skipped: false,
      phase: "provider_request",
      code: "mailpit_transport_exception",
      status: null,
      error: "the local transport request may or may not have been accepted",
    };
  }

  return {
    outcome: "accepted",
    success: true,
    skipped: false,
    phase: "provider_response",
    messageId: response.messageId,
    transport: "mailpit",
    data: {
      id: response.messageId,
      transport: "mailpit",
    },
  };
}

export { sendEmail } from "./email-send";
