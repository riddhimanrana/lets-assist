import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  applyStaffInviteForUser,
  type StaffInviteOutcome,
} from "@/lib/organization/staff-invite";
import { buildStaffInviteRedirectPath } from "@/lib/organization/staff-invite-outcome";
import {
  isRetryableAuthError,
  withRetryableAuthOperation,
} from "@/lib/supabase/retry-auth";
import { normalizeRedirectPath } from "@/app/signup/redirect-utils";
import {
  getAccountAccessErrorCode,
  isAccountBlockedStatus,
  readAccountAccessFromMetadata,
} from "@/lib/auth/account-access";
import {
  resolvePostAuthRedirectPath,
  buildMfaRedirectPath,
  shouldPromptForMfaChallenge,
  deriveAuthenticatorAssurance,
  type MfaListFactorsLike,
} from "@/lib/auth/mfa";
import { getGoogleSigninCapRestriction } from "@/lib/security/google-cap";

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
    const errorUrl = new URL(`${origin}/error`);
    if (error_description) {
      errorUrl.searchParams.set("message", error_description);
    }
    if (error) {
      errorUrl.searchParams.set("code", error);
    }
    return NextResponse.redirect(errorUrl.toString());
  }

  // Normal OAuth flow or email verification
  if (!error && code) {
    const supabase = await createClient();
    
    // First, check if this is an email verification (signup) or OAuth by checking the code without creating a session
    // For email verification, we want to show success page without logging in
    // For OAuth, we want to create a session and profile
    
    // Try to exchange the code for session info (without storing session)
    let exchangeResult: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>;

    try {
      exchangeResult = await withRetryableAuthOperation(async () => {
        const result = await supabase.auth.exchangeCodeForSession(code || "");

        // Retry only transient network/auth fetch failures.
        if (result.error && isRetryableAuthError(result.error)) {
          throw result.error;
        }

        return result;
      });
    } catch (retryError) {
      console.error("Session exchange retry exhausted:", retryError);

      if (!isRetryableAuthError(retryError)) {
        return NextResponse.redirect(`${origin}/error`);
      }

      if (from === "authentication") {
        return NextResponse.redirect(
          `${origin}/account/authentication?error=linking_failed`
        );
      }

      const loginUrl = new URL(`${origin}/login`);
      loginUrl.searchParams.set("error", "network-timeout");

      const normalizedRedirect = normalizeRedirectPath(redirectAfterAuth);
      if (normalizedRedirect) {
        loginUrl.searchParams.set("redirect", normalizedRedirect);
      }

      if (staffToken) {
        loginUrl.searchParams.set("staff_token", staffToken);
      }

      if (orgUsername) {
        loginUrl.searchParams.set("org", orgUsername);
      }

      return NextResponse.redirect(loginUrl.toString());
    }

    const { error: exchangeError } = exchangeResult;

    if (!exchangeError) {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          console.error(
            "Authenticated user lookup failed after code exchange:",
            userError,
          );

          if (from === "authentication") {
            return NextResponse.redirect(
              `${origin}/account/authentication?error=linking_failed`
            );
          }

          return NextResponse.redirect(`${origin}/error`);
        }

        const accountAccess = readAccountAccessFromMetadata(user.app_metadata ?? null);

        if (isAccountBlockedStatus(accountAccess.status)) {
          await supabase.auth.signOut();

          const loginUrl = new URL(`${origin}/login`);
          const errorCode = getAccountAccessErrorCode(accountAccess.status);

          if (errorCode) {
            loginUrl.searchParams.set("error", errorCode);
          }

          if (accountAccess.reason) {
            loginUrl.searchParams.set("reason", accountAccess.reason);
          }

          return NextResponse.redirect(loginUrl.toString());
        }

        const adminClient = getAdminClient();

        // Check if this email is blacklisted (catches OAuth signups with a banned email)
        if (user.email) {
          const { data: blacklisted } = await adminClient
            .from("banned_emails")
            .select("email")
            .eq("email", user.email.trim().toLowerCase())
            .maybeSingle();

          if (blacklisted) {
            await supabase.auth.signOut();
            return NextResponse.redirect(`${origin}/login?error=account-banned`);
          }
        }


        let inviteOutcome: StaffInviteOutcome | null = null;
  let isNewAccount = false;

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
        const isGoogleOAuthLogin =
          !!identities &&
          identities.length > 0 &&
          identities.some((identity) => identity.provider === "google");

        const googleCapRestriction = getGoogleSigninCapRestriction(
          user.app_metadata ?? null,
        );

        if (isGoogleOAuthLogin && googleCapRestriction.disabled) {
          await supabase.auth.signOut();

          const loginUrl = new URL(`${origin}/login`);
          loginUrl.searchParams.set("error", "google-signin-disabled");

          if (googleCapRestriction.reason) {
            loginUrl.searchParams.set("reason", googleCapRestriction.reason);
          }

          return NextResponse.redirect(loginUrl.toString());
        }

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
          isNewAccount = true;

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
            inviteOutcome = await applyStaffInviteForUser({
              userId: user.id,
              staffToken,
              orgUsername,
            });
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
            inviteOutcome = await applyStaffInviteForUser({
              userId: user.id,
              staffToken,
              orgUsername,
            });
          }
        }

        // Check if user needs MFA challenge before redirecting
        const currentAal = user.aud ? 'aal2' : 'aal1'; // Check AAL from user claims
        let mfaFactors: MfaListFactorsLike = { totp: [], phone: [] };
        
        try {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          if (factors) {
            mfaFactors = factors as MfaListFactorsLike;
          }
        } catch (mfaError) {
          console.debug('Could not fetch MFA factors during callback:', mfaError);
        }

        const userNeedsMfa = shouldPromptForMfaChallenge(
          deriveAuthenticatorAssurance(currentAal, mfaFactors),
          mfaFactors
        );

        // If user needs MFA, redirect to MFA challenge (preserving the intended destination)
        if (userNeedsMfa) {
          // Determine what the target path would be, then use it as the continuation path after MFA
          const targetPath = inviteOutcome
            ? buildStaffInviteRedirectPath(inviteOutcome, {
                fallbackPath: resolvePostAuthRedirectPath(redirectAfterAuth),
                toastPosition: isNewAccount ? "bottom-center" : undefined,
              })
            : resolvePostAuthRedirectPath(redirectAfterAuth);

          const mfaRedirectPath = buildMfaRedirectPath(targetPath);
          
          const forwardedHost = request.headers.get("x-forwarded-host");
          if (process.env.NODE_ENV === "development") {
            return NextResponse.redirect(`${origin}${mfaRedirectPath}`);
          } else if (forwardedHost) {
            return NextResponse.redirect(`https://${forwardedHost}${mfaRedirectPath}`);
          } else {
            return NextResponse.redirect(`${origin}${mfaRedirectPath}`);
          }
        }

        // Determine redirect path for OAuth or other flows
        const finalRedirectTo = inviteOutcome
          ? buildStaffInviteRedirectPath(inviteOutcome, {
              fallbackPath: resolvePostAuthRedirectPath(redirectAfterAuth),
              toastPosition: isNewAccount ? "bottom-center" : undefined,
            })
          : resolvePostAuthRedirectPath(redirectAfterAuth);

        const destinationPath = finalRedirectTo;

        const forwardedHost = request.headers.get("x-forwarded-host");
        
        // Handle redirect based on environment
        if (process.env.NODE_ENV === "development") {
          return NextResponse.redirect(`${origin}${destinationPath}`);
        } else if (forwardedHost) {
          return NextResponse.redirect(`https://${forwardedHost}${destinationPath}`);
        } else {
          return NextResponse.redirect(`${origin}${destinationPath}`);
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

