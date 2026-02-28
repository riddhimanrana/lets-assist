"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
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
  userId: string
): Promise<{ error?: string }> {
  const adminClient = getAdminClient();

  const { data: profile, error: profileError } = await adminClient
    .from("anonymous_signups")
    .select("id, linked_user_id")
    .eq("id", anonymousId)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: "Anonymous profile not found." };
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
  anonymousId: string
): Promise<{ error?: string }> {
  try {
    const user = await requireAuth();
    return transferAnonymousDataToUser(anonymousId, user.id);
  } catch {
    return { error: "Please log in to link this anonymous profile." };
  }
}

/**
 * Link an anonymous profile to an existing Let's Assist account.
 * Verifies credentials, then transfers all project_signups to the authenticated user.
 */
export async function linkAnonymousToExistingAccount(
  anonymousId: string,
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
  return transferAnonymousDataToUser(anonymousId, userId);
}

/**
 * Create a new Let's Assist account and link the anonymous profile to it.
 * Signs up the user, then transfers all project_signups.
 */
export async function linkAnonymousToNewAccount(
  anonymousId: string,
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

  const transferResult = await transferAnonymousDataToUser(anonymousId, userId);
  if (transferResult.error) {
    return { error: `Account created but linking failed: ${transferResult.error}` };
  }

  return { requiresEmailVerification: !signupData.session };
}
