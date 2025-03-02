"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signup(formData: FormData) {
  const validatedFields = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  try {
    // 1. Create auth user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.signUp({
      email: validatedFields.data.email,
      password: validatedFields.data.password,
      options: {
        data: {
          created_at: new Date().toISOString(),
        },
      },
    });

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

export async function signInWithGoogle() {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "";

  const supabase = await createClient();

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
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    console.error("Google OAuth error:", error);
    return { error: { server: [error.message] } };
  }

  return { url };
}
