"use server";

import { createClient } from "@/utils/supabase/server";

type VerifyEmailResponse = {
  success: boolean;
  error?: string;
  email?: string;
};

/**
 * Verifies an email verification token to complete the email change process
 * @param token The verification token from the email link
 * @returns Response indicating success/error and the verified email if successful
 */
export async function verifyEmailToken(token: string): Promise<VerifyEmailResponse> {
  if (!token) {
    return { success: false, error: "No verification token provided" };
  }

  const supabase = await createClient();

  try {
    console.log("Starting email verification with token");
    
    // Step 1: Exchange the token for a session (similar to password reset flow)
    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(token);

    if (sessionError) {
      console.error("Session exchange error:", sessionError);
      return { 
        success: false, 
        error: sessionError.message || "Failed to verify email - invalid or expired token"
      };
    }

    // Get the user data from the session
    const user = sessionData?.user;
    if (!user) {
      console.error("No user in session data");
      return { success: false, error: "User not found in verification data" };
    }

    console.log("User found in session:", user.email);

    // Extract email from user data
    const newEmail = user.email;
    
    // Step 2: Update user's profile if you have a profiles table
    try {
      // Update the email in your profile table if needed
      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ 
          email: newEmail,
          updated_at: new Date().toISOString()
        })
        .eq("id", user.id);

      if (profileUpdateError) {
        console.error("Profile update error:", profileUpdateError);
        // Continue anyway since auth update succeeded
      }
    } catch (profileError) {
      console.error("Profile update exception:", profileError);
      // Continue anyway since auth update succeeded
    }

    // Step 3: Sign out the user - often a good practice after sensitive account changes
    await supabase.auth.signOut();

    return { 
      success: true,
      email: newEmail
    };

  } catch (error) {
    console.error("Unexpected error during email verification:", error);
    return { 
      success: false,
      error: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}
