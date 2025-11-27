"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

// Allowed image MIME types
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

// Max file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type OrganizationUpdateData = {
  id: string;
  name: string;
  username: string;
  description: string | undefined;
  website: string | undefined;
  type: 'nonprofit' | 'school' | 'company' | 'government' | 'other';
  logoUrl: string | null | undefined;
};

/**
 * Check if an organization username is available (excluding the current org's username)
 */
export async function checkUsernameAvailability(username: string): Promise<boolean> {
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
    console.error("Error checking username availability:", error);
    return false;
  }
  
  return !data; // If data is null, username is available
}

/**
 * Update an organization's details
 */
export async function updateOrganization(data: OrganizationUpdateData) {
  const supabase = await createClient();
  
  // Verify that user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to update an organization" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", data.id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can update organization details" };
  }

  // Get the current organization data
  const { data: currentOrg, error: orgError } = await supabase
    .from("organizations")
    .select("username, logo_url")
    .eq("id", data.id)
    .single();

  if (orgError) {
    console.error("Error fetching organization:", orgError);
    return { error: "Organization not found" };
  }

  try {
    let logoUrl = currentOrg.logo_url;
    
    // Handle logo update
    if (data.logoUrl !== undefined) {
      // Case: Logo was explicitly set to null - remove the current logo
      if (data.logoUrl === null) {
        logoUrl = null;
        
        // If there was a previous logo, delete it from storage
        if (currentOrg.logo_url) {
          try {
            const fileName = currentOrg.logo_url.split('/').pop();
            if (fileName) {
              await supabase.storage.from('organization-logos').remove([fileName]);
            }
          } catch (error) {
            console.error("Error removing old logo:", error);
            // Continue even if logo deletion fails
          }
        }
      } 
      // Case: New logo provided
      else if (data.logoUrl && data.logoUrl.startsWith('data:')) {
        // Extract the MIME type and verify it's allowed
        const mimeType = data.logoUrl.split(';')[0].split(':')[1];
        
        if (!ALLOWED_FILE_TYPES.includes(mimeType)) {
          return { error: "Invalid file type. Allowed types: JPEG, PNG, WebP" };
        }
        
        // Extract the base64 content and determine file extension
        const base64Data = data.logoUrl.split(',')[1];
        
        // Size check
        const approxFileSize = (base64Data.length * 0.75);
        if (approxFileSize > MAX_FILE_SIZE) {
          return { error: "File size exceeds the 5MB limit" };
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
          fileExt = 'jpg';
        }
        
        // File name based on organization ID
        const fileName = `${data.id}.${fileExt}`;
        
        // Delete previous logo if it exists
        if (currentOrg.logo_url) {
          try {
            const oldFileName = currentOrg.logo_url.split('/').pop();
            if (oldFileName && oldFileName !== fileName) {
              await supabase.storage.from('organization-logos').remove([oldFileName]);
            }
          } catch (error) {
            console.error("Error removing old logo:", error);
            // Continue even if logo deletion fails
          }
        }
        
        // Upload new logo
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('organization-logos')
          .upload(fileName, Buffer.from(base64Data, 'base64'), {
            contentType: mimeType,
            upsert: true
          });
        
        if (uploadError) throw uploadError;
        
        // Get public URL for the uploaded image
        const { data: publicUrlData } = supabase.storage
          .from('organization-logos')
          .getPublicUrl(fileName);
        
        logoUrl = publicUrlData.publicUrl;
      }
    }

    // Update the organization
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        name: data.name,
        username: data.username,
        description: data.description || null,
        website: data.website || null,
        type: data.type,
        logo_url: logoUrl
      })
      .eq("id", data.id);

    if (updateError) throw updateError;
    
    // Revalidate paths
    revalidatePath(`/organization/${currentOrg.username}`);
    revalidatePath(`/organization/${data.username}`);
    revalidatePath('/organization');
    
    return { success: true };
  } catch (error: any) {
    console.error("Error updating organization:", error);
    return { error: error.message || "Failed to update organization" };
  }
}

/**
 * Delete an organization permanently
 */
export async function deleteOrganization(organizationId: string) {
  const supabase = await createClient();
  
  // Verify that user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to delete an organization" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can delete organizations" };
  }

  try {
    // Get organization info for logo deletion
    const { data: organization } = await supabase
      .from("organizations")
      .select("logo_url")
      .eq("id", organizationId)
      .single();
    
    // Delete the organization logo if it exists
    if (organization?.logo_url) {
      try {
        const fileName = organization.logo_url.split('/').pop();
        if (fileName) {
          await supabase.storage.from('organization-logos').remove([fileName]);
        }
      } catch (error) {
        console.error("Error removing organization logo:", error);
        // Continue even if logo deletion fails
      }
    }
    
    // Delete the organization (cascade should handle related data)
    const { error: deleteError } = await supabase
      .from("organizations")
      .delete()
      .eq("id", organizationId);

    if (deleteError) {
      console.error("Error deleting organization from database:", deleteError);
      throw deleteError;
    }
    
    // Revalidate paths
    revalidatePath('/organization');
    
    return { success: true };
  } catch (error: any) {
    console.error("Error deleting organization:", error);
    return { error: error.message || "Failed to delete organization" };
  }
}

/**
 * Generate a staff invite link for an organization
 * This link allows teachers/staff to join directly with staff role
 */
export async function generateStaffLink(organizationId: string, expiresInDays: number = 30) {
  const supabase = await createClient();
  
  // Verify that user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to generate staff links" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can generate staff invite links" };
  }

  try {
    // Generate a new UUID token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Update the organization with the new staff token
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        staff_join_token: token,
        staff_join_token_created_at: new Date().toISOString(),
        staff_join_token_expires_at: expiresAt.toISOString(),
      })
      .eq("id", organizationId);

    if (updateError) {
      console.error("Error generating staff link:", updateError);
      throw updateError;
    }

    // Revalidate the settings page
    revalidatePath(`/organization/${organizationId}/settings`);

    return { 
      success: true, 
      token,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error: any) {
    console.error("Error generating staff link:", error);
    return { error: error.message || "Failed to generate staff link" };
  }
}

/**
 * Revoke the staff invite link for an organization
 */
export async function revokeStaffLink(organizationId: string) {
  const supabase = await createClient();
  
  // Verify that user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to revoke staff links" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can revoke staff invite links" };
  }

  try {
    const { error: updateError } = await supabase
      .from("organizations")
      .update({
        staff_join_token: null,
        staff_join_token_created_at: null,
        staff_join_token_expires_at: null,
      })
      .eq("id", organizationId);

    if (updateError) {
      console.error("Error revoking staff link:", updateError);
      throw updateError;
    }

    // Revalidate the settings page
    revalidatePath(`/organization/${organizationId}/settings`);

    return { success: true };
  } catch (error: any) {
    console.error("Error revoking staff link:", error);
    return { error: error.message || "Failed to revoke staff link" };
  }
}

/**
 * Get staff link details for an organization
 */
export async function getStaffLinkDetails(organizationId: string) {
  const supabase = await createClient();
  
  // Verify that user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to view staff link details" };
  }

  // Verify the user is an admin of the organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .single();

  if (!membership) {
    return { error: "Only admins can view staff link details" };
  }

  try {
    const { data: org, error } = await supabase
      .from("organizations")
      .select("staff_join_token, staff_join_token_created_at, staff_join_token_expires_at")
      .eq("id", organizationId)
      .single();

    if (error) {
      throw error;
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
  } catch (error: any) {
    console.error("Error getting staff link details:", error);
    return { error: error.message || "Failed to get staff link details" };
  }
}
