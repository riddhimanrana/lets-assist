import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { render } from '@react-email/components';
import * as React from 'react';
import { logError, logInfo, logWarn } from '@/lib/logger';

function getResendClient(): Resend | null {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) return null;
    return new Resend(apiKey);
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
    idempotencyKey?: string;
}

export type SendEmailResult = {
    success: boolean;
    data?: { id: string; transport?: string };
    skipped?: boolean;
    reason?: string;
    error?: string | Error;
};

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
    idempotencyKey?: string;
}) {
    const nodemailer = await import('nodemailer');

    const host = process.env.MAILPIT_HOST?.trim() || '127.0.0.1';
    const port = Number(process.env.MAILPIT_SMTP_PORT || '54325');
    const localFrom =
        from ??
        process.env.MAILPIT_FROM_EMAIL?.trim() ??
        "Let's Assist <no-reply@local.lets-assist.test>";
    const headers = Object.fromEntries([
        ...(idempotencyKey
            ? [["X-Lets-Assist-Idempotency-Key", idempotencyKey] as const]
            : []),
        ...(tags ?? []).map((tag) => [
            `X-Lets-Assist-Tag-${tag.name}`,
            tag.value,
        ] as const),
    ]);

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: false,
    });

    const response = await transporter.sendMail({
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

    return {
        success: true,
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
        return { success: false, error: 'At least one of html, react, or text must be provided' };
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
                return { success: false, skipped: true, reason: 'Global email notifications disabled' };
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
                return { success: false, skipped: true, reason: 'Project updates disabled' };
            }

            if (type === 'general' && settings.general === false) {
                if (shouldLog) {
                    logInfo('Email skipped due to user preferences', {
                        ...safeLogAttributes,
                        reason: 'general_notifications_disabled',
                    });
                }
                return { success: false, skipped: true, reason: 'General notifications disabled' };
            }
        }
    }

    // 2. Send email via Resend
    try {
        const resend = getResendClient();
        // Render React component to HTML if provided
        const emailHtml = react ? await render(react) : html;

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
                idempotencyKey,
            });

            if (shouldLog) {
                logInfo('Email delivered via local Mailpit transport', {
                    ...safeLogAttributes,
                    transport: 'mailpit',
                });
            }

            return mailpitResult;
        }

        if (!resend) {
            if (shouldLog) {
                logWarn('Email transport unavailable (set EMAIL_TRANSPORT=mailpit locally or configure RESEND_API_KEY)', {
                    ...safeLogAttributes,
                    transport: 'resend',
                });
            }
            return { success: false, skipped: true, reason: 'Email service not configured' };
        }

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
            attachments,
        }, idempotencyKey ? { idempotencyKey } : undefined);

        if (error) {
            if (shouldLog) {
                logError('Failed to send email via Resend', new Error('Email provider request failed'), {
                    ...safeLogAttributes,
                    provider_error: safeLogToken(
                        typeof error === 'object' && error !== null && 'name' in error
                            ? error.name
                            : undefined,
                    ),
                });
            }
            return { success: false, error };
        }

        return { success: true, data };
    } catch (error) {
        if (shouldLog) {
            logError('Exception while sending email', new Error('Email transport failed'), {
                ...safeLogAttributes,
                error_kind: safeLogToken(error instanceof Error ? error.name : undefined),
            });
        }
        return { success: false, error: error as Error };
    }
}
