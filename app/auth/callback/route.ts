import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const from = searchParams.get("from");
  const redirectAfterAuth = searchParams.get("redirectAfterAuth");
  const error = searchParams.get("error");
  const error_description = searchParams.get("error_description");
  const staffToken = searchParams.get("staffToken");
  const orgUsername = searchParams.get("orgUsername");

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

        // Handle account linking redirection for authentication page
        if (from === "authentication") {
          return NextResponse.redirect(`${origin}/account/authentication?success=linked`);
        }
        
        // Check if this is an email verification (signup confirmation)
        // Detect by checking if the user was just created (within last 5 minutes)
        const userCreatedAt = new Date(user.created_at);
        const now = new Date();
        const timeSinceCreation = now.getTime() - userCreatedAt.getTime();
        const isRecentSignup = timeSinceCreation < 5 * 60 * 1000; // 5 minutes
        
        // Check if user has completed onboarding
        const userMetadata = user.user_metadata as { has_completed_onboarding?: boolean } | null;
        const hasCompletedOnboarding = userMetadata?.has_completed_onboarding === true;
        
        // Check if this is an OAuth login (Google, etc.) by checking identities
        const identities = (user as { identities?: Array<{ provider?: string | null }> })
          .identities;
        const isOAuthLogin =
          !!identities &&
          identities.length > 0 &&
          identities.some((identity) => identity.provider !== "email");

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
        const { data: existingProfile } = (await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single()) as { data: Record<string, unknown> | null };

        if (!existingProfile) {
          // Get user's full name and avatar from identity data, then fallback to metadata
          const identities = (user as { identities?: Array<{ identity_data?: Record<string, unknown> }> })
            .identities;
          const identityData = identities?.[0]?.identity_data as
            | {
                full_name?: string;
                name?: string;
                avatar_url?: string;
                picture?: string;
              }
            | undefined;
          const userMetadata = user.user_metadata as
            | {
                full_name?: string;
                name?: string;
                avatar_url?: string;
                picture?: string;
              }
            | null;
          const fullName =
            identityData?.full_name ||
            identityData?.name ||
            userMetadata?.full_name ||
            userMetadata?.name ||
            "Unknown User";

          // Try to get the highest quality avatar URL available
          const avatarUrl =
            identityData?.avatar_url ||
            identityData?.picture ||
            userMetadata?.avatar_url ||
            userMetadata?.picture;

          // Create profile with email
          const { error: profileError } = (await supabase
            .from("profiles")
            .insert({
              id: user.id,
              full_name: fullName,
              username: `user_${user.id?.slice(0, 8)}`,
              avatar_url: avatarUrl,
              email: user.email,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })) as { error: { message?: string } | null };

          if (profileError) {
            console.error("Profile creation error:", profileError);
            throw profileError;
          }

          // Handle auto-join by email domain for new OAuth users
          if (user.email) {
            try {
              await handleEmailDomainAffiliation(user.id, user.email);
            } catch (affiliationError) {
              console.error("Error processing email affiliation:", affiliationError);
              // Don't fail signup if affiliation processing fails
            }
          }

          // Handle staff invite token if present
          if (staffToken && orgUsername) {
            try {
              await handleStaffInvite(user.id, staffToken, orgUsername);
            } catch (inviteError) {
              console.error("Error processing staff invite:", inviteError);
              // Don't fail OAuth login if invite processing fails
            }
          }
        } else {
          // Update email in case it changed
          const { error: updateError } = (await supabase
            .from("profiles")
            .update({ 
              email: user.email,
              updated_at: new Date().toISOString()
            })
            .eq("id", user.id)) as { error: { message?: string } | null };

          if (updateError) {
            console.error("Profile update error:", updateError);
            throw updateError;
          }

          // Handle staff invite token for existing users too
          if (staffToken && orgUsername) {
            try {
              await handleStaffInvite(user.id, staffToken, orgUsername);
            } catch (inviteError) {
              console.error("Error processing staff invite:", inviteError);
              // Don't fail OAuth login if invite processing fails
            }
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
      if (from === "authentication") {
        return NextResponse.redirect(
          `${origin}/account/authentication?error=linking_failed`
        );
      }
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

/**
 * Handle email domain affiliation - auto-add user to organization based on email domain
 */
async function handleEmailDomainAffiliation(userId: string, email: string): Promise<void> {
  const adminClient = getAdminClient();
  
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return;

  // Check if any organization has auto_join_domain set to this domain
  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, name")
    .eq("auto_join_domain", domain)
    .single();

  if (orgError || !org) {
    return;
  }

  // Add user to the organization as a member
  const { error: memberError } = (await adminClient
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: userId,
      role: "member",
    })) as { error: { message?: string; code?: string } | null };

  if (memberError) {
    if (memberError.code !== "23505") {
      console.error(`Error adding user to org ${org.id}:`, memberError);
    }
    return;
  }

  // Store the auto-joined organization info in user metadata for display after onboarding
  await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      auto_joined_org_id: org.id,
      auto_joined_org_name: org.name,
    }
  });

  console.log(`User ${userId} auto-affiliated with organization ${org.id} via domain ${domain}`);
}

/**
 * Handle staff invite - add user to organization as staff via invite token
 */
async function handleStaffInvite(userId: string, token: string, orgUsername: string): Promise<void> {
  const adminClient = getAdminClient();

  // Validate organization and token
  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, staff_join_token, staff_join_token_expires_at")
    .eq("username", orgUsername)
    .single();

  if (orgError || !org) {
    return; // Org not found, skip silently
  }

  // Validate token match
  if (org.staff_join_token !== token) {
    return; // Token mismatch, skip silently
  }

  // Validate token expiry
  const expiresAt = org.staff_join_token_expires_at;
  if (!expiresAt || new Date(expiresAt) < new Date()) {
    return; // Token expired, skip silently
  }

  // Add user as staff member
  const { error: memberError } = (await adminClient
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: userId,
      role: "staff",
    })) as { error: { message?: string; code?: string } | null };

  if (memberError) {
    // If duplicate membership exists (23505), check existing role before updating
    if (memberError.code === "23505") {
      // Query existing membership to check current role
      const { data: existingMembership, error: queryError } = await adminClient
        .from("organization_members")
        .select("role")
        .eq("organization_id", org.id)
        .eq("user_id", userId)
        .single();

      if (queryError || !existingMembership) {
        console.error(`Error querying existing membership for org ${org.id}:`, queryError);
        return;
      }

      // Only upgrade if current role is 'member'
      // Do NOT downgrade admin or staff roles
      if (existingMembership.role === "member") {
        const { error: updateError } = await adminClient
          .from("organization_members")
          .update({ role: "staff" })
          .eq("organization_id", org.id)
          .eq("user_id", userId);

        if (updateError) {
          console.error(`Error updating membership role to staff for org ${org.id}:`, updateError);
          return;
        }

        console.log(`User ${userId} membership upgraded to staff for organization ${org.id} via invite token`);
        return;
      }

      // If already staff or admin, skip update silently
      console.log(`User ${userId} already has role '${existingMembership.role}' for organization ${org.id}, skipping staff invite`);
      return;
    }

    // Log error for other non-duplicate errors
    console.error(`Error adding staff member to org ${org.id}:`, memberError);
    return;
  }

  console.log(`User ${userId} added as staff to organization ${org.id} via invite token`);
}
