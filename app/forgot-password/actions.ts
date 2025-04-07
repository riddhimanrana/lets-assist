"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export async function requestPasswordReset(formData: FormData) {
  const validatedFields = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(
      validatedFields.data.email,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
      }
    );

    if (error) {
      return { error: { server: [error.message] } };
    }

    return { success: true };
  } catch (error) {
    return { error: { server: [(error as Error).message] } };
  }
}
