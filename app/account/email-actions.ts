"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import {
    EMAIL_ALIAS_CODE_TTL_MS,
    generateEmailAliasVerificationCode,
    hashEmailAliasVerificationCode,
    normalizeEmailAlias,
} from "@/lib/auth/email-alias-verification";
import { syncPrimaryUserEmail } from "@/lib/auth/primary-email";
import { sendEmail } from "@/services/email";
import EmailVerificationCode from "@/emails/email-verification-code";
import * as React from "react";
import { z } from "zod";

const emailAliasSchema = z.string().trim().email().max(320);
const emailAliasCodeSchema = z.string().trim().regex(/^\d{6}$/u);
const GENERIC_ALIAS_ERROR = "Unable to verify this email or code. Request a new code and try again.";

async function discardUndeliveredAliasChallenge(input: {
    challengeId: string;
    userId: string;
    tokenHash: string;
}) {
    const admin = getAdminClient();
    const { error } = await admin.rpc("discard_user_email_alias_verification", {
        p_challenge_id: input.challengeId,
        p_user_id: input.userId,
        p_token_hash: input.tokenHash,
    });

    if (error) {
        console.error("Failed to discard undelivered email-alias challenge:", error);
    }
}

/**
 * Send verification email for EMAIL ALIAS (not primary email change).
 * Use the Security page to change your primary authentication email.
 *
 * This function manages secondary/backup emails stored in the user_emails table.
 */
export async function sendVerificationEmail(email: string) {
    const parsedEmail = emailAliasSchema.safeParse(email);
    if (!parsedEmail.success) {
        return { success: false, error: "Enter a valid email address." };
    }

    const { user, error: authError } = await getAuthUser({ sensitive: true, checkMfa: true });

    if (authError || !user) {
        return { success: false, error: "Not authenticated" };
    }

    const admin = getAdminClient();
    const normalizedEmail = normalizeEmailAlias(parsedEmail.data);

    const token = generateEmailAliasVerificationCode();
    const tokenHash = hashEmailAliasVerificationCode(token);
    const now = new Date();
    const { data: issueRows, error: issueError } = await admin.rpc(
        "issue_user_email_alias_verification",
        {
            p_user_id: user.id,
            p_email: normalizedEmail,
            p_token_hash: tokenHash,
            p_expires_at: new Date(now.getTime() + EMAIL_ALIAS_CODE_TTL_MS).toISOString(),
        },
    );
    const issue = Array.isArray(issueRows) ? issueRows[0] : issueRows;

    if (issueError || !issue) {
        console.error("Error preparing email verification:", issueError);
        return { error: "Unable to send a verification code." };
    }

    if (issue.status === "unavailable") {
        return { error: "Unable to use this email address." };
    }

    if (issue.status === "already_verified") {
        return { success: true, alreadyVerified: true };
    }

    if (issue.status === "cooldown" || issue.status === "locked") {
        return {
            error: "Please wait before requesting another verification code.",
            retryAfterSeconds: Math.max(Number(issue.retry_after_seconds ?? 1), 1),
        };
    }

    if (issue.status !== "issued" || typeof issue.challenge_id !== "string") {
        return { error: "Unable to send a verification code." };
    }

    try {
        const { error } = await sendEmail({
            to: normalizedEmail,
            subject: 'Verify your email address',
            react: React.createElement(EmailVerificationCode, { code: token, expiresInHours: 0.5 }),
            type: 'transactional'
        });

        if (error) {
            console.error("Email service error:", error);
            await discardUndeliveredAliasChallenge({
                challengeId: issue.challenge_id,
                userId: user.id,
                tokenHash,
            });
            return { error: "Unable to send a verification code." };
        }
    } catch (error: unknown) {
        console.error("Email sending exception:", error);
        await discardUndeliveredAliasChallenge({
            challengeId: issue.challenge_id,
            userId: user.id,
            tokenHash,
        });
        return { error: "Unable to send a verification code." };
    }

    return { success: true };
}

/**
 * Verify email token for EMAIL ALIAS.
 * This verifies secondary/backup emails, not primary authentication email changes.
 */
export async function verifyEmailToken(email: string, token: string) {
    const parsedEmail = emailAliasSchema.safeParse(email);
    const parsedToken = emailAliasCodeSchema.safeParse(token);
    if (!parsedEmail.success || !parsedToken.success) {
        return { success: false, error: GENERIC_ALIAS_ERROR };
    }

    const { user, error: authError } = await getAuthUser({ sensitive: true, checkMfa: true });

    if (authError || !user) {
        return { success: false, error: "Not authenticated" };
    }

    const admin = getAdminClient();
    const { data, error } = await admin.rpc("verify_user_email_alias", {
        p_user_id: user.id,
        p_email: normalizeEmailAlias(parsedEmail.data),
        p_token_hash: hashEmailAliasVerificationCode(parsedToken.data),
    });

    if (error || data !== "verified") {
        if (error) console.error("Email alias verification failed:", error);
        return { success: false, error: GENERIC_ALIAS_ERROR };
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
    const parsedEmail = emailAliasSchema.safeParse(email);
    if (!parsedEmail.success) {
        return { success: false, error: "Enter a valid email address." };
    }
    const normalizedEmail = normalizeEmailAlias(parsedEmail.data);
    const { user, error: authError } = await getAuthUser({ sensitive: true, checkMfa: true });

    if (authError || !user) {
        return { success: false, error: "Not authenticated" };
    }

    const supabase = await createClient();
    const admin = getAdminClient();

    const { data: aliasRecord, error: aliasError } = await admin
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

    const primarySync = await syncPrimaryUserEmail(user.id);
    if (!primarySync.success) {
        return { success: false, error: "Failed to synchronize the primary email" };
    }

    return {
        success: true,
    };
}

export async function getLinkedIdentitiesAction() {
    const { user, error: authError } = await getAuthUser({ sensitive: true, checkMfa: true });
    if (authError || !user) {
        return { success: false as const, error: "Not authenticated", emails: [] };
    }

    const primarySync = await syncPrimaryUserEmail(user.id);
    if (!primarySync.success) {
        return { success: false as const, error: "Unable to synchronize primary email", emails: [] };
    }

    const admin = getAdminClient();
    const { data, error } = await admin
        .from("user_emails")
        .select("id, user_id, email, is_primary, verified_at, created_at, updated_at")
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false });

    if (error) {
        return { success: false as const, error: "Unable to load email aliases", emails: [] };
    }

    return { success: true as const, emails: data ?? [] };
}
