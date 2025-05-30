"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { verifyTurnstileToken, isTurnstileEnabled } from "@/lib/turnstile";

const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  turnstileToken: z.string().optional(),
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
    return { error: validatedFields.error.flatten().fieldErrors as ErrorResponse };
  }

  const supabase = await createClient();

  try {
    // Pass the CAPTCHA token to Supabase - it will handle verification
    const resetOptions: any = {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?type=recovery`,
    };

    if (turnstileToken) {
      resetOptions.captchaToken = turnstileToken;
    }

    // Send password reset email
    const { error } = await supabase.auth.resetPasswordForEmail(
      validatedFields.data.email,
      resetOptions
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
