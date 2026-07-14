import { createClient } from "@/lib/supabase/client";
import {
    getLinkedIdentitiesAction,
    sendVerificationEmail,
    verifyEmailToken,
    setPrimaryEmailAction,
    type SetPrimaryEmailResponse,
} from "@/app/account/email-actions";

/**
 * Initiates the process of adding a new email.
 * Calls server action to send verification code.
 */
export async function addEmail(email: string) {
    // Call server action
    const result = await sendVerificationEmail(email);
    if (result.error && !('warning' in result)) {
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
 * The verified confirmation route atomically syncs this to `user_emails`.
 */
export interface SetPrimaryEmailResult extends SetPrimaryEmailResponse { }

export async function setPrimaryEmail(email: string) {
    const result = await setPrimaryEmailAction(email);
    if (result.error) throw new Error(result.error);
    return result;
}

/**
 * Fetches the current user's linked emails from `user_emails` table.
 * Ensures the auth email is always synced and included.
 * Uses upsert to reduce from 3 queries to 2 (sync + fetch).
 */
export async function getLinkedIdentities() {
    const result = await getLinkedIdentitiesAction();
    if (!result.success) throw new Error(result.error);
    return result.emails;
}
