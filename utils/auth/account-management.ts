import { createClient } from "@/utils/supabase/client";
import { sendVerificationEmail, verifyEmailToken, setPrimaryEmailAction, type SetPrimaryEmailResponse } from "@/app/account/email-actions";
import { requireUser } from "@/utils/auth/auth-context";

/**
 * Initiates the process of adding a new email.
 * Calls server action to send verification code.
 */
export async function addEmail(email: string) {
    // Call server action
    const result = await sendVerificationEmail(email);
    if (result.error && !(result as any).warning) {
        throw new Error(result.error);
    }
    return result;
}

/**
 * Verifies the email with the provided token.
 */
export async function verifyEmail(email: string, token: string) {
    const result = await verifyEmailToken(email, token);
    if (result.error) throw new Error(result.error);
    return result;
}

/**
 * Unlinks an email from the current user.
 * Cannot unlink the primary email (handled by UI/Logic).
 */
export async function unlinkEmail(emailId: string) {
    const supabase = createClient();

    const { error } = await supabase
        .from('user_emails')
        .delete()
        .eq('id', emailId);

    if (error) throw error;
    return { success: true };
}

/**
 * Sets a specific email as the primary email for the user.
 * This updates the `email` field on the `auth.users` table.
 * The trigger `on_auth_user_email_change` will sync this to `user_emails`.
 */
export interface SetPrimaryEmailResult extends SetPrimaryEmailResponse {}

export async function setPrimaryEmail(email: string) {
    const result = await setPrimaryEmailAction(email);
    if (result.error) throw new Error(result.error);
    return result;
}

/**
 * Fetches the current user's linked emails from `user_emails` table.
 * Ensures the auth email is always synced and included.
 */
export async function getLinkedIdentities() {
    const supabase = createClient();
    const user = await requireUser(supabase);

    // Ensure the auth email exists in user_emails table
    if (user.email) {
        // Check if auth email exists in user_emails
        const { data: existingEmail } = await supabase
            .from('user_emails')
            .select('id')
            .eq('user_id', user.id)
            .eq('email', user.email)
            .maybeSingle();

        // If not, insert it as primary and verified
        if (!existingEmail) {
            await supabase
                .from('user_emails')
                .insert({
                    user_id: user.id,
                    email: user.email,
                    is_primary: true,
                    verified_at: new Date().toISOString(),
                    verification_token: null
                });
        }
    }

    const { data, error } = await supabase
        .from('user_emails')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false }); // Primary first

    if (error) throw error;

    return data || [];
}

