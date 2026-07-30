import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { render } from '@react-email/components';
import * as React from 'react';
import { logError, logInfo, logWarn } from '@/lib/logger';

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

function getResendClient(): ResendSetup {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
        return { ok: false, configured: false };
    }

    try {
        return { ok: true, client: new Resend(apiKey) };
    } catch {
        // The key is present but the SDK refused it. Nothing was sent, so this is a
        // pre-send fault the operator can fix -- never provider ambiguity.
        return { ok: false, configured: true, code: 'resend_client_setup_failed' };
    }
}

export type EmailType = 'project_updates' | 'general' | 'transactional';

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
}

/**
 * Where in the send a result was decided. The distinction that matters is
 * `provider_request` versus everything before it: nothing before it can possibly
 * have reached the provider, and anything at or after it might have.
 */
export type EmailDispatchPhase =
    | 'local_validation'
    | 'preference_check'
    | 'transport_setup'
    | 'provider_request'
    | 'provider_response';

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
        outcome: 'accepted';
        success: true;
        skipped: false;
        phase: 'provider_response';
        messageId: string;
        transport: 'resend' | 'mailpit';
        data: { id: string; transport?: string };
        code?: undefined;
        status?: undefined;
        error?: undefined;
        reason?: undefined;
    }
    | {
        outcome: 'definitive_failure' | 'retryable_pre_send';
        success: false;
        skipped: false;
        phase: EmailDispatchPhase;
        code: string;
        status: number | null;
        error: SendEmailErrorSummary;
        messageId?: undefined;
        transport?: undefined;
        data?: undefined;
        reason?: undefined;
    }
    | {
        outcome: 'unknown_outcome';
        success: false;
        skipped: false;
        phase: 'provider_request' | 'provider_response';
        code: string;
        status: number | null;
        error: SendEmailErrorSummary;
        messageId?: undefined;
        transport?: undefined;
        data?: undefined;
        reason?: undefined;
    }
    | {
        outcome: 'skipped';
        success: false;
        skipped: true;
        phase: 'preference_check' | 'transport_setup';
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
const PROVIDER_ERROR_CLASSIFICATION: Record<string, 'rejected' | 'throttled' | 'ambiguous'> = {
    invalid_idempotency_key: 'rejected',
    validation_error: 'rejected',
    missing_api_key: 'rejected',
    restricted_api_key: 'rejected',
    invalid_api_key: 'rejected',
    not_found: 'rejected',
    method_not_allowed: 'rejected',
    invalid_attachment: 'rejected',
    invalid_from_address: 'rejected',
    invalid_access: 'rejected',
    invalid_parameter: 'rejected',
    invalid_region: 'rejected',
    missing_required_field: 'rejected',
    security_error: 'rejected',

    rate_limit_exceeded: 'throttled',
    daily_quota_exceeded: 'throttled',
    monthly_quota_exceeded: 'throttled',

    application_error: 'ambiguous',
    internal_server_error: 'ambiguous',
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
    concurrent_idempotent_requests: 'ambiguous',
    // The same idempotency key was presented with a different payload, which means
    // Resend already holds a request under that key. Whether THAT request was
    // accepted is exactly what we cannot tell from here.
    invalid_idempotent_request: 'ambiguous',
};

const PROVIDER_ERROR_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;

/** A bounded, PII-free code. An unrecognized provider name is not echoed back. */
function safeProviderCode(name: unknown): string {
    if (typeof name !== 'string' || !PROVIDER_ERROR_NAME_PATTERN.test(name)) {
        return 'unclassified_provider_error';
    }
    return name;
}

function providerStatus(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Classify one Resend `{ error }` response.
 *
 * Reaching this function at all means the API answered, so the request definitely
 * arrived. What remains is whether it was accepted.
 */
export function classifyProviderError(error: {
    name?: unknown;
    statusCode?: unknown;
}): SendEmailResult & { outcome: 'definitive_failure' | 'retryable_pre_send' | 'unknown_outcome' } {
    const code = safeProviderCode(error?.name);
    const status = providerStatus(error?.statusCode);
    const classification = PROVIDER_ERROR_CLASSIFICATION[code] ?? 'ambiguous';

    if (classification === 'rejected') {
        return {
            outcome: 'definitive_failure',
            success: false,
            skipped: false,
            phase: 'provider_response',
            code,
            status,
            error: `provider rejected the request (${code})`,
        };
    }

    if (classification === 'throttled') {
        return {
            outcome: 'retryable_pre_send',
            success: false,
            skipped: false,
            phase: 'provider_response',
            code,
            status,
            error: `provider refused the request before acceptance (${code})`,
        };
    }

    return {
        outcome: 'unknown_outcome',
        success: false,
        skipped: false,
        phase: 'provider_response',
        code,
        status,
        error: `provider outcome could not be determined (${code})`,
    };
}

type EmailLogAttributes = {
    type: EmailType;
    recipient_count: number;
    has_user_context: boolean;
};

function emailLogAttributes({
    to,
    type,
    userId,
}: Pick<SendEmailParams, 'to' | 'type' | 'userId'>): EmailLogAttributes {
    return {
        type,
        recipient_count: Array.isArray(to) ? to.length : 1,
        has_user_context: Boolean(userId),
    };
}

function safeLogToken(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    return /^[a-z0-9_.:-]{1,64}$/iu.test(value) ? value : 'unknown';
}

function shouldUseMailpitTransport(): boolean {
    const configured = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
    if (configured === 'mailpit') return true;
    if (configured === 'resend') return false;

    // Local convenience fallback: always route emails to local Mailpit/Inbucket 
    // in development, unless EMAIL_TRANSPORT=resend is explicitly set.
    return process.env.NODE_ENV !== 'production';
}

async function sendViaMailpit({
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
    let nodemailer: typeof import('nodemailer');
    try {
        nodemailer = await import('nodemailer');
    } catch {
        return {
            outcome: 'retryable_pre_send',
            success: false,
            skipped: false,
            phase: 'transport_setup',
            code: 'mailpit_module_unavailable',
            status: null,
            error: 'the local transport module could not be loaded',
        };
    }

    const host = process.env.MAILPIT_HOST?.trim() || '127.0.0.1';
    const port = Number(process.env.MAILPIT_SMTP_PORT || '54325');

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        // A misconfigured port is a local configuration fault, definitively.
        return {
            outcome: 'definitive_failure',
            success: false,
            skipped: false,
            phase: 'transport_setup',
            code: 'mailpit_port_invalid',
            status: null,
            error: 'the local transport port is not a valid TCP port',
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
        ...(tags ?? []).map((tag) => [
            `X-Lets-Assist-Tag-${tag.name}`,
            tag.value,
        ] as const),
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
            outcome: 'retryable_pre_send',
            success: false,
            skipped: false,
            phase: 'transport_setup',
            code: 'mailpit_transport_setup_failed',
            status: null,
            error: 'the local transport could not be constructed',
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
                encoding: 'base64',
            })),
        });
    } catch {
        // Mailpit IS the transport on this path, so a throw part-way through an SMTP
        // dispatch is genuinely ambiguous -- the message may already be in the sink.
        // Classifying it as a definitive failure would be a convenient lie, and the
        // CSF ledger would then happily enqueue a retry.
        return {
            outcome: 'unknown_outcome',
            success: false,
            skipped: false,
            phase: 'provider_request',
            code: 'mailpit_transport_exception',
            status: null,
            error: 'the local transport request may or may not have been accepted',
        };
    }

    return {
        outcome: 'accepted',
        success: true,
        skipped: false,
        phase: 'provider_response',
        messageId: response.messageId,
        transport: 'mailpit',
        data: {
            id: response.messageId,
            transport: 'mailpit',
        },
    };
}

export async function sendEmail({
    to,
    subject,
    html,
    text,
    react,
    userId,
    type,
    attachments,
    from,
    replyTo,
    tags,
    headers,
    topicId,
    idempotencyKey,
}: SendEmailParams): Promise<SendEmailResult> {
    const shouldLog = process.env.NODE_ENV !== "test";
    const safeLogAttributes = emailLogAttributes({ to, type, userId });

    // Require at least one supported representation. Transactional callers
    // should normally provide both HTML and plain text, while small operational
    // notices may intentionally be text-only.
    if (!html && !react && !text) {
        if (shouldLog) {
            logError('Email validation failed: No message body provided', new Error('Invalid email parameters'), {
                ...safeLogAttributes,
                reason: 'missing_body',
            });
        }
        return {
            outcome: 'definitive_failure',
            success: false,
            skipped: false,
            phase: 'local_validation',
            code: 'missing_body',
            status: null,
            error: 'At least one of html, react, or text must be provided',
        };
    }

    // 1. Check preferences if userId is provided and type is not transactional
    if (userId && type !== 'transactional') {
        const supabase = await createClient();

        // Fetch user's notification settings
        const { data: settings, error } = await supabase
            .from('notification_settings')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            if (shouldLog) {
                logError('Failed to fetch notification settings', new Error('Notification settings query failed'), {
                    ...safeLogAttributes,
                    error_code: safeLogToken(error.code),
                });
            }
            // If error fetching settings, default to sending (fail open) or skipping?
            // Safest to probably send if it's important, but let's log it.
        }

        if (settings) {
            // Check global email switch
            if (settings.email_notifications === false) {
                if (shouldLog) {
                    logInfo('Email skipped due to user preferences', {
                        ...safeLogAttributes,
                        reason: 'global_email_disabled',
                    });
                }
                return {
                outcome: 'skipped',
                success: false,
                skipped: true,
                phase: 'preference_check',
                code: 'global_email_disabled',
                reason: 'Global email notifications disabled',
            };
            }

            // Check specific type switch
            // Assuming the column names match the EmailType (except transactional)
            if (type === 'project_updates' && settings.project_updates === false) {
                if (shouldLog) {
                    logInfo('Email skipped due to user preferences', {
                        ...safeLogAttributes,
                        reason: 'project_updates_disabled',
                    });
                }
                return {
                    outcome: 'skipped',
                    success: false,
                    skipped: true,
                    phase: 'preference_check',
                    code: 'project_updates_disabled',
                    reason: 'Project updates disabled',
                };
            }

            if (type === 'general' && settings.general === false) {
                if (shouldLog) {
                    logInfo('Email skipped due to user preferences', {
                        ...safeLogAttributes,
                        reason: 'general_notifications_disabled',
                    });
                }
                return {
                    outcome: 'skipped',
                    success: false,
                    skipped: true,
                    phase: 'preference_check',
                    code: 'general_notifications_disabled',
                    reason: 'General notifications disabled',
                };
            }
        }
    }

    // 2. RENDERING IS LOCAL WORK, NOT A PROVIDER REQUEST.
    //
    // This used to sit inside the same try/catch that classifies transport faults,
    // so a React component that threw -- a missing prop, a bad date, a template bug
    // -- came back as `unknown_outcome`. That is the one classification that means
    // "a real person may already have been mailed", and it made the CSF ledger mark
    // the attempt unretryable and demand human reconciliation for a message that
    // provably never left the process. Rendering gets its own boundary.
    let emailHtml: string | undefined;
    try {
        emailHtml = react ? await render(react) : html;
    } catch (error) {
        if (shouldLog) {
            logError('Email render failed', new Error('Email render failed'), {
                ...safeLogAttributes,
                error_kind: safeLogToken(error instanceof Error ? error.name : undefined),
                outcome: 'definitive_failure',
                phase: 'local_validation',
            });
        }
        return {
            outcome: 'definitive_failure',
            success: false,
            skipped: false,
            phase: 'local_validation',
            code: 'render_failed',
            status: null,
            error: 'the message could not be rendered',
        };
    }

    if (!emailHtml && !text) {
        // A React element that rendered to nothing leaves no representation at all.
        return {
            outcome: 'definitive_failure',
            success: false,
            skipped: false,
            phase: 'local_validation',
            code: 'empty_rendered_body',
            status: null,
            error: 'the rendered message had no content',
        };
    }

    // 3. Transport selection, also outside the ambiguity boundary.
    if (shouldUseMailpitTransport()) {
        const mailpitResult = await sendViaMailpit({
            to,
            subject,
            html: emailHtml,
            text,
            attachments,
            from,
            replyTo,
            tags,
            headers,
            topicId,
            idempotencyKey,
        });

        if (shouldLog && mailpitResult.outcome === 'accepted') {
            logInfo('Email delivered via local Mailpit transport', {
                ...safeLogAttributes,
                transport: 'mailpit',
            });
        }

        return mailpitResult;
    }

    const setup = getResendClient();

    if (!setup.ok && !setup.configured) {
        if (shouldLog) {
            logWarn('Email transport unavailable (set EMAIL_TRANSPORT=mailpit locally or configure RESEND_API_KEY)', {
                ...safeLogAttributes,
                transport: 'resend',
            });
        }
        return {
            outcome: 'skipped',
            success: false,
            skipped: true,
            phase: 'transport_setup',
            code: 'transport_not_configured',
            reason: 'Email service not configured',
        };
    }

    if (!setup.ok) {
        // Configured but unusable. Distinct from "not configured": somebody meant to
        // send, so this is an operational fault to surface and retry, not a skip.
        if (shouldLog) {
            logError('Email provider client could not be constructed', new Error('Email transport setup failed'), {
                ...safeLogAttributes,
                transport: 'resend',
                outcome: 'retryable_pre_send',
                phase: 'transport_setup',
            });
        }
        return {
            outcome: 'retryable_pre_send',
            success: false,
            skipped: false,
            phase: 'transport_setup',
            code: setup.code,
            status: null,
            error: 'the provider client could not be constructed',
        };
    }

    const resend = setup.client;

    // 4. THE PROVIDER REQUEST. Everything inside this try may have reached Resend.
    try {
        const content = emailHtml
            ? { html: emailHtml, ...(text ? { text } : {}) }
            : { text: text! };
        const { data, error } = await resend.emails.send({
            from:
                from ??
                process.env.EMAIL_FROM?.trim() ??
                "Let's Assist <projects@notifications.lets-assist.com>",
            to,
            subject,
            ...content,
            replyTo,
            tags,
            // Spread rather than always-present so a caller that supplies no
            // headers sends the exact same request shape it always did.
            ...(headers ? { headers } : {}),
            // Same reasoning, and it matters more here: the SDK forwards this to the
            // API as `topic_id`, so a present-but-null key would reach the provider
            // and diverge from the request the CSF digest was computed over.
            ...(topicId ? { topicId } : {}),
            attachments,
        }, idempotencyKey ? { idempotencyKey } : undefined);

        // THE API ANSWERED, SO THE REQUEST AROSE -- ONLY ACCEPTANCE IS IN QUESTION.
        //
        // Reaching this branch means Resend evaluated the request and returned a
        // structured error, which is a completely different situation from a socket
        // that died. Classification decides whether a retry is safe; see
        // PROVIDER_ERROR_CLASSIFICATION.
        if (error) {
            const classified = classifyProviderError(error);
            if (shouldLog) {
                logError('Failed to send email via Resend', new Error('Email provider request failed'), {
                    ...safeLogAttributes,
                    provider_error: safeLogToken(classified.code),
                    outcome: classified.outcome,
                    phase: classified.phase,
                });
            }
            return classified;
        }

        if (!data?.id) {
            // A 2xx with no message identity means we cannot name what was sent, and
            // the provider may well have accepted it. That is precisely an unknown
            // outcome, not a success.
            if (shouldLog) {
                logWarn('Resend accepted an email without returning a message identity', {
                    ...safeLogAttributes,
                    outcome: 'unknown_outcome',
                });
            }
            return {
                outcome: 'unknown_outcome',
                success: false,
                skipped: false,
                phase: 'provider_response',
                code: 'missing_provider_message_id',
                status: null,
                error: 'provider accepted the request without naming a message',
            };
        }

        return {
            outcome: 'accepted',
            success: true,
            skipped: false,
            phase: 'provider_response',
            messageId: data.id,
            transport: 'resend',
            data,
        };
    } catch (error) {
        // THE REQUEST BOUNDARY, AND THE WHOLE REASON THIS UNION EXISTS.
        //
        // Control left this process inside resend.emails.send(). A throw from there
        // is a timeout, a connection reset, a DNS failure, or an aborted socket --
        // and NONE of those tell us whether the request reached Resend and was
        // accepted before the connection died. The old code reported this
        // identically to a validation rejection, so any caller that retried
        // failures would re-send messages Resend had already queued.
        //
        // It is therefore an unknown outcome. Never an automatic retry.
        if (shouldLog) {
            logError('Exception while sending email', new Error('Email transport failed'), {
                ...safeLogAttributes,
                error_kind: safeLogToken(error instanceof Error ? error.name : undefined),
                outcome: 'unknown_outcome',
                phase: 'provider_request',
            });
        }
        return {
            outcome: 'unknown_outcome',
            success: false,
            skipped: false,
            phase: 'provider_request',
            code: 'transport_exception',
            status: null,
            error: 'the provider request may or may not have been accepted',
        };
    }
}
