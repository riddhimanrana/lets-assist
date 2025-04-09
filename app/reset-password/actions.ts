"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ErrorResponse = {
  server?: string[];
  email?: string[];
};

export async function requestPasswordReset(formData: FormData) {
  const validatedFields = resetPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors as ErrorResponse };
  }

  const supabase = await createClient();

  try {
    // Send password reset email
    const { error } = await supabase.auth.resetPasswordForEmail(
      validatedFields.data.email,
      {
        // Redirect to auth callback which will handle verification and token exchange
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?type=recovery`,
      }
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
