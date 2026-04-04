"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";
import { buildAuthConfirmRedirectUrl, normalizeRedirectPath } from "./redirect-utils";
import {
  applyStaffInviteForUser,
  type StaffInviteOutcome,
} from "@/lib/organization/staff-invite";

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  turnstileToken: z.string().nullish(),
  staffToken: z.string().nullish(),
  orgUsername: z.string().nullish(),
});

const getSiteUrl = () => {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelSiteUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;

  return (configuredSiteUrl || vercelSiteUrl || "http://localhost:3000").replace(/\/+$/u, "");
};

type SignupStatus = 
  | { type: 'confirmed'; message: string }
  | { type: 'unconfirmed'; message: string }
  | { type: 'new'; message: string };

export async function checkEmailStatus(email: string): Promise<SignupStatus> {
  if (process.env.E2E_TEST_MODE === "true") {
    return { type: 'new', message: 'E2E test mode: email is new' };
  }

  try {
    const adminClient = getAdminClient();
    const normalizedEmail = email.trim().toLowerCase();
    const perPage = 100;
    const maxPages = 100;
    let existingUser: { email?: string | null; email_confirmed_at?: string | null } | null = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage,
      });

      if (error) {
        console.error("Error checking email status:", error);
        throw error;
      }

      const users = data?.users ?? [];
      existingUser = users.find((u) => u.email?.toLowerCase() === normalizedEmail) ?? null;

      if (existingUser || users.length < perPage) {
        break;
      }
    }

    if (!existingUser) {
      return { type: 'new', message: 'Email is available for signup' };
    }
    
    // Check if email is confirmed - use explicit truthy check
    const isConfirmed = !!existingUser.email_confirmed_at;
    
    if (isConfirmed) {
      return { 
        type: 'confirmed', 
        message: 'An account with this email already exists and is verified. Please log in to access your account.' 
      };
    } else {
      return { 
        type: 'unconfirmed', 
        message: 'It looks like you already signed up but haven\'t confirmed your email yet. Would you like us to resend the verification link?' 
      };
    }
  } catch (error) {
    console.error("Error in checkEmailStatus:", error);
    throw error;
  }
}

function getResendErrorCode(message: string, status?: number) {
  const lowered = message.toLowerCase();

  if (
    status === 429 ||
    lowered.includes("captcha") ||
    lowered.includes("rate") ||
    lowered.includes("too many")
  ) {
    return "captcha_required";
  }

  if (lowered.includes("expired") || lowered.includes("otp") || lowered.includes("token")) {
    return "link_expired";
  }

  return undefined;
}

export async function signup(formData: FormData) {
  const turnstileToken = formData.get("turnstileToken") as string;
  const staffToken = formData.get("staffToken") as string | undefined;
  const orgUsername = formData.get("orgUsername") as string | undefined;
  const redirectUrl = normalizeRedirectPath(formData.get("redirectUrl")?.toString() ?? null);

  const validatedFields = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken,
    staffToken,
    orgUsername,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  if (process.env.E2E_TEST_MODE === "true") {
    return {
      success: true,
      email: validatedFields.data.email,
      message: "E2E test signup stubbed success",
    };
  }

  const supabase = await createClient();

  try {
    const origin = getSiteUrl();
    
    // Check email status first
    const emailStatus = await checkEmailStatus(validatedFields.data.email);
    
    if (emailStatus.type === 'confirmed') {
      return { 
        error: { server: [emailStatus.message] },
        emailStatus: 'confirmed'
      };
    }
    
    if (emailStatus.type === 'unconfirmed') {
      return { 
        error: { server: [emailStatus.message] },
        emailStatus: 'unconfirmed',
        email: validatedFields.data.email
      };
    }

    // Check if this email is blacklisted
    const adminClient = getAdminClient();
    const normalizedSignupEmail = validatedFields.data.email.trim().toLowerCase();
    const { data: blacklisted } = await adminClient
      .from("banned_emails")
      .select("email")
      .eq("email", normalizedSignupEmail)
      .maybeSingle();

    if (blacklisted) {
      return {
        error: { server: ["This email address is not eligible for registration."] },
      };
    }

    // Pass the CAPTCHA token to Supabase - it will handle verification
    const signUpOptions: {
      email: string;
      password: string;
      options: {
        data: {
          full_name: string;
          username: string;
          created_at: string;
        };
        emailRedirectTo: string;
        captchaToken?: string;
      };
    } = {
      email: validatedFields.data.email,
      password: validatedFields.data.password,
      options: {
        data: {
          // Pass profile fields via user metadata; DB trigger will populate public.profiles
          full_name: validatedFields.data.fullName,
          username: `user_${randomUUID().slice(0, 8)}`,
          created_at: new Date().toISOString(),
        },
        emailRedirectTo: buildAuthConfirmRedirectUrl(origin, redirectUrl),
      },
    };

    if (turnstileToken) {
      signUpOptions.options.captchaToken = turnstileToken;
    }

    // 1. Create auth user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.signUp(signUpOptions);

    if (authError) {
      if (authError.message.includes("User already registered")) {
        return { error: { server: ["An account with this email already exists. Please log in."] } };
      }
      throw authError;
    }

    if (!user) {
      throw new Error("No user returned");
    }

    // Profile row will be created/updated by DB trigger using user metadata

    // Handle staff token - add user to organization as staff
    let inviteOutcome: StaffInviteOutcome | undefined;
    if (staffToken && orgUsername) {
      inviteOutcome = await applyStaffInviteForUser({
        userId: user.id,
        staffToken,
        orgUsername,
      });
    } else {
      // Check for auto-affiliation based on email domain
      try {
        await handleEmailDomainAffiliation(user.id, validatedFields.data.email);
      } catch (affiliationError) {
        console.error("Error processing email affiliation:", affiliationError);
        // Don't fail signup if affiliation processing fails
      }
    }

    return { 
      success: true, 
      email: validatedFields.data.email,
      message: "Successfully signed up! Please check your email (and junk folder) to confirm your account.",
      inviteOutcome,
    };
  } catch (error) {
    return { error: { server: [(error as Error).message] } };
  }
}

/**
 * Handle email domain affiliation - auto-add user to organization based on email domain
 * Returns the organization ID if the user was auto-added, null otherwise
 */
async function handleEmailDomainAffiliation(userId: string, email: string): Promise<string | null> {
  const adminClient = getAdminClient();
  
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  // Check if any organization has auto_join_domain set to this domain
  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, name")
    .eq("auto_join_domain", domain)
    .single();

  if (orgError || !org) {
    // No organization with this auto-join domain
    return null;
  }

  // Add user to the organization as a member
  const { error: memberError } = await adminClient
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: userId,
      role: "member",
      joined_at: new Date().toISOString(),
    });

  if (memberError) {
    // Skip if already a member (duplicate key)
    if (memberError.code !== "23505") {
      console.error(`Error adding user to org ${org.id}:`, memberError);
    }
    return null;
  }

  // Store the auto-joined organization info in user metadata for display after onboarding
  await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      auto_joined_org_id: org.id,
      auto_joined_org_name: org.name,
    }
  });

  console.log(`User ${userId} auto-affiliated with organization ${org.id} via domain ${domain}`);
  return org.id;
}

export async function resendVerificationEmail(
  email: string,
  turnstileToken?: string,
  redirectAfterAuth?: string | null,
) {
  try {
    const supabase = await createClient();
    const origin = getSiteUrl();
    
    const options: Record<string, string> = {
      emailRedirectTo: buildAuthConfirmRedirectUrl(origin, redirectAfterAuth),
    };

    if (turnstileToken) {
      options.captchaToken = turnstileToken;
    }

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options,
    });
    
    if (error) {
      console.error("Error resending verification email:", error);
      const message = error.message || "Failed to resend verification email";
      return { 
        success: false, 
        error: message,
        code: getResendErrorCode(message, error.status),
      };
    }
    
    return { 
      success: true, 
      message: "Verification email has been resent. Please check your inbox." 
    };
  } catch (error) {
    console.error("Exception in resendVerificationEmail:", error);
    const message = (error as Error).message || "An error occurred while resending the email";
    return { 
      success: false, 
      error: message,
      code: getResendErrorCode(message),
    };
  }
}

export async function signInWithGoogle(
  redirectAfterAuth?: string | null,
  inviteContext?: { staffToken?: string; orgUsername?: string } | null
) {
  const origin = getSiteUrl();

  const supabase = await createClient();
  
  // Build callback URL with query params for redirect and staff invite context
  let redirectTo = `${origin}/auth/callback`;
  const params = new URLSearchParams();
  
  if (redirectAfterAuth) {
    params.set('redirectAfterAuth', redirectAfterAuth);
  }
  
  if (inviteContext?.staffToken) {
    params.set('staffToken', inviteContext.staffToken);
  }
  
  if (inviteContext?.orgUsername) {
    params.set('orgUsername', inviteContext.orgUsername);
  }
  
  const queryString = params.toString();
  if (queryString) {
    redirectTo += `?${queryString}`;
  }

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
    console.error("Google OAuth error:", error);
    return { error: { server: [error.message] } };
  }
  
  return { url };
}
