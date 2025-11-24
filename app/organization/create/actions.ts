"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { customAlphabet } from 'nanoid';
import { redirect } from "next/navigation";

// Generate a random 6-digit code
const generateJoinCode = customAlphabet('0123456789', 6);

// Allowed image MIME types
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

// Max file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type OrganizationCreationData = {
  name: string;
  username: string;
  description: string;
  website: string;
  type: 'nonprofit' | 'school' | 'company' | 'government' | 'other';
  logoUrl: string | null;
  createdBy: string;
  allowedEmailDomains?: string[];
};

/**
 * Check if an organization username is available
 */
export async function checkOrgUsername(username: string): Promise<boolean> {
  const supabase = await createClient();

  if (!username || username.length < 3) {
    return false;
  }

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to create an organization" };
  }

  // Trusted member gating (required regardless of org role)
  const { data: tmProfile } = await supabase
    .from("profiles")
    .select("trusted_member")
    .eq("id", user.id)
    .single();
  if (!tmProfile?.trusted_member) {
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

  // Rate limiting: Check organizations created in the last 14 days
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { count: orgsCount, error: countError } = await supabase
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .eq("created_by", user.id) // Assuming 'created_by' stores the user ID
    .gte("created_at", fourteenDaysAgo);

  if (countError) {
    console.error("Error counting organizations for rate limit:", countError);
    // Decide if you want to block creation or allow if count fails. For now, allowing.
  }

  if (orgsCount !== null && orgsCount >= 1) {
    return { error: "You can only create one organization every 14 days." };
  }

  // Double-check username availability
  const isUsernameAvailable = await checkOrgUsername(data.username);
  if (!isUsernameAvailable) {
    return { error: "Username is already taken" };
  }

  // Generate a random join code
  const joinCode = generateJoinCode();

  try {
    // 1. Insert the organization and retrieve its ID
    const { data: organization, error: createError } = await supabase
      .from("organizations")
      .insert({
        name: data.name,
        username: data.username,
        description: data.description || null,
        website: data.website || null,
        type: data.type,
        join_code: joinCode,
        logo_url: null,  // initially set to null
        created_by: user.id,
        allowed_email_domains: data.allowedEmailDomains || null
      })
      .select("id")
      .single();

    if (createError || !organization) {
      throw createError || new Error("Failed to create organization");
    }

    // 2. Add the creator as an admin
    const { error: memberError } = await supabase
      .from("organization_members")
      .insert({
        organization_id: organization.id,
        user_id: user.id,
        role: "admin"
      });

    if (memberError) {
      throw memberError;
    }

    let logoUrl = null;

    // 3. Process the logo upload AFTER the organization admin is added
    if (data.logoUrl && data.logoUrl.startsWith('data:')) {
      try {
        // Extract the MIME type and verify it's allowed
        const mimeType = data.logoUrl.split(';')[0].split(':')[1];

        if (!ALLOWED_FILE_TYPES.includes(mimeType)) {
          console.warn(`Invalid file type: ${mimeType}. Skipping logo upload.`);
          throw new Error(`Invalid file type. Allowed types: JPEG, PNG, WebP`);
        }

        // Extract the base64 content and determine file extension
        const base64Data = data.logoUrl.split(',')[1];

        // Size check (approximate check for base64)
        const approxFileSize = base64Data.length * 0.75;
        if (approxFileSize > MAX_FILE_SIZE) {
          throw new Error(`File size exceeds the 5MB limit`);
        }

        let fileExt;
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
          fileExt = 'jpg';
        } else if (mimeType === 'image/png') {
          fileExt = 'png';
        } else if (mimeType === 'image/webp') {
          fileExt = 'webp';
        } else {
          fileExt = 'jpg';
        }

        // Create a clean filename using organization id and extension
        const fileName = `${organization.id}.${fileExt}`;

        // Upload to Supabase storage (ensure the 'organization-logos' bucket exists)
        const { error: uploadError } = await supabase.storage
          .from('organization-logos')
          .upload(
            fileName,
            Buffer.from(base64Data, 'base64'),
            { contentType: mimeType, upsert: true }
          );

        if (uploadError) throw uploadError;

        // Get the public URL for the uploaded image
        const { data: publicUrlData } = supabase.storage
          .from('organization-logos')
          .getPublicUrl(fileName);

        logoUrl = publicUrlData.publicUrl;
        if (!logoUrl) {
          throw new Error("Failed to get public URL for the uploaded logo");
        }
        console.log("Logo uploaded successfully:", logoUrl);

        // Update the organization with the new logo URL
        const { error: updateError } = await supabase
          .from("organizations")
          .update({ logo_url: logoUrl })
          .eq("id", organization.id)
          .select("logo_url")
          .single();


      } catch (error: any) {
        console.error("Error updating organization logo:", error);
        // Continue without interrupting organization creation if logo upload fails.
      }
    }

    // Revalidate the organization pages
    revalidatePath(`/organization/${data.username}`);
    revalidatePath('/organization');

    return {
      success: true,
      organizationId: organization.id,
      logoUrl
    };
  } catch (error: any) {
    console.error("Error creating organization:", error);
    return { error: error.message || "Failed to create organization" };
  }
}

export async function regenerateJoinCode(organizationId: string) {
  const supabase = await createClient();

  // Verify the user is authenticated and is an admin
  const { data: { user } } = await supabase.auth.getUser();
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
    .single();

  if (!membership) {
    return { error: "Only admins can regenerate join codes" };
  }

  // Generate a new join code
  const newJoinCode = generateJoinCode();

  // Update the organization with the new code
  const { data, error } = await supabase
    .from("organizations")
    .update({ join_code: newJoinCode })
    .eq("id", organizationId)
    .select("join_code")
    .single();

  if (error) {
    console.error("Error regenerating join code:", error);
    return { error: "Failed to regenerate join code" };
  }

  return { success: true, joinCode: data.join_code };
}