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

  // Normal OAuth flow
  if (!error && code) {
    const supabase = await createClient();
    const {
      data: { session },
      error,
    } = await supabase.auth.exchangeCodeForSession(code || '');

    if (!error && session) {
      try {
        const { user } = session;

        // Check if profile already exists
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
            identityData?.avatar_url?.
            identityData?.picture?.
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

        // Determine redirect path
        const redirectTo = redirectAfterAuth
          ? (() => {
              const decoded = decodeURIComponent(redirectAfterAuth);
              try {
                return new URL(decoded).pathname;
              } catch {
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
      console.error("Session error:", error);
      if (error?.message?.includes("email already exists")) {
        return NextResponse.redirect(
          `${origin}/login?error=email-password-exists`,
        );
      }
      return NextResponse.redirect(`${origin}/error`);
    }
  }

  return NextResponse.redirect(`${origin}/error`);
}
