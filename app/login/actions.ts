"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { applyStaffInviteForUser } from "@/lib/organization/staff-invite";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().nullish(),
});

export async function signInWithGoogle(
  redirectAfterAuth?: string | null,
  inviteContext?: { staffToken?: string; orgUsername?: string } | null,
) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "";
  const supabase = await createClient();
  
  let redirectTo = `${origin}/auth/callback`;
  const params = new URLSearchParams();
  
  if (redirectAfterAuth) {
    params.set("redirectAfterAuth", redirectAfterAuth);
  }

  if (inviteContext?.staffToken) {
    params.set("staffToken", inviteContext.staffToken);
  }

  if (inviteContext?.orgUsername) {
    params.set("orgUsername", inviteContext.orgUsername);
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

export async function applyStaffInviteForCurrentUser(
  staffToken?: string | null,
  orgUsername?: string | null,
) {
  if (!staffToken || !orgUsername) {
    return { inviteOutcome: null };
  }

  const { user, error } = await getAuthUser({ allowMfaPending: true });
  if (error || !user) {
    return {
      inviteOutcome: { status: "error" as const, orgUsername },
      error: error?.message ?? "Not authenticated",
    };
  }

  const inviteOutcome = await applyStaffInviteForUser({
    userId: user.id,
    staffToken,
    orgUsername,
  });

  return { inviteOutcome };
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
  const signInOptions: {
    email: string;
    password: string;
    options?: { captchaToken: string };
  } = {
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
