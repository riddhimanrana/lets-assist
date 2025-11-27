import { Resend } from 'resend';
import { createClient } from '@/utils/supabase/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export type EmailType = 'project_updates' | 'general' | 'transactional';

interface SendEmailParams {
    to: string | string[];
    subject: string;
    html: string;
    userId?: string; // Optional: if provided, checks user preferences
    type: EmailType;
}

export async function sendEmail({ to, subject, html, userId, type }: SendEmailParams) {
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
            console.error('Error fetching notification settings:', error);
            // If error fetching settings, default to sending (fail open) or skipping?
            // Safest to probably send if it's important, but let's log it.
        }

        if (settings) {
            // Check global email switch
            if (settings.email_notifications === false) {
                console.log(`Skipping email for user ${userId}: Global email notifications disabled.`);
                return { success: false, skipped: true, reason: 'Global email notifications disabled' };
            }

            // Check specific type switch
            // Assuming the column names match the EmailType (except transactional)
            if (type === 'project_updates' && settings.project_updates === false) {
                console.log(`Skipping email for user ${userId}: Project updates disabled.`);
                return { success: false, skipped: true, reason: 'Project updates disabled' };
            }

            if (type === 'general' && settings.general === false) {
                console.log(`Skipping email for user ${userId}: General notifications disabled.`);
                return { success: false, skipped: true, reason: 'General notifications disabled' };
            }
        }
    }

    // 2. Send email via Resend
    try {
        const { data, error } = await resend.emails.send({
            from: "Let's Assist <projects@notifications.lets-assist.com>",
            to,
            subject,
            html,
        });

        if (error) {
            console.error('Resend error:', error);
            return { success: false, error };
        }

        return { success: true, data };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error };
    }
}
