"use server";

import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { calculateAge, isUnder13 } from "@/utils/age-helpers";
import { ProfileVisibility } from "@/types";
import {
  applyVisibilityConstraints,
  canChangeProfileVisibility,
  getDefaultProfileVisibility,
  isInstitutionEmail,
} from "@/utils/settings/profile-settings";

const onboardingSchema = z.object({
  fullName: z
    .string()
    .min(3, "Full name must be at least 3 characters")
    .optional(),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .optional(),
  avatarUrl: z.union([z.string(), z.null()]).optional(),
  phoneNumber: z.string().optional(), // Add phoneNumber here
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;

// Add a new schema specifically for profile text fields
const profileInfoSchema = z.object({
  fullName: z
    .string()
    .min(3, "Full name must be at least 3 characters")
    .optional(),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .optional(),
});

export type ProfileInfoValues = z.infer<typeof profileInfoSchema>;

// New function specifically for updating profile text info (not avatar)
export async function updateProfileInfo(formData: FormData) {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;

  // Get form values
  const fullName = formData.get("fullName")?.toString() || undefined;
  const username = formData.get("username")?.toString() || undefined;

  const validatedFields = profileInfoSchema.safeParse({
    fullName,
    username,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const { fullName: validFullName, username: validUsername } = validatedFields.data;

  // Create an update object with only provided fields
  const updateFields: {
    full_name?: string;
    username?: string;
    updated_at: string;
  } = {
    updated_at: new Date().toISOString(),
  };
  
  if (validFullName !== undefined) updateFields.full_name = validFullName;
  if (validUsername !== undefined) updateFields.username = validUsername;

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

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;

  // Get form values, ensuring undefined for missing fields
  const fullName = formData.get("fullName")?.toString() || undefined;
  const username = formData.get("username")?.toString() || undefined;
  
  // Only process avatarUrl if it's explicitly included in the form
  const avatarUrlValue = formData.get("avatarUrl");
  const avatarUrl = avatarUrlValue !== null ? avatarUrlValue.toString() || null : undefined;

  const validatedFields = onboardingSchema.safeParse({
    fullName,
    username,
    avatarUrl,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const { fullName: validFullName, username: validUsername, avatarUrl: validAvatarUrl } = validatedFields.data;

  // Create an update object with only provided fields
  const updateFields: {
    full_name?: string;
    username?: string;
    avatar_url?: string | null;
    updated_at?: string;
  } = {};
  
  if (validFullName !== undefined) updateFields.full_name = validFullName;
  if (validUsername !== undefined) updateFields.username = validUsername;

  // Only process avatarUrl if it was explicitly included in the form data
  if (avatarUrlValue !== null && validAvatarUrl !== undefined) {
    // Process avatar URL only if explicitly included in the form
    if (validAvatarUrl && typeof validAvatarUrl === 'string' && validAvatarUrl.startsWith("data:image")) {
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
      const base64Str = validAvatarUrl.split(",")[1];
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
    } else {
      // If avatarUrl was included but null or empty, set avatar_url to null
      updateFields.avatar_url = null;
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

// Extremely simple function with no avatar handling at all
export async function updateNameAndUsername(fullName?: string, username?: string, phoneNumber?: string) { // Add phoneNumber parameter
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id;

  if (!userId) {
    return { error: { server: ["Not authenticated"] } };
  }

  // Simple validation without using Zod
  if (fullName && fullName.length < 3) {
    return { error: { fullName: ["Full name must be at least 3 characters"] } };
  }
  
  if (username && username.length < 3) {
    return { error: { username: ["Username must be at least 3 characters"] } };
  }

  if (phoneNumber && phoneNumber.length !== 10) {
      return { error: { phoneNumber: ["Phone number must be exactly 10 digits"] } };
  }

  // Create a simple update object
  const updateFields: {
    full_name?: string;
    username?: string;
    phone?: string; // Add phone number field
    updated_at: string;
  } = {
    updated_at: new Date().toISOString(),
  };
  
  if (fullName !== undefined) updateFields.full_name = fullName;
  if (username !== undefined) updateFields.username = username;
  // Add phone number only if it's provided (it's optional)
  if (phoneNumber !== undefined) updateFields.phone = phoneNumber;


  // Perform the update
  const { error: updateError } = await supabase
    .from("profiles")
    .update(updateFields)
    .eq("id", userId);

  if (updateError) {
    console.log(updateError);
    // Check for unique constraint violation on username
    if (updateError.code === '23505' && updateError.message.includes('profiles_username_key')) {
      return { error: { username: ["Username already taken"] } };
    }
    return { error: { server: ["Failed to update profile"] } };
  }
  
  return { success: true };
}

export async function updateProfileVisibility(
  visibility: ProfileVisibility,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: { server: ["Not authenticated"] } };
  }

  if (!(["public", "private"] as ProfileVisibility[]).includes(visibility)) {
    return { error: { visibility: ["Invalid visibility setting"] } };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("date_of_birth")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error("updateProfileVisibility: failed to load profile", profileError);
    return { error: { server: ["Could not verify profile details"] } };
  }

  const dateOfBirth: string | null = profile?.date_of_birth ?? null;
  const canChange = canChangeProfileVisibility(dateOfBirth);
  const enforcedVisibility = applyVisibilityConstraints(visibility, dateOfBirth);

  if (enforcedVisibility !== visibility) {
    return {
      error: {
        visibility: [
          "Users under 13 must keep their profile private for safety.",
        ],
      },
      enforcedVisibility,
      canChangeVisibility: canChange,
    };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      profile_visibility: enforcedVisibility,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("updateProfileVisibility: failed to update profile", updateError);
    return { error: { server: ["Failed to update profile visibility"] } };
  }

  return {
    success: true,
    visibility: enforcedVisibility,
    canChangeVisibility: canChange,
  };
}

export async function updateDateOfBirth(dateOfBirth: string) {
  const normalizedDob = dateOfBirth?.trim();

  if (!normalizedDob) {
    return { error: { dateOfBirth: ["Date of birth is required"] } };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDob)) {
    return { error: { dateOfBirth: ["Use YYYY-MM-DD format"] } };
  }

  const parsedDob = new Date(normalizedDob);
  if (Number.isNaN(parsedDob.getTime())) {
    return { error: { dateOfBirth: ["Select a valid date"] } };
  }

  const todayIso = new Date().toISOString().split("T")[0];
  if (normalizedDob > todayIso) {
    return { error: { dateOfBirth: ["Date of birth cannot be in the future"] } };
  }

  const age = calculateAge(normalizedDob);
  if (age < 5 || age > 120) {
    return { error: { dateOfBirth: ["Enter a valid date of birth"] } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: { server: ["Not authenticated"] } };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email, is_school_account, profile_visibility")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error("updateDateOfBirth: failed to load profile", profileError);
    return { error: { server: ["Could not verify profile details"] } };
  }

  const email = profile?.email ?? user.email ?? "";
  const existingVisibility =
    (profile?.profile_visibility as ProfileVisibility) ?? "public";

  const institutionFlag =
    typeof profile?.is_school_account === "boolean"
      ? profile.is_school_account
      : email
        ? await isInstitutionEmail(email)
        : false;

  const defaultVisibility = getDefaultProfileVisibility(
    normalizedDob,
    institutionFlag,
  );

  const desiredVisibility:
    | ProfileVisibility
    | undefined = (["public", "private"] as ProfileVisibility[]).includes(
    existingVisibility,
  )
    ? existingVisibility
    : defaultVisibility;

  const enforcedVisibility = applyVisibilityConstraints(
    desiredVisibility,
    normalizedDob,
  );

  const requiresParentalConsent = isUnder13(normalizedDob);
  const canChange = canChangeProfileVisibility(normalizedDob);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      date_of_birth: normalizedDob,
      profile_visibility: enforcedVisibility,
      parental_consent_required: requiresParentalConsent,
      parental_consent_verified: !requiresParentalConsent,
      age_verified_at: new Date().toISOString(),
      is_school_account: institutionFlag,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("updateDateOfBirth: failed to update profile", updateError);
    return { error: { server: ["Failed to update date of birth"] } };
  }

  return {
    success: true,
    visibility: enforcedVisibility,
    requiresParentalConsent,
    canChangeVisibility: canChange,
    age,
    isSchoolAccount: institutionFlag,
  };
}
