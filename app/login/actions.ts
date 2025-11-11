"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { verifyTurnstileToken, isTurnstileEnabled } from "@/lib/turnstile";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().optional(),
});

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

export async function login(formData: FormData) {
  const supabase = await createClient();
  const turnstileToken = formData.get("turnstileToken") as string;

  const validatedFields = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  // Pass the CAPTCHA token to Supabase - it will handle verification
  const signInOptions: any = {
    email: validatedFields.data.email,
    password: validatedFields.data.password,
  };

  if (turnstileToken) {
    signInOptions.options = { captchaToken: turnstileToken };
  }

  const { data, error } = await supabase.auth.signInWithPassword(signInOptions);

  if (error) {
    return { error: { server: [error.message] } };
  }

  // Revalidate all routes to clear cached auth state
  revalidatePath("/", "layout");

  // Return the session so LoginClient can immediately use it
  // This is the critical fix - the server action returns the authenticated user
  return { 
    success: true, 
    session: data.session 
  };
}
