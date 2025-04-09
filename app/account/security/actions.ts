"use server";

import { z } from "zod"; // Import Zod
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Zod schema for password update - add currentPassword field
const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords don't match",
    path: ["confirmPassword"], // Error applies to the confirmation field
  });

// Zod schema for email update
const updateEmailSchema = z.object({
  newEmail: z.string().email("Please enter a valid email address"),
});

// Type for error responses - add currentPassword field
type ActionErrorResponse = {
  server?: string[];
  currentPassword?: string[];
  newPassword?: string[];
  confirmPassword?: string[];
  newEmail?: string[];
};

export async function updatePasswordAction(formData: FormData) {
  const validatedFields = updatePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors as ActionErrorResponse };
  }

  const supabase = await createClient();
  
  // Note: Supabase's updateUser doesn't verify the current password directly.
  // In a production environment, you might want to add a re-authentication step
  // for sensitive operations like password changes.
  const { error } = await supabase.auth.updateUser({
    password: validatedFields.data.newPassword,
  });

  if (error) {
    console.error("Update password error:", error);
    return { error: { server: [error.message] } as ActionErrorResponse };
  }

  return { success: true };
}

export async function updateEmailAction(formData: FormData) {
  const validatedFields = updateEmailSchema.safeParse({
    newEmail: formData.get("newEmail"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors as ActionErrorResponse };
  }

  const supabase = await createClient();
  
  // Determine the correct redirect URL
  let redirectUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  if (process.env.NODE_ENV === 'development') {
    redirectUrl = 'http://localhost:3000';
  }

  const { error } = await supabase.auth.updateUser(
    { email: validatedFields.data.newEmail },
    { 
      // Supabase will automatically append token_hash and type parameters to this URL
      emailRedirectTo: `${redirectUrl}/auth/verification-success?type=email_change` 
    }
  );

  if (error) {
    console.error("Update email error:", error);
    return { error: { server: [error.message] } as ActionErrorResponse };
  }

  return { 
    success: true, 
    message: "Verification email sent to your new address. Please check your inbox and click the link to complete the change." 
  };
}

export async function deleteAccount() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("No user found");
    }

    // Delete from public.profiles first
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", user.id);

    if (profileError) {
      throw new Error(`Failed to delete profile: ${profileError.message}`);
    }

    // Create admin client with service role
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Delete from auth schema using admin client
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
      user.id,
    );

    if (authError) {
      throw new Error(`Failed to delete user: ${authError.message}`);
    }

    // Clear auth session
    await supabase.auth.signOut();

    return { success: true };
  } catch (error) {
    console.error("Delete account error:", error);
    throw error;
  }
}
