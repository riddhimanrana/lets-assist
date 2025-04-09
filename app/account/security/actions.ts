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

// Zod schema for email update - include confirmEmail field
const updateEmailSchema = z.object({
  newEmail: z
    .string()
    .min(1, "Email is required")
    .email("Must be a valid email address")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Must be a valid email format")
    .refine((email) => email.includes("@"), "Email must contain @ symbol"),
  confirmEmail: z
    .string()
    .min(1, "Please confirm your email")
    .email("Must be a valid email address")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Must be a valid email format"),
}).refine((data) => data.newEmail === data.confirmEmail, {
  message: "Email addresses don't match",
  path: ["confirmEmail"],
});

// Type for error responses - add currentPassword field
type ActionErrorResponse = {
  server?: string[];
  currentPassword?: string[];
  newPassword?: string[];
  confirmPassword?: string[];
  newEmail?: string[];
  confirmEmail?: string[];
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
  
  // Get current user's email
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return { error: { server: ["User not found"] } as ActionErrorResponse };
  }

  // First verify the current password by attempting to sign in
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: validatedFields.data.currentPassword,
  });

  if (signInError) {
    return { 
      error: { 
        currentPassword: ["Current password is incorrect"] 
      } as ActionErrorResponse 
    };
  }

  // If current password is verified, proceed with password update
  const { error: updateError } = await supabase.auth.updateUser({
    password: validatedFields.data.newPassword,
  });

  if (updateError) {
    console.error("Update password error:", updateError);
    return { error: { server: [updateError.message] } as ActionErrorResponse };
  }

  return { success: true };
}

export async function updateEmailAction(formData: FormData) {
  const validatedFields = updateEmailSchema.safeParse({
    newEmail: formData.get("newEmail"),
    confirmEmail: formData.get("confirmEmail"),
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
