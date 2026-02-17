"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

const getSiteUrl = () => {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/u, "") ||
    "http://localhost:3000"
  );
};

/**
 * Link an anonymous profile to an existing Let's Assist account.
 * Verifies credentials, then transfers all project_signups to the authenticated user.
 */
export async function linkAnonymousToExistingAccount(
  anonymousId: string,
  email: string,
  password: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Verify the anonymous profile exists and is not already linked
  const { data: profile, error: profileError } = await supabase
    .from("anonymous_signups")
    .select("id, project_id, linked_user_id")
    .eq("id", anonymousId)
    .single();

  if (profileError || !profile) {
    return { error: "Anonymous profile not found." };
  }

  if (profile.linked_user_id) {
    return { error: "This profile is already linked to an account." };
  }

  // Verify the user's credentials by signing in
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return { error: "Invalid email or password." };
  }

  const userId = authData.user.id;

  // Use admin client to transfer signups and update the anonymous profile
  const adminClient = getAdminClient();

  // Transfer all project_signups from anonymous to the authenticated user
  const { error: transferError } = await adminClient
    .from("project_signups")
    .update({ user_id: userId })
    .eq("anonymous_id", anonymousId)
    .is("user_id", null);

  if (transferError) {
    console.error("Error transferring signups:", transferError);
    return { error: "Failed to transfer signups. Please try again." };
  }

  // Mark the anonymous profile as linked
  const { error: linkError } = await adminClient
    .from("anonymous_signups")
    .update({ linked_user_id: userId })
    .eq("id", anonymousId);

  if (linkError) {
    console.error("Error linking profile:", linkError);
    return { error: "Failed to link profile. Your signups were transferred but the profile link failed." };
  }

  return {};
}

/**
 * Create a new Let's Assist account and link the anonymous profile to it.
 * Signs up the user, then transfers all project_signups.
 */
export async function linkAnonymousToNewAccount(
  anonymousId: string,
  email: string,
  password: string,
  fullName: string
): Promise<{ error?: string; requiresEmailVerification?: boolean }> {
  const supabase = await createClient();

  // Verify the anonymous profile exists and is not already linked
  const { data: profile, error: profileError } = await supabase
    .from("anonymous_signups")
    .select("id, project_id, linked_user_id")
    .eq("id", anonymousId)
    .single();

  if (profileError || !profile) {
    return { error: "Anonymous profile not found." };
  }

  if (profile.linked_user_id) {
    return { error: "This profile is already linked to an account." };
  }

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
    },
  });

  if (signupError) {
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

  const adminClient = getAdminClient();

  // Transfer all project_signups from anonymous to the new user
  const { error: transferError } = await adminClient
    .from("project_signups")
    .update({ user_id: userId })
    .eq("anonymous_id", anonymousId)
    .is("user_id", null);

  if (transferError) {
    console.error("Error transferring signups:", transferError);
    return { error: "Account created but failed to transfer signups. Please contact support." };
  }

  // Mark the anonymous profile as linked
  const { error: linkError } = await adminClient
    .from("anonymous_signups")
    .update({ linked_user_id: userId })
    .eq("id", anonymousId);

  if (linkError) {
    console.error("Error linking profile:", linkError);
    // Non-critical - signups were already transferred
  }

  return { requiresEmailVerification: !signupData.session };
}
