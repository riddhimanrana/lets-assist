"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import crypto from "crypto";
import { sendEmail } from "@/services/email";
import EmailVerificationCode from "@/emails/email-verification-code";
import * as React from "react";

/**
 * Send verification email for EMAIL ALIAS (not primary email change).
 * Use the Security page to change your primary authentication email.
 *
 * This function manages secondary/backup emails stored in the user_emails table.
 */
export async function sendVerificationEmail(email: string) {
    const { user, error: authError } = await getAuthUser();

    if (authError || !user) {
        return { success: false, error: "Not authenticated" };
    }

    const supabase = await createClient();

    // Check if email already exists as a primary account in profiles table
    const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("email", email.toLowerCase())
        .maybeSingle();

    if (existingProfile && existingProfile.id !== user.id) {
        return { error: "This email is already associated with another Let's Assist account. Please use a different email.", warning: true };
    }

    // Check if email already exists in user_emails (globally unique)
    const { data: existingEmail } = await supabase
        .from("user_emails")
        .select("id, user_id")
        .eq("email", email.toLowerCase())
        .maybeSingle();

    if (existingEmail) {
        if (existingEmail.user_id === user.id) {
            // User already has this email, resending code
            // Continue to update token
        } else {
            return { error: "Email already linked to another account" };
        }
    }

    // Generate 6-digit code
    const token = crypto.randomInt(100000, 999999).toString();

    // Insert/Update user_emails with token
    const { error: insertError } = (await supabase
        .from("user_emails")
        .upsert({
            user_id: user.id,
            email: email.toLowerCase(),
            verification_token: token,
            verified_at: null, // Reset verification if re-adding/verifying
            is_primary: false
        }, { onConflict: 'email' })) as { error: { message?: string } | null }; // Use email as conflict target since it's unique

    if (insertError) {
        console.error("Error inserting email:", insertError);
        return { error: "Failed to add email. Please try again." };
    }

    // Send email
    try {
        console.log("Attempting to send verification email to:", email);
        const { error } = await sendEmail({
            to: email,
            subject: 'Verify your email address',
            react: React.createElement(EmailVerificationCode, { code: token, expiresInHours: 24 }),
            type: 'transactional'
        });

        if (error) {
            console.error("Email service error:", error);
            return { error: `Failed to send verification email: ${error}` };
        }

        console.log("Verification email sent successfully");
    } catch (e: unknown) {
        const error = e as Error;
        console.error("Email sending exception:", e);
        console.error("Exception details:", error.message, error.stack);
        return { error: `Failed to send verification email: ${error.message || 'Unknown error'}` };
    }

    return { success: true };
}

/**
 * Verify email token for EMAIL ALIAS.
 * This verifies secondary/backup emails, not primary authentication email changes.
 */
export async function verifyEmailToken(email: string, token: string) {
    const { user, error: authError } = await getAuthUser();

    if (authError || !user) {
        return { success: false, error: "Not authenticated" };
    }

    const supabase = await createClient();

    const { data: emailRecord, error: fetchError } = await supabase
        .from("user_emails")
        .select("*")
        .eq("user_id", user.id)
        .eq("email", email)
        .single();

    if (fetchError || !emailRecord) {
        return { error: "Email request not found" };
    }

    if (emailRecord.verification_token !== token) {
        return { error: "Invalid verification code" };
    }

    // Mark as verified
    const { error: updateError } = (await supabase
        .from("user_emails")
        .update({
            verified_at: new Date().toISOString(),
            verification_token: null // Clear token
        })
        .eq("id", emailRecord.id)) as { error: { message?: string } | null };

    if (updateError) {
        return { error: "Failed to verify email" };
    }

    return { success: true };
}

export type SetPrimaryEmailResponse = {
    success: boolean;
    error?: string;
    needsConfirmation?: boolean;
    pendingEmail?: string;
};

/**
 * @deprecated This function mixes Supabase auth AND custom user_emails table approaches.
 * It creates confusion between primary authentication email and email aliases.
 *
 * RECOMMENDED APPROACH:
 * - Use Security page (updateEmailAction in security/actions.ts) to change primary authentication email
 * - Use email aliases (sendVerificationEmail/verifyEmailToken) for secondary/backup emails only
 *
 * This function is kept for backward compatibility but should not be used in new code.
 */
export async function setPrimaryEmailAction(email: string): Promise<SetPrimaryEmailResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const { user, error: authError } = await getAuthUser();

    if (authError || !user) {
        return { success: false, error: "Not authenticated" };
    }

    const supabase = await createClient();

    const { data: aliasRecord, error: aliasError } = await supabase
        .from("user_emails")
        .select("id, verified_at")
        .eq("user_id", user.id)
        .eq("email", normalizedEmail)
        .maybeSingle();

    if (aliasError && aliasError.code !== "PGRST116") {
        console.error("Error fetching alias:", aliasError);
        return { success: false, error: "Unable to look up email" };
    }

    if (!aliasRecord) {
        return { success: false, error: "Email not linked to your account" };
    }

    if (!aliasRecord.verified_at) {
        return { success: false, error: "Verify this email before setting it as primary" };
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const redirectUrl = `${siteUrl.replace(/\/$/, "")}/auth/confirm?type=email_change`;

    const { data: updateData, error: updateError } = await supabase.auth.updateUser(
        {
            email: normalizedEmail,
            data: {
                ...(user.user_metadata || {}),
                primary_email: normalizedEmail,
            },
        },
        {
            emailRedirectTo: redirectUrl,
        },
    );

    if (updateError) {
        console.error("auth.updateUser failed:", updateError);
        return { success: false, error: updateError.message || "Failed to update primary email" };
    }

    const confirmedEmail = updateData?.user?.email?.toLowerCase?.();
    const pendingEmail = (updateData?.user as { new_email?: string })?.new_email?.toLowerCase?.();
    const needsConfirmation = confirmedEmail !== normalizedEmail && pendingEmail === normalizedEmail;

    if (needsConfirmation) {
        return {
            success: true,
            needsConfirmation: true,
            pendingEmail: normalizedEmail,
        };
    }

        const { error: profileError } = (await supabase
            .from("profiles")
            .update({
                email: normalizedEmail,
                updated_at: new Date().toISOString(),
            })
            .eq("id", user.id)) as { error: { message?: string } | null };

    if (profileError) {
        console.error("Profile update error:", profileError);
        return { success: false, error: "Failed to sync profile email" };
    }

    const { error: demoteError } = (await supabase
        .from("user_emails")
        .update({
            is_primary: false,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .neq("email", normalizedEmail)) as { error: { message?: string } | null };

    if (demoteError) {
        console.error("Failed to demote aliases:", demoteError);
        return { success: false, error: "Failed to update existing emails" };
    }

    const { error: promoteError } = (await supabase
        .from("user_emails")
        .update({
            is_primary: true,
            verified_at: new Date().toISOString(),
            verification_token: null,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("email", normalizedEmail)) as { error: { message?: string } | null };

    if (promoteError) {
        console.error("Failed to promote alias:", promoteError);
        return { success: false, error: "Failed to set email as primary" };
    }

    return {
        success: true,
    };
}
