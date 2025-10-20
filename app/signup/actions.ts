"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyTurnstileToken, isTurnstileEnabled } from "@/lib/turnstile";
import { randomUUID } from "crypto";

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  turnstileToken: z.string().optional(),
});

export async function signup(formData: FormData) {
  const turnstileToken = formData.get("turnstileToken") as string;

  const validatedFields = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const supabaseAdmin = createAdminClient();

  try {
    // Check if user already exists
    const { data: { users }, error: listUsersError } = await supabaseAdmin.auth.admin.listUsers({ email: validatedFields.data.email });

    if (listUsersError) {
      throw listUsersError;
    }

    if (users && users.length > 0) {
      const existingUser = users[0];
      if (existingUser.email_confirmed_at) {
        return { error: { server: ["An account with this email already exists. Please log in."] } };
      } else {
        // User exists but is not confirmed, resend confirmation email
        await supabase.auth.resend({ type: 'signup', email: validatedFields.data.email });
        return { success: true, message: "You have already signed up but not confirmed your email. We have sent you a new confirmation link. Please check your inbox (and junk folder)." };
      }
    }

    // Pass the CAPTCHA token to Supabase - it will handle verification
    const signUpOptions: any = {
      email: validatedFields.data.email,
      password: validatedFields.data.password,
      options: {
        data: {
          // Pass profile fields via user metadata; DB trigger will populate public.profiles
          full_name: validatedFields.data.fullName,
          username: `user_${randomUUID().slice(0, 8)}`,
          created_at: new Date().toISOString(),
        },
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
      throw authError;
    }

    if (!user) {
      throw new Error("No user returned");
    }

    // Profile row will be created/updated by DB trigger using user metadata

    return { success: true, message: "Successfully signed up! Please check your email (and junk folder) to confirm your account." };
  } catch (error) {
    return { error: { server: [(error as Error).message] } };
  }
}

export async function signInWithGoogle(redirectAfterAuth?: string | null) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "";

  const supabase = await createClient();
  
  // Store the redirect URL in the session storage via a search parameter
  // This will be picked up in the auth callback and stored in session storage
  let redirectTo = `${origin}/auth/callback`;
  
  if (redirectAfterAuth) {
    redirectTo += `?redirectAfterAuth=${encodeURIComponent(redirectAfterAuth)}`;
  }

  const {
    data: { url },
    error,
  } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: {
        access_type: "offline",
        prompt: "consent",
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
