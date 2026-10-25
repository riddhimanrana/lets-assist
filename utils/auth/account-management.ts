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
  if (result.error && !("warning" in result)) {
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
    .from("user_emails")
    .delete()
    .eq("id", emailId);

  if (error) throw error;
  return { success: true };
}

/**
 * Sets a specific email as the primary email for the user.
 * This updates the `email` field on the `auth.users` table.
 * The verified confirmation route atomically syncs this to `user_emails`.
 */
export interface SetPrimaryEmailResult extends SetPrimaryEmailResponse {}

export async function setPrimaryEmail(email: string) {
  const result = await setPrimaryEmailAction(email);
  if (result.error) throw new Error(result.error);
  return result;
}

/**
 * Fetches the current user's linked emails from `user_emails` table.
 * Reads verified aliases belonging to the authenticated account. The sign-in
 * email is managed separately under Sign-in & security.
 */
export async function getLinkedIdentities() {
  const result = await getLinkedIdentitiesAction();
  if (!result.success) throw new Error(result.error);
  return result.emails;
}
