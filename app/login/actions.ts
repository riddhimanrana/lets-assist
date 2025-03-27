"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
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

  const validatedFields = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const { error } = await supabase.auth.signInWithPassword(
    validatedFields.data,
  );

  if (error) {
    return { error: { server: [error.message] } };
  }

  return { success: true };
}
