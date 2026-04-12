"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAnonymousSignupAccessRecord } from "@/lib/anonymous-signup-access";
import { requireAuth } from "@/lib/supabase/auth-helpers";
import { revalidatePath } from "next/cache";

const getSiteUrl = () => {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/u, "") ||
    "http://localhost:3000"
  );
};

async function transferAnonymousDataToUser(
  anonymousId: string,
  userId: string,
  anonymousToken?: string,
): Promise<{ error?: string }> {
  const adminClient = getAdminClient();

  const { data: profile, error: profileError } = await getAnonymousSignupAccessRecord<{
    id: string;
    linked_user_id: string | null;
  }>({
    anonymousSignupId: anonymousId,
    token: anonymousToken,
    columns: "id, linked_user_id",
  });

  if (profileError || !profile) {
    return { error: "Anonymous profile not found or access denied." };
  }

  if (profile.linked_user_id && profile.linked_user_id !== userId) {
    return { error: "This profile is already linked to another account." };
  }

  const { error: transferSignupsError } = await adminClient
    .from("project_signups")
    .update({ user_id: userId, anonymous_id: null })
    .eq("anonymous_id", anonymousId)
    .is("user_id", null);

  if (transferSignupsError) {
    console.error("Error transferring project signups:", transferSignupsError);
    return { error: "Failed to transfer signups. Please try again." };
  }

  const { error: transferWaiversError } = await adminClient
    .from("waiver_signatures")
    .update({ user_id: userId, anonymous_id: null })
    .eq("anonymous_id", anonymousId)
    .is("user_id", null);

  if (transferWaiversError) {
    console.error("Error transferring waiver signatures:", transferWaiversError);
    return { error: "Failed to transfer waiver data. Please try again." };
  }

  if (profile.linked_user_id !== userId) {
    const { error: linkError } = await adminClient
      .from("anonymous_signups")
      .update({ linked_user_id: userId })
      .eq("id", anonymousId);

    if (linkError) {
      console.error("Error linking anonymous profile:", linkError);
      return { error: "Failed to complete account linking. Please try again." };
    }
  }

  revalidatePath(`/anonymous/${anonymousId}`);
  revalidatePath("/dashboard");
  revalidatePath("/home");

  return {};
}

/**
 * Link an anonymous profile to the currently authenticated account.
 * This is provider-agnostic and works for email/password and OAuth logins.
 */
export async function linkAnonymousToAuthenticatedAccount(
  anonymousId: string,
  anonymousToken?: string,
): Promise<{ error?: string }> {
  try {
    const user = await requireAuth();
    return transferAnonymousDataToUser(anonymousId, user.id, anonymousToken);
  } catch {
    return { error: "Please log in to link this anonymous profile." };
  }
}

/**
 * Start a Google OAuth flow, then return to the anonymous profile page to finish linking.
 */
export async function startAnonymousGoogleLink(
  anonymousId: string,
  anonymousToken: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const origin = getSiteUrl();

  const redirectAfterAuth = `/anonymous/${anonymousId}?token=${encodeURIComponent(anonymousToken)}&link=1`;
  const redirectTo = `${origin}/auth/callback?redirectAfterAuth=${encodeURIComponent(redirectAfterAuth)}`;

  const {
    data: { url },
    error,
  } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: {
        access_type: "offline",
        scope: "openid email profile",
      },
      redirectTo,
    },
  });

  if (error) {
    console.error("Error starting anonymous Google linking:", error);
    return { error: "Failed to connect with Google. Please try again." };
  }

  return { url: url ?? undefined };
}

/**
 * Link an anonymous profile to an existing Let's Assist account.
 * Verifies credentials, then transfers all project_signups to the authenticated user.
 */
export async function linkAnonymousToExistingAccount(
  anonymousId: string,
  anonymousToken: string,
  email: string,
  password: string,
  captchaToken?: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Verify the user's credentials by signing in
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined,
  });

  if (authError || !authData.user) {
    if (authError?.message?.toLowerCase().includes("captcha")) {
      return { error: "Security verification failed. Please complete CAPTCHA and try again." };
    }
    if (authError?.message?.toLowerCase().includes("provider")) {
      return { error: "This email uses a different sign-in method. Please use your original provider (for example Google)." };
    }
    return { error: "Invalid email or password." };
  }

  const userId = authData.user.id;
  return transferAnonymousDataToUser(anonymousId, userId, anonymousToken);
}

/**
 * Create a new Let's Assist account and link the anonymous profile to it.
 * Signs up the user, then transfers all project_signups.
 */
export async function linkAnonymousToNewAccount(
  anonymousId: string,
  anonymousToken: string,
  email: string,
  password: string,
  fullName: string,
  captchaToken?: string
): Promise<{ error?: string; requiresEmailVerification?: boolean }> {
  const supabase = await createClient();

  // Validate password length
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const origin = getSiteUrl();

  // Create the new account via regular signup flow so auth/session behavior
  // matches the rest of the app and confirmation emails are handled natively.
  const { data: signupData, error: signupError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${origin}/auth/confirm`,
      captchaToken,
    },
  });

  if (signupError) {
    if (signupError.message?.toLowerCase().includes("captcha")) {
      return { error: "Security verification failed. Please complete CAPTCHA and try again." };
    }
    if (signupError.message?.includes("already been registered") || signupError.message?.includes("already exists")) {
      return { error: "An account with this email already exists. Try linking to your existing account instead." };
    }
    console.error("Error creating account:", signupError);
    return { error: "Failed to create account. Please try again." };
  }

  if (!signupData.user) {
    return { error: "Failed to create account." };
  }

  const userId = signupData.user.id;

  const transferResult = await transferAnonymousDataToUser(
    anonymousId,
    userId,
    anonymousToken,
  );
  if (transferResult.error) {
    return { error: `Account created but linking failed: ${transferResult.error}` };
  }

  return { requiresEmailVerification: !signupData.session };
}
