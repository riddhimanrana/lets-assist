"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { verifyTurnstileToken, isTurnstileEnabled } from "@/lib/turnstile";

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

  try {
    // Pass the CAPTCHA token to Supabase - it will handle verification
    const signUpOptions: any = {
      email: validatedFields.data.email,
      password: validatedFields.data.password,
      options: {
        data: {
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
      if (authError.code === "23503") {
        return { error: { server: ["ACCEXISTS0"] } };
      }
      if (authError.code === "23505") {
        return { error: { server: ["NOCNFRM0"] } };
      }
      throw authError;
    }

    if (!user) {
      throw new Error("No user returned");
    }

    // 2. Create matching profile with full name
    const { error: profileError } = await supabase.from("profiles").insert({
      id: user.id,
      full_name: validatedFields.data.fullName,
      username: `user_${user.id?.slice(0, 8)}`, // --- Changed: default username
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (profileError) {
      if (profileError.code === "23503") {
        return { error: { server: ["ACCEXISTS0"] } };
      }
      if (profileError.code === "23505") {
        return { error: { server: ["NOCNFRM0"] } };
      }
      throw profileError;
    }

    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes("23503")) {
      return { error: { server: ["ACCEXISTS0"] } };
    }
    if (error instanceof Error && error.message.includes("23505")) {
      return { error: { server: ["NOCNFRM0"] } };
    }
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
