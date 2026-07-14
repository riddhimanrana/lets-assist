"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";
import { buildAuthConfirmRedirectUrl, normalizeRedirectPath } from "./redirect-utils";
import { passwordSchema } from "@/lib/auth/password-policy";

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  password: passwordSchema,
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
    phone: formData.get("phone"),
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
          phone?: string;
          created_at: string;
          pending_staff_token?: string;
          pending_staff_org_username?: string;
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
          phone: validatedFields.data.phone,
          username: `user_${randomUUID().slice(0, 8)}`,
          created_at: new Date().toISOString(),
          ...(validatedFields.data.staffToken && validatedFields.data.orgUsername
            ? {
                pending_staff_token: validatedFields.data.staffToken,
                pending_staff_org_username: validatedFields.data.orgUsername,
              }
            : {}),
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
        return {
          success: true,
          email: validatedFields.data.email,
          message: "If this address can be registered, a confirmation email is on its way. Otherwise, sign in or request another verification email.",
        };
      }
      throw authError;
    }

    if (!user) {
      throw new Error("No user returned");
    }

    // With email confirmation enabled, Supabase deliberately returns an
    // obfuscated user with no identities for an existing address. Stop before
    // any service-role profile, invite, or organization side effects and keep
    // the public response indistinguishable from a new signup.
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      return {
        success: true,
        email: validatedFields.data.email,
        message: "If this address can be registered, a confirmation email is on its way. Otherwise, sign in or request another verification email.",
      };
    }

    const profileEmail = user.email || validatedFields.data.email;
    const profileFullName = validatedFields.data.fullName.trim() || null;
    const profilePhone = validatedFields.data.phone?.trim() || null;

    const { error: profileUpsertError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: profileEmail,
          full_name: profileFullName,
          phone: profilePhone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    if (profileUpsertError) {
      console.warn("Profile upsert after signup failed:", profileUpsertError.message);
    }

    // Profile row will be created/updated by DB trigger using user metadata

    return { 
      success: true, 
      email: validatedFields.data.email,
      message: "If this address can be registered, a confirmation email is on its way. Otherwise, sign in or request another verification email.",
    };
  } catch (error) {
    return { error: { server: [(error as Error).message] } };
  }
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
