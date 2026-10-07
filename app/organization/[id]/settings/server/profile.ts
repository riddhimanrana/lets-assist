"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";
import {
  ownedPublicImagePath,
  preparePublicImage,
} from "@/lib/storage/public-image";
import { reservePublicImageCleanup } from "@/lib/storage/public-image-lifecycle";
import {
  replacePublicImage,
  type ImageReferenceCommit,
} from "@/lib/storage/replace-public-image";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { validateOrganizationAutojoinDomain } from "@/lib/organization/domain-policy";
import {
  isReservedOrganizationSlug,
  usernameUnavailableMessage,
} from "@/lib/organization/reserved-slugs";
import { validateOrganizationUsername } from "@/lib/organization/username";
import { hasActiveOrganizationAdminMembership } from "@/lib/organization/active-membership";

type OrganizationUpdateData = {
  id: string;
  name: string;
  username: string;
  description: string | undefined;
  website: string | undefined;
  type: "nonprofit" | "school" | "company" | "government" | "other";
  logoUrl: string | null | undefined;
  autoJoinDomain?: string | null;
  showMembersPublicly?: boolean;
};

/**
 * Check if an organization username is available (excluding the current org's username)
 */
export async function checkUsernameAvailability(
  username: string,
): Promise<boolean> {
  "use server";
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
    safeConsole.error("Error checking username availability:", error);
    return false;
  }

  return !data; // If data is null, username is available
}

/**
 * Update an organization's details
 */
export async function updateOrganization(data: OrganizationUpdateData) {
  "use server";
  const supabase = await createClient();

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to update an organization" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", data.id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .eq("status", "active")
    .single();

  if (!membership) {
    return { error: "Only admins can update organization details" };
  }

  // Get the current organization data
  const admin = getAdminClient();
  if (!(await hasActiveOrganizationAdminMembership(admin, data.id, user.id))) {
    return { error: "Only admins can update organization details" };
  }
  const { data: currentOrg, error: orgError } = await admin
    .from("organizations")
    .select("username, logo_url, verified, auto_join_domain")
    .eq("id", data.id)
    .single();

  if (orgError || !currentOrg) {
    safeConsole.error("Error fetching organization:", orgError);
    return { error: "Organization not found" };
  }

  if (
    data.username !== currentOrg.username &&
    isReservedOrganizationSlug(data.username)
  ) {
    return { error: usernameUnavailableMessage(true) };
  }

  if (data.username !== currentOrg.username) {
    const usernameValidation = validateOrganizationUsername(data.username);
    if (!usernameValidation.ok) {
      return { error: usernameValidation.error };
    }
  }

  try {
    let cleanupPending = false;
    const autoJoinDomain: string | null = currentOrg.auto_join_domain;

    if (data.autoJoinDomain) {
      const domainResult = validateOrganizationAutojoinDomain(
        data.autoJoinDomain,
      );
      if (!domainResult.ok) {
        return {
          error:
            domainResult.reason === "public_provider"
              ? "Public email providers cannot be used for automatic organization membership"
              : "Enter a valid organization-owned email domain",
        };
      }

      if (domainResult.domain !== currentOrg.auto_join_domain) {
        return {
          error:
            "Contact Let's Assist support to verify or change an automatic-membership domain",
        };
      }
    } else if (currentOrg.auto_join_domain) {
      return {
        error:
          "Contact Let's Assist support to disable a verified automatic-membership domain",
      };
    }

    const fields = {
      name: data.name,
      username: data.username,
      description: data.description || null,
      website: data.website || null,
      type: data.type,
      auto_join_domain: autoJoinDomain,
      show_members_publicly: data.showMembersPublicly !== false,
    };
    const commit = async (
      url: string | null,
    ): Promise<ImageReferenceCommit> => {
      if (
        !(await hasActiveOrganizationAdminMembership(admin, data.id, user.id))
      )
        return "refused";
      let query = admin
        .from("organizations")
        .update({ ...fields, logo_url: url })
        .eq("id", data.id);
      query =
        currentOrg.logo_url === null
          ? query.is("logo_url", null)
          : query.eq("logo_url", currentOrg.logo_url);
      const { data: changed, error } = await query.select("id").maybeSingle();
      return error ? "unknown" : changed ? "committed" : "refused";
    };
    if (data.logoUrl !== undefined && data.logoUrl !== currentOrg.logo_url) {
      const image = data.logoUrl
        ? await preparePublicImage(data.logoUrl)
        : null;
      const replaced = await replacePublicImage({
        actorId: user.id,
        bucket: "organization-logos",
        ownerId: data.id,
        previousUrl: currentOrg.logo_url,
        image,
        storage: supabase.storage.from("organization-logos"),
        commit,
      });
      if (!replaced.success) return { error: replaced.error };
      cleanupPending = replaced.cleanupPending;
    } else {
      if (
        !(await hasActiveOrganizationAdminMembership(admin, data.id, user.id))
      ) {
        return { error: "Only admins can update organization details" };
      }
      const { error } = await admin
        .from("organizations")
        .update(fields)
        .eq("id", data.id);
      if (error)
        return {
          error:
            "The organization update could not be confirmed. Refresh before trying again.",
        };
    }

    // Revalidate paths
    revalidatePath(`/organization/${currentOrg.username}`);
    revalidatePath(`/organization/${data.username}`);
    revalidatePath("/organization");

    return {
      success: true,
      ...(cleanupPending ? { cleanupPending: true } : {}),
    };
  } catch (error) {
    safeConsole.error("Error updating organization:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to update organization",
    };
  }
}

/**
 * Delete an organization permanently
 */
export async function deleteOrganization(organizationId: string) {
  "use server";
  const supabase = await createClient();

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to delete an organization" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .eq("status", "active")
    .single();

  if (!membership) {
    return { error: "Only admins can delete organizations" };
  }

  try {
    // Retain the deterministic cleanup path, but do not touch storage until the
    // RLS-scoped database delete proves that this exact organization is gone.
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("logo_url")
      .eq("id", organizationId)
      .single();

    if (organizationError || !organization) {
      return { error: "Organization not found" };
    }

    const logoPath = ownedPublicImagePath(
      organization.logo_url,
      supabase.storage.from("organization-logos").getPublicUrl("").data
        .publicUrl,
      "organization-logos",
      organizationId,
    );
    await reservePublicImageCleanup({
      actorId: user.id,
      bucket: "organization-logos",
      ownerId: organizationId,
      previousUrl: organization.logo_url,
      previousPath: logoPath,
      candidatePath: null,
    });

    const { data: deletedOrganization, error: deleteError } = await supabase
      .from("organizations")
      .delete()
      .eq("id", organizationId)
      .select("id")
      .maybeSingle();

    if (deleteError) {
      safeConsole.error(
        "Error deleting organization from database:",
        deleteError,
      );
      throw deleteError;
    }

    if (!deletedOrganization || deletedOrganization.id !== organizationId) {
      throw new Error("Failed to delete organization");
    }

    // Revalidate paths
    revalidatePath("/organization");

    return { success: true, cleanupPending: Boolean(logoPath) };
  } catch (error) {
    safeConsole.error("Error deleting organization:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete organization",
    };
  }
}

/**
 * Generate a staff invite link for an organization
 * This link allows teachers/staff to join directly with staff role
 */
export async function generateStaffLink(
  organizationId: string,
  expiresInDays: number = 30,
) {
  "use server";

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to generate staff links" };
  }

  // Verify the user is an admin of the organization
  const admin = getAdminClient();
  if (
    !(await hasActiveOrganizationAdminMembership(
      admin,
      organizationId,
      user.id,
    ))
  ) {
    return { error: "Only admins can generate staff invite links" };
  }

  try {
    // Generate a new UUID token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Update the organization with the new staff token
    const { error: updateError } = await admin
      .from("organizations")
      .update({
        staff_join_token: token,
        staff_join_token_created_at: new Date().toISOString(),
        staff_join_token_expires_at: expiresAt.toISOString(),
        staff_join_token_issued_by: user.id,
      })
      .eq("id", organizationId);

    if (updateError) {
      safeConsole.error("Error generating staff link:", updateError);
      throw updateError;
    }

    // Revalidate the settings page
    revalidatePath(`/organization/${organizationId}/settings`);

    return {
      success: true,
      token,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    safeConsole.error("Error generating staff link:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate staff link",
    };
  }
}

/**
 * Revoke the staff invite link for an organization
 */
export async function revokeStaffLink(organizationId: string) {
  "use server";

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to revoke staff links" };
  }

  // Verify the user is an admin of the organization
  const admin = getAdminClient();
  if (
    !(await hasActiveOrganizationAdminMembership(
      admin,
      organizationId,
      user.id,
    ))
  ) {
    return { error: "Only admins can revoke staff invite links" };
  }

  try {
    const { error: updateError } = await admin
      .from("organizations")
      .update({
        staff_join_token: null,
        staff_join_token_created_at: null,
        staff_join_token_expires_at: null,
        staff_join_token_issued_by: null,
      })
      .eq("id", organizationId);

    if (updateError) {
      safeConsole.error("Error revoking staff link:", updateError);
      throw updateError;
    }

    // Revalidate the settings page
    revalidatePath(`/organization/${organizationId}/settings`);

    return { success: true };
  } catch (error) {
    safeConsole.error("Error revoking staff link:", error);
    return {
      error:
        error instanceof Error ? error.message : "Failed to revoke staff link",
    };
  }
}

/**
 * Get staff link details for an organization
 */
export async function getStaffLinkDetails(organizationId: string) {
  "use server";

  // Verify that user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    return { error: "You must be logged in to view staff link details" };
  }

  // Verify the user is an admin of the organization
  const admin = getAdminClient();
  if (
    !(await hasActiveOrganizationAdminMembership(
      admin,
      organizationId,
      user.id,
    ))
  ) {
    return { error: "Only admins can view staff link details" };
  }

  try {
    const { data: org, error } = await admin
      .from("organizations")
      .select(
        "staff_join_token, staff_join_token_created_at, staff_join_token_expires_at",
      )
      .eq("id", organizationId)
      .single();

    if (error || !org) {
      throw error ?? new Error("Organization not found");
    }

    // Check if token is expired
    const isExpired = org.staff_join_token_expires_at
      ? new Date(org.staff_join_token_expires_at) < new Date()
      : false;

    return {
      hasToken: !!org.staff_join_token && !isExpired,
      token: isExpired ? null : org.staff_join_token,
      createdAt: org.staff_join_token_created_at,
      expiresAt: org.staff_join_token_expires_at,
      isExpired,
    };
  } catch (error) {
    safeConsole.error("Error getting staff link details:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to get staff link details",
    };
  }
}
