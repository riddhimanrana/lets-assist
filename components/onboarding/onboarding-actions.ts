"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

// Schema for initial onboarding (username + phone only)
const initialOnboardingSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username cannot exceed 32 characters")
    .regex(
      /^[a-zA-Z0-9_.-]+$/,
      "Username can only contain letters, numbers, underscores, dots and hyphens",
    )
    .transform((val) => val.toLowerCase()),   // <-- force lowercase
  phoneNumber: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string()
      .optional()
  ),
});

export type InitialOnboardingValues = z.infer<typeof initialOnboardingSchema>;

export async function checkUsernameAvailability(username: string): Promise<{ available: boolean; error?: string }> {
  const supabase = await createClient();
  
  try {
    const { data: existingUser, error } = await supabase
      .from("profiles")
      .select("username")
      .eq("username", username)
      .maybeSingle();
    
    if (error) {
      console.error("Error checking username:", error);
      return { available: false, error: error.message };
    }
    
    return { available: !existingUser };
  } catch (e) {
    console.error("Unexpected error checking username:", e);
    return { available: false, error: "An unexpected error occurred while checking username" };
  }
}

export async function completeInitialOnboarding(
  username: string,
  phoneNumber?: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "User not authenticated" };
  }

  // Validate input
  const validatedFields = initialOnboardingSchema.safeParse({
    username,
    phoneNumber,
  });

  if (!validatedFields.success) {
    return { error: "Invalid input: " + validatedFields.error.errors[0].message };
  }

  const { username: validUsername, phoneNumber: validPhoneNumber } = validatedFields.data;

  try {
    // Check if username is unique
    const { available, error: uniqueError } = await checkUsernameAvailability(validUsername);
    if (uniqueError) {
      return { error: uniqueError };
    }
    if (!available) {
      return { error: "Username is already taken" };
    }

    // Build updateFields object
    const updateFields: {
      username?: string;
      phone?: string | null;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };

    if (validUsername !== undefined) updateFields.username = validUsername;
    // Always set phone, even if null, to clear it if needed
    if (validPhoneNumber !== undefined) updateFields.phone = validPhoneNumber;

    // Perform the update
    const { error: updateError } = await supabase
      .from("profiles")
      .update(updateFields)
      .eq("id", user.id);

    if (updateError) {
      console.log("Error updating profile:", updateError);
      return { error: "Failed to update profile" };
    }

    // Update user metadata to mark onboarding as complete
    const { error: authError } = await supabase.auth.updateUser({
      data: { 
        has_completed_onboarding: true,
        username: validUsername, // Also store in metadata for consistency
        phone: validPhoneNumber || null, // Store phone number in metadata
      },
    });

    if (authError) {
      console.error("Error updating user metadata:", authError);
      return { error: "Failed to update user metadata" };
    }

    return { success: true };
  } catch (e) {
    console.error("Unexpected error in completeInitialOnboarding:", e);
    return { error: "An unexpected error occurred" };
  }
}
