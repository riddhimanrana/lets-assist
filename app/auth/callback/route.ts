import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const redirectAfterAuth = searchParams.get("redirectAfterAuth");
  const error = searchParams.get("error");
  const error_description = searchParams.get("error_description");

  // For password reset flow
  if (code && type === "recovery") {
    // Simply redirect to the reset password page with the code (token)
    return NextResponse.redirect(
      `${origin}/reset-password/${code}`
    );
  }

  // Handle errors for all flows
  if (error) {
    console.error("OAuth error:", error, error_description);
    // Check if the error is due to existing email-password account
    if (error_description?.includes("email already exists")) {
      return NextResponse.redirect(
        `${origin}/login?error=email-password-exists`,
      );
    }
    return NextResponse.redirect(`${origin}/error`);
  }

  // Normal OAuth flow or email verification
  if (!error && code) {
    const supabase = await createClient();
    
    // First, check if this is an email verification (signup) or OAuth by checking the code without creating a session
    // For email verification, we want to show success page without logging in
    // For OAuth, we want to create a session and profile
    
    // Try to exchange the code for session info (without storing session)
    const {
      data: { session },
      error: exchangeError,
    } = await supabase.auth.exchangeCodeForSession(code || '');

    if (!exchangeError && session) {
      try {
        const { user } = session;
        
        // Check if this is an email verification (signup confirmation)
        // Detect by checking if the user was just created (within last 5 minutes)
        const userCreatedAt = new Date(user.created_at);
        const now = new Date();
        const timeSinceCreation = now.getTime() - userCreatedAt.getTime();
        const isRecentSignup = timeSinceCreation < 5 * 60 * 1000; // 5 minutes
        
        // Check if user has completed onboarding
        const hasCompletedOnboarding = user.user_metadata?.has_completed_onboarding === true;
        
        // Check if this is an OAuth login (Google, etc.) by checking identities
        const isOAuthLogin = user.identities && user.identities.length > 0 && 
                            user.identities.some(identity => identity.provider !== 'email');

        // ONLY show verification success page for email/password signups (not OAuth)
        // If this is a recent email/password signup verification, DON'T sign in the user
        // Just show the success page
        if (isRecentSignup && !hasCompletedOnboarding && !redirectAfterAuth && !isOAuthLogin) {
          const userEmail = user.email;
          // Sign out to clear the session that was just created
          await supabase.auth.signOut();
          
          const redirectUrl = new URL(`${origin}/auth/verification-success`);
          redirectUrl.searchParams.set('type', 'signup');
          if (userEmail) {
            redirectUrl.searchParams.set('email', userEmail);
          }
          return NextResponse.redirect(redirectUrl.toString());
        }

        // This is an OAuth flow or existing user - create/update profile
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (!existingProfile) {
          // Get user's full name and avatar from Google identity data first, then fallback to metadata
          const identityData = user.identities?.[0]?.identity_data;
          const fullName =
            identityData?.full_name ||
            identityData?.name ||
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            "Unknown User";

          // Try to get the highest quality avatar URL available
          const avatarUrl =
            identityData?.avatar_url ||
            identityData?.picture ||
            user.user_metadata?.avatar_url ||
            user.user_metadata?.picture;

          // Create profile with email
          const { error: profileError } = await supabase
            .from("profiles")
            .insert({
              id: user.id,
              full_name: fullName,
              username: `user_${user.id?.slice(0, 8)}`,
              avatar_url: avatarUrl,
              email: user.email,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

          if (profileError) {
            console.error("Profile creation error:", profileError);
            throw profileError;
          }
        } else {
          // Update email in case it changed
          const { error: updateError } = await supabase
            .from("profiles")
            .update({ 
              email: user.email,
              updated_at: new Date().toISOString()
            })
            .eq("id", user.id);

          if (updateError) {
            console.error("Profile update error:", updateError);
            throw updateError;
          }
        }

        // Determine redirect path for OAuth or other flows
        const redirectTo = redirectAfterAuth
          ? (() => {
              const decoded = decodeURIComponent(redirectAfterAuth);
              try {
                // Parse as full URL to extract pathname and search params
                const url = new URL(decoded);
                return url.pathname + url.search; // Include both path and query params
              } catch {
                // If URL parsing fails, assume it's just a path and return as-is
                return decoded;
              }
            })()
          : "/home";

        const forwardedHost = request.headers.get("x-forwarded-host");
        
        // Handle redirect based on environment
        if (process.env.NODE_ENV === "development") {
          return NextResponse.redirect(`${origin}${redirectTo}`);
        } else if (forwardedHost) {
          return NextResponse.redirect(`https://${forwardedHost}${redirectTo}`);
        } else {
          return NextResponse.redirect(`${origin}${redirectTo}`);
        }
      } catch (error) {
        console.error("Error in callback:", error);
        return NextResponse.redirect(`${origin}/error`);
      }
    } else {
      console.error("Session error:", exchangeError);
      if (exchangeError?.message?.includes("email already exists")) {
        return NextResponse.redirect(
          `${origin}/login?error=email-password-exists`,
        );
      }
      return NextResponse.redirect(`${origin}/error`);
    }
  }

  return NextResponse.redirect(`${origin}/error`);
}
