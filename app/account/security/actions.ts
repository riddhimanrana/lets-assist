"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { deleteUserWithCleanup } from "@/lib/supabase/delete-user-with-cleanup";
import { getAuthUser } from "@/lib/supabase/auth-helpers";

// Zod schema for password update (for users with existing password)
const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords don't match",
    path: ["confirmPassword"],
  });

// Zod schema for setting password (for OAuth-only users)
const setPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
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

  // Use getAuthUser with sensitive: true for password changes
  const { user, error: authError } = await getAuthUser({ sensitive: true });

  if (authError || !user || !user.email) {
    return { error: { server: ["Not authenticated"] } as ActionErrorResponse };
  }

  const supabase = await createClient();

  // Verify current password by attempting sign in
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

  // Update to new password
  const { error: updateError } = await supabase.auth.updateUser({
    password: validatedFields.data.newPassword,
  });

  if (updateError) {
    console.error("Update password error:", updateError);
    return { error: { server: [updateError.message] } as ActionErrorResponse };
  }

  // Explicitly refresh session to ensure it persists
  const { error: refreshError } = await supabase.auth.refreshSession();

  if (refreshError) {
    console.error("Session refresh error:", refreshError);
    // Don't fail the update, session will refresh naturally
  }

  return { success: true };
}

export async function setPasswordAction(formData: FormData) {
  const validatedFields = setPasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors as ActionErrorResponse };
  }

  // Use getAuthUser with sensitive: true for password changes
  const { user, error: authError } = await getAuthUser({ sensitive: true });

  if (authError || !user) {
    return { error: { server: ["Not authenticated"] } as ActionErrorResponse };
  }

  const supabase = await createClient();

  // OAuth users can set password directly (no current password verification needed)
  const { error: updateError } = await supabase.auth.updateUser({
    password: validatedFields.data.newPassword,
  });

  if (updateError) {
    console.error("Set password error:", updateError);
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

  // Use getAuthUser with sensitive: true for email changes
  const { user, error: authError } = await getAuthUser({ sensitive: true });

  if (authError || !user) {
    return { error: { server: ["Not authenticated"] } as ActionErrorResponse };
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
      emailRedirectTo: `${redirectUrl.replace(/\/$/, "")}/auth/confirm?type=email_change`
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
    // Use getAuthUser with sensitive: true for account deletion
    const { user, error: authError } = await getAuthUser({ sensitive: true });

    if (authError || !user) {
      throw new Error("Not authenticated");
    }

    // Use centralized admin client
    const supabaseAdmin = getAdminClient();

    const report = await deleteUserWithCleanup(supabaseAdmin, user.id, {
      deleteProjects: true,
      deleteOrganizations: false,
    });

    if (report.blockedBySoleAdminOrgs.length > 0) {
      const orgs = report.blockedBySoleAdminOrgs
        .map((org) => org.organization_name ?? org.organization_id)
        .join(", ");
      throw new Error(`Cannot delete account until another admin is added to: ${orgs}`);
    }

    const supabase = await createClient();
    await supabase.auth.signOut();

    return { success: true };
  } catch (error) {
    console.error("Delete account error:", error);
    throw error;
  }
}
