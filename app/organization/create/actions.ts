"use server";

import { preparePublicImage } from "@/lib/storage/public-image";
import {
  replacePublicImage,
  type ImageReferenceCommit,
} from "@/lib/storage/replace-public-image";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { customAlphabet } from "nanoid";
import { hasSuperAdminMetadata } from "@/lib/auth/super-admin";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getActiveOrganizationMembershipRole,
  hasActiveOrganizationAdminMembership,
} from "@/lib/organization/active-membership";
import {
  isReservedOrganizationSlug,
  usernameUnavailableMessage,
} from "@/lib/organization/reserved-slugs";
import { validateOrganizationUsername } from "@/lib/organization/username";

// Generate a random 6-digit code
const generateJoinCode = customAlphabet("0123456789", 6);
const MAX_JOIN_CODE_ATTEMPTS = 5;

function isJoinCodeCollision(
  error: { code?: string; message?: string } | null,
): boolean {
  return Boolean(
    error?.code === "23505" &&
    error.message?.includes("organizations_join_code_unique_idx"),
  );
}

type OrganizationCreationData = {
  name: string;
  username: string;
  description: string;
  website: string;
  type: "nonprofit" | "school" | "company" | "government" | "other";
  logoUrl: string | null;
  createdBy: string;
  autoJoinDomain?: string;
};

/**
 * Check if an organization username is available
 */
export async function checkOrgUsername(username: string): Promise<boolean> {
  if (isReservedOrganizationSlug(username)) {
    return false;
  }

  if (!validateOrganizationUsername(username).ok) return false;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("username")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error("Error checking username:", error);
    return false;
  }

  return !data;
}

/**
 * Create a new organization ensuring the following order:
 * 1. Insert the organization.
 * 2. Add the organization admin.
 * 3. Update organization logoUrl only after the admin is added.
 */
export async function createOrganization(data: OrganizationCreationData) {
  const supabase = await createClient();

  // Verify that user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to create an organization" };
  }

  // Trusted member gating (required regardless of org role)
  const { data: isTrustedMember } = await supabase.rpc("is_trusted_member", {
    p_user: user.id,
  });
  if (isTrustedMember !== true) {
    // If profile flag isn't set, allow if application is accepted
    const { data: tmApp } = await supabase
      .from("trusted_member")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    if (tmApp?.status !== true) {
      return {
        error:
          "Only Trusted Members can create organizations. Please visit /trusted-member to apply, and once accepted you can create organizations.",
      };
    }
  }

  const isSuperAdmin = hasSuperAdminMetadata(user);
  const organizationLimit = isSuperAdmin ? 2 : 1;

  // Rate limiting: Check organizations created in the last 14 days
  const fourteenDaysAgo = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const admin = getAdminClient();
  const { count: orgsCount, error: countError } = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .eq("created_by", user.id) // Assuming 'created_by' stores the user ID
    .gte("created_at", fourteenDaysAgo);

  if (countError) {
    console.error("Error counting organizations for rate limit:", countError);
    // Decide if you want to block creation or allow if count fails. For now, allowing.
  }

  if (orgsCount !== null && orgsCount >= organizationLimit) {
    return {
      error: isSuperAdmin
        ? "Super admins can create up to two organizations every 14 days."
        : "You can only create one organization every 14 days.",
    };
  }

  if (isReservedOrganizationSlug(data.username)) {
    return { error: usernameUnavailableMessage(true) };
  }

  const usernameValidation = validateOrganizationUsername(data.username);
  if (!usernameValidation.ok) {
    return { error: usernameValidation.error };
  }

  // Double-check username availability
  const isUsernameAvailable = await checkOrgUsername(data.username);
  if (!isUsernameAvailable) {
    return { error: usernameUnavailableMessage(false) };
  }

  // New organizations are unverified. A platform review must happen before an
  // organization can claim a domain that grants membership automatically.
  if (data.autoJoinDomain) {
    return {
      error:
        "Create the organization first, then complete Let's Assist verification before enabling automatic domain membership",
    };
  }

  try {
    // 1. Insert the organization and retrieve its ID
    const insertOrganization = () =>
      supabase
        .from("organizations")
        .insert({
          name: data.name,
          username: data.username,
          description: data.description || null,
          website: data.website || null,
          type: data.type,
          join_code: generateJoinCode(),
          logo_url: null,
          created_by: user.id,
          auto_join_domain: null,
        })
        .select("id")
        .single();

    let createResult = await insertOrganization();
    for (
      let attempt = 1;
      attempt < MAX_JOIN_CODE_ATTEMPTS &&
      isJoinCodeCollision(createResult.error);
      attempt += 1
    ) {
      createResult = await insertOrganization();
    }

    const { data: organization, error: createError } = createResult;

    if (createError || !organization) {
      throw createError || new Error("Failed to create organization");
    }

    // 2. Add the creator as an admin
    const { error: memberError } = await admin
      .from("organization_members")
      .insert({
        organization_id: organization.id,
        user_id: user.id,
        role: "admin",
      });

    if (memberError) {
      const { error: cleanupError } = await admin
        .from("organizations")
        .delete()
        .eq("id", organization.id);
      if (cleanupError) {
        console.error(
          "Failed to compensate organization creation after membership failure:",
          cleanupError,
        );
      }
      throw memberError;
    }

    let logoUrl: string | null = null;
    let logoWarning: string | undefined;
    if (data.logoUrl) {
      try {
        const image = await preparePublicImage(data.logoUrl);
        const replaced = await replacePublicImage({
          bucket: "organization-logos",
          ownerId: organization.id,
          previousUrl: null,
          image,
          storage: supabase.storage.from("organization-logos"),
          commit: async (url): Promise<ImageReferenceCommit> => {
            const { data: changed, error } = await supabase
              .from("organizations")
              .update({ logo_url: url })
              .eq("id", organization.id)
              .is("logo_url", null)
              .select("id")
              .maybeSingle();
            return error ? "unknown" : changed ? "committed" : "refused";
          },
        });
        if (replaced.success) logoUrl = replaced.url;
        else
          logoWarning =
            "Your organization was created, but its logo update could not be confirmed. Refresh before trying again.";
      } catch {
        logoWarning =
          "Your organization was created without a logo. Choose a valid JPEG, PNG, or WebP in settings.";
      }
    }

    // Revalidate the organization pages
    revalidatePath(`/organization/${data.username}`);
    revalidatePath("/organization");

    return {
      success: true,
      organizationId: organization.id,
      logoUrl,
      logoWarning,
    };
  } catch (error) {
    console.error("Error creating organization:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to create organization",
    };
  }
}

export async function regenerateJoinCode(organizationId: string) {
  const supabase = await createClient();

  // Verify the user is authenticated and is an admin
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in" };
  }

  // Check if user is an admin of this organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .eq("status", "active")
    .single();

  if (!membership) {
    return { error: "Only admins can regenerate join codes" };
  }

  // Update the organization with a unique new code. Collisions are rare but
  // must not turn an otherwise valid rotation into an ambiguous capability.
  const admin = getAdminClient();
  const rotateJoinCode = async () => {
    if (
      !(await hasActiveOrganizationAdminMembership(
        admin,
        organizationId,
        user.id,
      ))
    ) {
      return { authorized: false as const };
    }

    const result = await admin
      .from("organizations")
      .update({ join_code: generateJoinCode() })
      .eq("id", organizationId)
      .select("join_code")
      .single();
    return { authorized: true as const, ...result };
  };

  let rotateResult = await rotateJoinCode();
  for (
    let attempt = 1;
    attempt < MAX_JOIN_CODE_ATTEMPTS &&
    rotateResult.authorized &&
    isJoinCodeCollision(rotateResult.error);
    attempt += 1
  ) {
    rotateResult = await rotateJoinCode();
  }

  if (!rotateResult.authorized) {
    return { error: "Only admins can regenerate join codes" };
  }
  const { data, error } = rotateResult;

  if (error || !data) {
    console.error("Error regenerating join code:", error);
    return { error: "Failed to regenerate join code" };
  }

  return { success: true, joinCode: data.join_code };
}

export async function getOrganizationJoinCode(organizationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be logged in" };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .in("role", ["admin", "staff"])
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return { error: "You cannot view this join code" };

  const admin = getAdminClient();
  const currentRole = await getActiveOrganizationMembershipRole(
    admin,
    organizationId,
    user.id,
  );
  if (currentRole !== "admin" && currentRole !== "staff") {
    return { error: "You cannot view this join code" };
  }
  const { data: organization, error } = await admin
    .from("organizations")
    .select("join_code")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !organization) return { error: "Unable to load join code" };

  return { joinCode: organization.join_code };
}
