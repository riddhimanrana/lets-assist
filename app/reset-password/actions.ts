"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveConfiguredSiteOrigin } from "@/app/signup/request-origin";

const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  turnstileToken: z.string().nullish(),
});

type ErrorResponse = {
  server?: string[];
  email?: string[];
};

export async function requestPasswordReset(formData: FormData) {
  const turnstileToken = formData.get("turnstileToken") as string;

  const validatedFields = resetPasswordSchema.safeParse({
    email: formData.get("email"),
    turnstileToken,
  });

  if (!validatedFields.success) {
    return {
      error: validatedFields.error.flatten().fieldErrors as ErrorResponse,
    };
  }

  const supabase = await createClient();

  try {
    // Pass the CAPTCHA token to Supabase - it will handle verification
    // Read through the validated resolver, not `process.env` directly: an
    // unset `NEXT_PUBLIC_SITE_URL` used to interpolate the literal string
    // "undefined" into the recovery link, mailing every user a dead reset
    // URL, and a malformed one would have been pasted in unchanged.
    const resetOptions: { redirectTo: string; captchaToken?: string } = {
      redirectTo: `${resolveConfiguredSiteOrigin()}/auth/callback?type=recovery`,
    };

    if (turnstileToken) {
      resetOptions.captchaToken = turnstileToken;
    }

    // Send password reset email
    const { error } = await supabase.auth.resetPasswordForEmail(
      validatedFields.data.email,
      resetOptions,
    );

    if (error) {
      // Don't expose if email exists or not for security
      // Just return success even if email doesn't exist
      console.error("Password reset error:", error);
    }

    // Always return success to not leak email existence
    return { success: true };
  } catch (error) {
    console.error("Password reset error:", error);
    // Still return success to not leak email existence
    return { success: true };
  }
}
