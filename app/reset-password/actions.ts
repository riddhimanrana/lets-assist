"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { runOnCanonicalAuthOrigin } from "@/app/signup/canonical-auth-request";

const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  turnstileToken: z.string().nullish(),
});

type ErrorResponse = {
  server?: string[];
  email?: string[];
};

type ResetPasswordResult =
  { success: true; error?: never } | { success?: never; error: ErrorResponse };

export async function requestPasswordReset(
  formData: FormData,
): Promise<ResetPasswordResult> {
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

  return runOnCanonicalAuthOrigin("/reset-password", async (origin) => {
    const supabase = await createClient();

    try {
      const resetOptions: { redirectTo: string; captchaToken?: string } = {
        redirectTo: `${origin}/auth/callback?type=recovery`,
      };

      if (turnstileToken) {
        resetOptions.captchaToken = turnstileToken;
      }

      // Send password reset email. Provider and user-existence errors are
      // intentionally swallowed here to prevent email enumeration.
      const { error } = await supabase.auth.resetPasswordForEmail(
        validatedFields.data.email,
        resetOptions,
      );

      if (error) {
        console.error("Password reset error:", error);
      }

      return { success: true };
    } catch (error) {
      // Network or unexpected runtime errors: still return success to avoid
      // leaking whether the email address exists, but log the real cause.
      console.error("Password reset error:", error);
      return { success: true };
    }
  });
}
