"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  token: z.string().min(1, "Reset token is required"),
});

type ErrorResponse = {
  server?: string[];
  password?: string[];
};

export async function updatePassword(formData: FormData) {
  const validatedFields = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    token: formData.get("token"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors as ErrorResponse };
  }

  const supabase = await createClient();

  try {
    // First exchange the code for a session
    const { data: sessionData, error: sessionError } = await supabase.auth
      .exchangeCodeForSession(validatedFields.data.token);

    if (sessionError) {
      return {
        error: {
          server: ["Invalid or expired reset link. Please request a new password reset."]
        } as ErrorResponse
      };
    }

    // Use the session to update the password
    const { error: updateError } = await supabase.auth.updateUser({
      password: validatedFields.data.password
    });

    if (updateError) {
      return {
        error: {
          server: [updateError.message]
        } as ErrorResponse
      };
    }

    // Ensure user is logged out after password reset
    await supabase.auth.signOut();

    return { success: true };
  } catch (error) {
    return {
      error: {
        server: [(error as Error).message]
      } as ErrorResponse
    };
  }
}
