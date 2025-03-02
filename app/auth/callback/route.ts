import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = "/home";
  const error = searchParams.get("error");
  const error_description = searchParams.get("error_description");

  // Handle OAuth errors
  if (error) {
    console.error("OAuth error:", error, error_description);
    // Check if the error is due to existing email-password account
    if (error_description?.includes("email already exists")) {
      return NextResponse.redirect(
        `${origin}/login?error=email-password-exists`,
      );
    }
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  if (code) {
    const supabase = await createClient();
    const {
      data: { session },
      error,
    } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && session) {
      try {
        const { user } = session;
        // console.log('Full user object:', JSON.stringify(user, null, 2))
        // console.log('User metadata:', user.user_metadata)
        // console.log('User identities:', user.identities)

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
            identityData?.avatar_url?.replace("=s96-c", "=s400-c") || // Upgrade Google avatar size
            identityData?.picture?.replace("=s96-c", "=s400-c") ||
            user.user_metadata?.avatar_url ||
            user.user_metadata?.picture;

          // console.log('Google identity data:', identityData)
          // console.log('Selected avatar URL:', avatarUrl)

          // Create profile
          const { error: profileError } = await supabase
            .from("profiles")
            .insert({
              id: user.id,
              full_name: fullName,
              username: `user_${user.id?.slice(0, 8)}`,
              avatar_url: avatarUrl,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

          if (profileError) {
            console.error("Profile creation error:", profileError);
            throw profileError;
          }
        } else {
          // console.log('Found existing profile:', existingProfile)
        }

        const forwardedHost = request.headers.get("x-forwarded-host");
        const isLocalEnv = process.env.NODE_ENV === "development";

        if (isLocalEnv) {
          return NextResponse.redirect(`${origin}${next}`);
        } else if (forwardedHost) {
          return NextResponse.redirect(`https://${forwardedHost}${next}`);
        } else {
          return NextResponse.redirect(`${origin}${next}`);
        }
      } catch (error) {
        console.error("Error in callback:", error);
        return NextResponse.redirect(`${origin}/auth/auth-code-error`);
      }
    } else {
      console.error("Session error:", error);
      if (error?.message?.includes("email already exists")) {
        return NextResponse.redirect(
          `${origin}/login?error=email-password-exists`,
        );
      }
      return NextResponse.redirect(`${origin}/auth/auth-code-error`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
