"use server";

import { z } from "zod";
import { preparePublicImage } from "@/lib/storage/public-image";
import {
  replacePublicImage,
  type ImageReferenceCommit,
} from "@/lib/storage/replace-public-image";

import { createClient } from "@/lib/supabase/server";
import { checkOffensiveLanguage } from "@/utils/moderation-helpers";
import { ProfileVisibility } from "@/types";
import {
  applyVisibilityConstraints,
  canChangeProfileVisibility,
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

async function ensureProfileExists() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null as null };
  }

  const fallbackUsername =
    user.user_metadata?.username ||
    user.email
      ?.split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9_]/g, "-") ||
    null;

  const fallbackFullName =
    user.user_metadata?.full_name || user.user_metadata?.name || null;

  await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      username: fallbackUsername,
      full_name: fallbackFullName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  return { supabase, user };
}

// New function specifically for updating profile text info (not avatar)
export async function updateProfileInfo(formData: FormData) {
  const { supabase, user } = await ensureProfileExists();
  const userId = user?.id;

  if (!userId) {
    return { error: { server: ["Not authenticated"] } };
  }

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

  const { fullName: validFullName, username: validUsername } =
    validatedFields.data;

  // Normalize and validate username uniqueness if provided
  if (validUsername) {
    const normalizedUsername = validUsername.trim().toLowerCase();

    // Check for profanity in username
    const profanity = await checkOffensiveLanguage(normalizedUsername);
    if (profanity.isProfane) {
      return {
        error: { username: [profanity.error || "Inappropriate language"] },
      };
    }

    // Check for uniqueness (excluding current user's existing username)
    const uniquenessCheck = await checkUsernameUnique(normalizedUsername);
    if (!uniquenessCheck.available) {
      return { error: { username: ["This username is already taken"] } };
    }

    // Create an update object with normalized username
    const updateFields: {
      full_name?: string;
      username?: string;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
      username: normalizedUsername,
    };

    if (validFullName !== undefined) updateFields.full_name = validFullName;

    const { error: updateError } = (await supabase
      .from("profiles")
      .update(updateFields)
      .eq("id", userId)) as { error: { message?: string } | null };

    if (updateError) {
      console.log(updateError);
      return { error: { server: ["Failed to update profile"] } };
    }
  } else {
    // Only update full name if no username is being updated
    const updateFields: {
      full_name?: string;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };

    if (validFullName !== undefined) updateFields.full_name = validFullName;

    const { error: updateError } = (await supabase
      .from("profiles")
      .update(updateFields)
      .eq("id", userId)) as { error: { message?: string } | null };

    if (updateError) {
      console.log(updateError);
      return { error: { server: ["Failed to update profile"] } };
    }
  }

  return { success: true };
}

export async function completeOnboarding(formData: FormData) {
  const { supabase, user } = await ensureProfileExists();
  const userError = user ? null : new Error("Not authenticated");

  if (userError || !user) {
    return { error: { server: ["Not authenticated"] } };
  }

  const userId = user.id;

  // Get form values, ensuring undefined for missing fields
  const fullName = formData.get("fullName")?.toString() || undefined;
  const username = formData.get("username")?.toString() || undefined;

  // Only process avatarUrl if it's explicitly included in the form
  const avatarUrlValue = formData.get("avatarUrl");
  const avatarUrl =
    avatarUrlValue !== null ? avatarUrlValue.toString() || null : undefined;

  const validatedFields = onboardingSchema.safeParse({
    fullName,
    username,
    avatarUrl,
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors };
  }

  const {
    fullName: validFullName,
    username: validUsername,
    avatarUrl: validAvatarUrl,
  } = validatedFields.data;

  if (validUsername) {
    const normalizedUsername = validUsername.trim().toLowerCase();

    const profanity = await checkOffensiveLanguage(normalizedUsername);
    if (profanity.isProfane) {
      return {
        error: { username: [profanity.error || "Inappropriate language"] },
      };
    }

    // Check for uniqueness
    const uniquenessCheck = await checkUsernameUnique(normalizedUsername);
    if (!uniquenessCheck.available) {
      return { error: { username: ["This username is already taken"] } };
    }
  }

  // Create an update object with only provided fields
  const updateFields: {
    full_name?: string;
    username?: string;
    avatar_url?: string | null;
    updated_at?: string;
  } = {};

  if (validFullName !== undefined) updateFields.full_name = validFullName;
  if (validUsername !== undefined)
    updateFields.username = validUsername.trim().toLowerCase();

  let metadataAvatarUrl: string | null | undefined;
  let profileUpdated = false;
  let cleanupPending = false;
  updateFields.updated_at = new Date().toISOString();

  if (avatarUrlValue !== null && validAvatarUrl !== undefined) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", userId)
      .single();
    if (profileError || !profile)
      return {
        error: { server: ["Unable to read the current profile image"] },
      };
    const previousUrl: string | null = profile.avatar_url ?? null;
    metadataAvatarUrl = previousUrl;
    if (validAvatarUrl !== previousUrl) {
      let image: Buffer | null = null;
      if (validAvatarUrl) {
        try {
          image = await preparePublicImage(validAvatarUrl);
        } catch (error) {
          return {
            error: {
              avatarUrl: [
                error instanceof Error ? error.message : "Invalid image",
              ],
            },
          };
        }
      }
      const replaced = await replacePublicImage({
        bucket: "avatars",
        ownerId: userId,
        previousUrl,
        image,
        storage: supabase.storage.from("avatars"),
        commit: async (url): Promise<ImageReferenceCommit> => {
          let query = supabase
            .from("profiles")
            .update({ ...updateFields, avatar_url: url })
            .eq("id", userId);
          query =
            previousUrl === null
              ? query.is("avatar_url", null)
              : query.eq("avatar_url", previousUrl);
          const { data: changed, error } = await query
            .select("id")
            .maybeSingle();
          return error ? "unknown" : changed ? "committed" : "refused";
        },
      });
      if (!replaced.success) return { error: { avatarUrl: [replaced.error] } };
      profileUpdated = true;
      metadataAvatarUrl = replaced.url;
      cleanupPending = replaced.cleanupPending;
    }
  }

  if (!profileUpdated) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update(updateFields)
      .eq("id", userId);
    if (updateError) return { error: { server: ["Failed to update profile"] } };
  }

  if (metadataAvatarUrl !== undefined) {
    const metadataPayload = {
      ...(user.user_metadata || {}),
      avatar_url: metadataAvatarUrl,
    };

    const { error: metadataError } = await supabase.auth.updateUser({
      data: metadataPayload,
    });

    if (metadataError) {
      console.error("Failed to sync avatar to auth metadata", metadataError);
      return { error: { server: ["Failed to update user metadata"] } };
    }
  }
  return { success: true, ...(cleanupPending ? { cleanupPending: true } : {}) };
}

export async function checkUsernameUnique(username: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Normalize username for consistent comparison
  const normalizedUsername = username.trim().toLowerCase();

  const { data: existingUser, error } = (await supabase
    .from("profiles")
    .select("id,username")
    .eq("username", normalizedUsername)
    .maybeSingle()) as {
    data: { id?: string; username?: string | null } | null;
    error: { message?: string } | null;
  };
  if (error) {
    return { available: false, error: error.message };
  }

  if (existingUser && user && existingUser.id === user.id) {
    return { available: true };
  }

  return { available: !existingUser };
}

export async function removeProfilePicture() {
  const formData = new FormData();
  formData.set("avatarUrl", "");
  return completeOnboarding(formData);
}

// Extremely simple function with no avatar handling at all
export async function updateNameAndUsername(
  fullName?: string,
  username?: string,
  phoneNumber?: string,
) {
  // Add phoneNumber parameter
  const { supabase, user } = await ensureProfileExists();
  const userId = user?.id;

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
    return {
      error: { phoneNumber: ["Phone number must be exactly 10 digits"] },
    };
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
  const { error: updateError } = (await supabase
    .from("profiles")
    .update(updateFields)
    .eq("id", userId)) as { error: { message?: string; code?: string } | null };

  if (updateError) {
    console.log(updateError);
    // Check for unique constraint violation on username
    const errorMessage = updateError.message ?? "";
    if (
      updateError.code === "23505" &&
      errorMessage.includes("profiles_username_key")
    ) {
      return { error: { username: ["Username already taken"] } };
    }
    return { error: { server: ["Failed to update profile"] } };
  }

  return { success: true };
}

export async function updateProfileVisibility(visibility: ProfileVisibility) {
  const { supabase, user } = await ensureProfileExists();

  if (!user) {
    return { error: { server: ["Not authenticated"] } };
  }

  if (!(["public", "private"] as ProfileVisibility[]).includes(visibility)) {
    return { error: { visibility: ["Invalid visibility setting"] } };
  }

  const canChange = canChangeProfileVisibility();
  const enforcedVisibility = applyVisibilityConstraints(visibility);

  const { error: updateError } = (await supabase
    .from("profiles")
    .update({
      profile_visibility: enforcedVisibility,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)) as { error: { message?: string } | null };

  if (updateError) {
    console.error(
      "updateProfileVisibility: failed to update profile",
      updateError,
    );
    return { error: { server: ["Failed to update profile visibility"] } };
  }

  return {
    success: true,
    visibility: enforcedVisibility,
    canChangeVisibility: canChange,
  };
}
