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

interface EmailAttachment {
    filename: string;
    content: string;
}

interface SendEmailParams {
    to: string | string[];
    subject: string;
    html?: string;
    react?: React.ReactElement;
    userId?: string; // Optional: if provided, checks user preferences
    type: EmailType;
    attachments?: EmailAttachment[];
}

export type SendEmailResult = {
    success: boolean;
    data?: { id: string; transport?: string };
    skipped?: boolean;
    reason?: string;
    error?: string | Error;
};

function shouldUseMailpitTransport(resendClient: Resend | null): boolean {
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
    attachments,
}: {
    to: string | string[];
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
}) {
    const nodemailer = await import('nodemailer');

    const host = process.env.MAILPIT_HOST?.trim() || '127.0.0.1';
    const port = Number(process.env.MAILPIT_SMTP_PORT || '54325');
    const from = process.env.MAILPIT_FROM_EMAIL?.trim() || "Let's Assist <no-reply@local.lets-assist.test>";

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: false,
    });

    const response = await transporter.sendMail({
        from,
        to,
        subject,
        html,
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

export async function sendEmail({ to, subject, html, react, userId, type, attachments }: SendEmailParams): Promise<SendEmailResult> {
    const shouldLog = process.env.NODE_ENV !== "test";

    // Validate that either html or react is provided
    if (!html && !react) {
        if (shouldLog) {
            logError('Email validation failed: Neither html nor react provided', new Error('Invalid email parameters'), {
                to: Array.isArray(to) ? to.join(',') : to,
                subject,
                type,
            });
        }
        return { success: false, error: 'Either html or react must be provided' };
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
                logError('Failed to fetch notification settings', error, {
                    user_id: userId,
                    type,
                    error_code: error.code,
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
                        user_id: userId,
                        reason: 'global_email_disabled',
                        type,
                    });
                }
                return { success: false, skipped: true, reason: 'Global email notifications disabled' };
            }

            // Check specific type switch
            // Assuming the column names match the EmailType (except transactional)
            if (type === 'project_updates' && settings.project_updates === false) {
                if (shouldLog) {
                    logInfo('Email skipped due to user preferences', {
                        user_id: userId,
                        reason: 'project_updates_disabled',
                        type,
                    });
                }
                return { success: false, skipped: true, reason: 'Project updates disabled' };
            }

            if (type === 'general' && settings.general === false) {
                if (shouldLog) {
                    logInfo('Email skipped due to user preferences', {
                        user_id: userId,
                        reason: 'general_notifications_disabled',
                        type,
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
        const emailHtml = react ? await render(react) : html!;

        if (shouldUseMailpitTransport(resend)) {
            const mailpitResult = await sendViaMailpit({
                to,
                subject,
                html: emailHtml,
                attachments,
            });

            if (shouldLog) {
                logInfo('Email delivered via local Mailpit transport', {
                    to: Array.isArray(to) ? to.join(',') : to,
                    subject,
                    type,
                    user_id: userId,
                });
            }

            return mailpitResult;
        }

        if (!resend) {
            if (shouldLog) {
                logWarn('Email transport unavailable (set EMAIL_TRANSPORT=mailpit locally or configure RESEND_API_KEY)', {
                    to: Array.isArray(to) ? to.join(',') : to,
                    subject,
                    type,
                    user_id: userId,
                });
            }
            return { success: false, skipped: true, reason: 'Email service not configured' };
        }

        const { data, error } = await resend.emails.send({
            from: "Let's Assist <projects@notifications.lets-assist.com>",
            to,
            subject,
            html: emailHtml,
            attachments,
        });

        if (error) {
            if (shouldLog) {
                logError('Failed to send email via Resend', error, {
                    to: Array.isArray(to) ? to.join(',') : to,
                    subject,
                    type,
                    user_id: userId,
                });
            }
            return { success: false, error };
        }

        return { success: true, data };
    } catch (error) {
        if (shouldLog) {
            logError('Exception while sending email', error, {
                to: Array.isArray(to) ? to.join(',') : to,
                subject,
                type,
                user_id: userId,
            });
        }
        return { success: false, error: error as Error };
    }
}
