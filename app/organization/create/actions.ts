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
  type: 'nonprofit' | 'school' | 'company';
  logoUrl: string | null;
  createdBy: string;
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
  
  return !data; // If data is null, username is available
}

/**
 * Create a new organization
 */
export async function createOrganization(data: OrganizationCreationData) {
  const supabase = await createClient();
  
  // Verify that user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to create an organization" };
  }

  // Double-check username availability
  const isUsernameAvailable = await checkOrgUsername(data.username);
  if (!isUsernameAvailable) {
    return { error: "Username is already taken" };
  }

  // Generate a random join code
  const joinCode = generateJoinCode();

  try {
    // First, insert the organization to get its ID
    const { data: organization, error: createError } = await supabase
      .from("organizations")
      .insert({
        name: data.name,
        username: data.username,
        description: data.description || null,
        website: data.website || null,
        logo_url: null, // We'll update this after upload
        type: data.type,
        join_code: joinCode,
        created_by: user.id
      })
      .select("id")
      .single();

    if (createError) throw createError;
    
    let logoUrl = null;
    
    // If there's a logo (data URL format), upload it to storage using org ID
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
        
        // Size check (approximate calculation for base64)
        const approxFileSize = (base64Data.length * 0.75);
        if (approxFileSize > MAX_FILE_SIZE) {
          throw new Error(`File size exceeds the 5MB limit`);
        }
        
        // Determine file extension from MIME type
        let fileExt;
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
          fileExt = 'jpg';
        } else if (mimeType === 'image/png') {
          fileExt = 'png';
        } else if (mimeType === 'image/webp') {
          fileExt = 'webp';
        } else {
          fileExt = 'jpg'; // Default fallback
        }
        
        // Create a clean filename with just the ID and extension
        const fileName = `${organization.id}.${fileExt}`;
        
        // Upload to Supabase storage with organization ID as filename
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('organization-logos') // Make sure this bucket exists in Supabase
          .upload(fileName, 
                  Buffer.from(base64Data, 'base64'),
                  { contentType: mimeType, upsert: true });
        
        if (uploadError) throw uploadError;
        
        // Get the public URL for the uploaded image
        // This should return a URL with the correct structure including 'public'
        const { data: publicUrlData } = supabase.storage
          .from('organization-logos')
          .getPublicUrl(fileName);
        
        logoUrl = publicUrlData.publicUrl;
        
        // Update the organization with the logo URL
        const { error: updateError } = await supabase
          .from("organizations")
          .update({ logo_url: logoUrl })
          .eq("id", organization.id);
          
        if (updateError) throw updateError;
      } catch (error: any) {
        console.error("Error uploading organization logo:", error);
        // Just log the error and continue with organization creation without a logo
      }
    }
    
    // Add the creator as an admin
    const { error: memberError } = await supabase
      .from("organization_members")
      .insert({
        organization_id: organization.id,
        user_id: user.id,
        role: "admin"
      });

    if (memberError) throw memberError;
    
    // Revalidate the organization pages
    revalidatePath(`/organization/${data.username}`);
    revalidatePath('/organization');
    
    return { 
      success: true, 
      organizationId: organization.id,
      logoUrl // Return the logo URL for debugging
    };
  } catch (error: any) {
    console.error("Error creating organization:", error);
    return { error: error.message || "Failed to create organization" };
  }
}

/**
 * Regenerate a join code for an organization
 */
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
