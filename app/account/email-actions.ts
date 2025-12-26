"use server";

import { createClient } from "@/utils/supabase/server";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

const buildVerificationEmailHtml = (token: string) => {
    const year = new Date().getFullYear();
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Confirm Your Email</title>
            <style>
                // @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

                * {
                    margin: 0;
                    padding: 0;
                    font-family: 'Inter', 'Arial', sans-serif;
                }
                body {
                    background-color: #f9f9f9;
                    color: #333;
                    line-height: 1.6;
                }
                .email-container {
                    background-color: #ffffff;
                    overflow: hidden;
                }
                .email-body {
                    padding: 32px 24px;
                    background-color: #ffffff;
                }
                h1 {
                    color: #222;
                    font-size: 28px;
                    font-weight: 700;
                    margin-bottom: 20px;
                    letter-spacing: -0.02em;
                }
                p {
                    color: #555;
                    font-size: 16px;
                    margin-bottom: 20px;
                }
                .verification-wrapper {
                    background-color: #f8f9fa;
                    border-radius: 6px;
                    padding: 24px;
                    margin: 24px 0;
                    text-align: center;
                    border-left: 4px solid #16a34a;
                }
                .verification-label {
                    margin: 0;
                    font-size: 14px;
                    color: #666;
                    text-transform: uppercase;
                    letter-spacing: 0.15em;
                }
                .verification-code {
                    font-size: 36px;
                    font-weight: 700;
                    color: #16a34a;
                    margin: 12px 0 0;
                    letter-spacing: 0.4em;
                }
                .email-footer {
                    padding: 20px 24px;
                    text-align: center;
                    font-size: 14px;
                    color: #777;
                    background-color: #f9fafb;
                    border-top: 1px solid #f0f0f0;
                }
                .help-text {
                    font-size: 14px;
                    color: #777;
                }
                .security-note {
                    margin-top: 28px;
                    padding-top: 16px;
                    border-top: 1px solid #f0f0f0;
                    font-size: 15px;
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="email-body">
                    <h1>Confirm Your Email</h1>
                    <p>Hello,</p>
                    <p>We're excited to have you on board. Enter the verification code below in Let's Assist to finish linking this email to your account.</p>

                    <div class="verification-wrapper">
                        <p class="verification-label">Your verification code</p>
                        <p class="verification-code">${token}</p>
                    </div>

                    <p class="help-text">This code will expire in 24 hours. If you didn't request this, you can safely ignore this email.</p>

                    <div class="security-note">
                        <p>Need help? Reply to this email or reach us at support@lets-assist.com.</p>
                    </div>
                </div>
                <div class="email-footer">
                    <p>&copy; ${year} Riddhiman Rana. All rights reserved.</p>
                    <p>Need help? Contact us at <a href="mailto:support@lets-assist.com" style="color: #16a34a; font-weight: 500;">support@lets-assist.com</a></p>
                </div>
            </div>
        </body>
        </html>
    `;
};

export async function sendVerificationEmail(email: string) {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        return { success: false, error: "Not authenticated" };
    }

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
    const { error: insertError } = await supabase
        .from("user_emails")
        .upsert({
            user_id: user.id,
            email: email.toLowerCase(),
            verification_token: token,
            verified_at: null, // Reset verification if re-adding/verifying
            is_primary: false
        }, { onConflict: 'email' }); // Use email as conflict target since it's unique

    if (insertError) {
        console.error("Error inserting email:", insertError);
        return { error: "Failed to add email. Please try again." };
    }

    // Send email
    try {
        console.log("Attempting to send verification email to:", email);
        const { data, error } = await resend.emails.send({
            from: 'Let\'s Assist <projects@notifications.lets-assist.com>',
            to: email,
            subject: 'Verify your email address',
            html: buildVerificationEmailHtml(token)
        });

        if (error) {
            console.error("Resend API error details:", JSON.stringify(error, null, 2));
            return { error: `Failed to send verification email: ${error.message || 'Unknown error'}` };
        }

        console.log("Verification email sent successfully:", data);
    } catch (e: any) {
        console.error("Email sending exception:", e);
        console.error("Exception details:", e.message, e.stack);
        return { error: `Failed to send verification email: ${e.message || 'Unknown error'}` };
    }

    return { success: true };
}


export async function verifyEmailToken(email: string, token: string) {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        return { success: false, error: "Not authenticated" };
    }

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
    const { error: updateError } = await supabase
        .from("user_emails")
        .update({
            verified_at: new Date().toISOString(),
            verification_token: null // Clear token
        })
        .eq("id", emailRecord.id);

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

export async function setPrimaryEmailAction(email: string): Promise<SetPrimaryEmailResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const supabase = await createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return { success: false, error: "Not authenticated" };
    }

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
    const redirectUrl = `${siteUrl.replace(/\/$/, "")}/auth/verification-success?type=email_change`;

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
    const pendingEmail = (updateData?.user as any)?.new_email?.toLowerCase?.();
    const needsConfirmation = confirmedEmail !== normalizedEmail && pendingEmail === normalizedEmail;

    if (needsConfirmation) {
        return {
            success: true,
            needsConfirmation: true,
            pendingEmail: normalizedEmail,
        };
    }

    const { error: profileError } = await supabase
        .from("profiles")
        .update({
            email: normalizedEmail,
            updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

    if (profileError) {
        console.error("Profile update error:", profileError);
        return { success: false, error: "Failed to sync profile email" };
    }

    const { error: demoteError } = await supabase
        .from("user_emails")
        .update({
            is_primary: false,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .neq("email", normalizedEmail);

    if (demoteError) {
        console.error("Failed to demote aliases:", demoteError);
        return { success: false, error: "Failed to update existing emails" };
    }

    const { error: promoteError } = await supabase
        .from("user_emails")
        .update({
            is_primary: true,
            verified_at: new Date().toISOString(),
            verification_token: null,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("email", normalizedEmail);

    if (promoteError) {
        console.error("Failed to promote alias:", promoteError);
        return { success: false, error: "Failed to set email as primary" };
    }

    return {
        success: true,
    };
}
