"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function resetPassword(formData: FormData) {
  const validatedFields = resetPasswordSchema.safeParse({
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.updateUser({
      password: validatedFields.data.password,
    });

    if (error) {
      return { error: { server: [error.message] } };
    }

    return { success: true };
  } catch (error) {
    return { error: { server: [(error as Error).message] } };
  }
}
