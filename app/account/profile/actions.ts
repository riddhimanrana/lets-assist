"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const onboardingSchema = z.object({
  fullName: z
    .string()
    .min(3, "Full name must be at least 3 characters")
    .optional(),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .optional(),
  avatarUrl: z.string().optional(), // Changed to accept string instead of File
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;

  const validatedFields = onboardingSchema.safeParse({
    fullName: formData.get("fullName") || undefined,
    username: formData.get("username") || undefined,
    avatarUrl: formData.get("avatarUrl") || undefined,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const { fullName, username, avatarUrl } = validatedFields.data;

  // Create an update object with only provided fields
  const updateFields: {
    full_name?: string;
    username?: string;
    avatar_url?: string;
    updated_at?: string;
  } = {};
  if (fullName) updateFields.full_name = fullName;
  if (username) updateFields.username = username;

  if (avatarUrl) {
    // If uploading a new image
    if (avatarUrl.startsWith("data:image")) {
      // First, get the current avatar URL to check if we need to delete an old image
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", userId)
        .single();

      // Delete old image if it exists and is from Supabase storage
      if (profile?.avatar_url?.includes("supabase.co")) { // note: when and if i use a custom supabase domain we need to change this
        try {
          const urlParts = new URL(profile.avatar_url);
          const pathParts = urlParts.pathname.split("/");
          const oldFileName = pathParts[pathParts.length - 1];

          if (oldFileName) {
            await supabase.storage.from("avatars").remove([oldFileName]);
          }
        } catch (error) {
          console.error("Error deleting old avatar:", error);
          // Continue with upload even if delete fails
        }
      }

      // Handle base64 image upload
      const base64Str = avatarUrl.split(",")[1];
      const buffer = Buffer.from(base64Str, "base64");
      const fileName = `${userId}-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, buffer, {
          contentType: "image/jpeg",
          upsert: false,
          cacheControl: "0",
        });

      if (uploadError) {
        console.log(uploadError);
        return { error: { avatarUrl: ["Failed to upload avatar"] } };
      }

      const { data: publicUrlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      const timestamp = Date.now();
      updateFields.avatar_url = `${publicUrlData.publicUrl}?v=${timestamp}`;
    }
  }

  updateFields.updated_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("profiles")
    .update(updateFields)
    .eq("id", userId);

  if (updateError) {
    console.log(updateError);
    return { error: { server: ["Failed to update profile"] } };
  }
  return { success: true };
}

export async function checkUsernameUnique(username: string) {
  const supabase = await createClient();
  const { data: existingUser, error } = await supabase
    .from("profiles")
    .select("username")
    .eq("username", username)
    .maybeSingle();
  if (error) {
    return { available: false, error: error.message };
  }
  return { available: !existingUser };
}

export async function removeProfilePicture() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: { server: ["Not authenticated"] } };
  }

  // Get the current avatar URL to extract filename
  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .single();

  if (profile?.avatar_url && profile.avatar_url.includes("supabase.co")) { // note: when and if i use a custom supabase domain we need to change this
    try {
      // Extract filename from the full URL
      const urlParts = new URL(profile.avatar_url);
      const pathParts = urlParts.pathname.split("/");
      const fileName = pathParts[pathParts.length - 1];

      if (fileName) {
        // Delete the file from storage
        const { error: deleteError } = await supabase.storage
          .from("avatars")
          .remove([fileName]);
        if (deleteError) {
          console.error(
            "removeProfilePicture: Error deleting file:",
            deleteError,
          );
          return { error: { server: ["Failed to delete avatar file"] } };
        }
      }
    } catch (error) {
      console.error("removeProfilePicture: Error parsing avatar URL:", error);
      return { error: { server: ["Failed to delete avatar file"] } };
    }
  }

  // Update profile to remove avatar_url
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      avatar_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (updateError) {
    console.error("removeProfilePicture: Error updating profile:", updateError);
    return { error: { server: ["Failed to update profile"] } };
  }

  return { success: true };
}
