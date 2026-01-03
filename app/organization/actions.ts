"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";


// Generate a random 6-digit code


/**
 * Join an organization with a join code
 */
export async function joinOrganization(joinCode: string) {
  const supabase = await createClient();
  
  // Verify the user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to join an organization" };
  }

  // Find the organization with the provided join code
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id, username")
    .eq("join_code", joinCode)
    .single();

  if (orgError || !organization) {
    return { error: "Invalid join code. Please check and try again." };
  }

  // Check if the user is already a member of the organization
  const { data: existingMember } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .single();

  if (existingMember) {
    return { 
      error: "You are already a member of this organization",
      organizationUsername: organization.username
    };
  }

  // Add the user as a member
  const { error: joinError } = await supabase
    .from("organization_members")
    .insert({
      organization_id: organization.id,
      user_id: user.id,
      role: "member" // Default role when joining with code
    });

  if (joinError) {
    console.error("Error joining organization:", joinError);
    return { error: "Failed to join organization. Please try again." };
  }

  // Revalidate the organization page
  revalidatePath(`/organization/${organization.username}`);
  revalidatePath('/organization');

  return { 
    success: true, 
    organizationUsername: organization.username 
  };
}

/**
 * Leave an organization
 */
export async function leaveOrganization(organizationId: string) {
  const supabase = await createClient();
  
  // Verify the user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in to leave an organization" };
  }
  
  // Check if user is a member of the organization
  const { data: membership, error: memberError } = await supabase
    .from("organization_members")
    .select("id, role, organization:organizations(username)")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();

  if (memberError || !membership) {
    return { error: "You are not a member of this organization" };
  }
  
  // Don't allow the last admin to leave
  if (membership.role === "admin") {
    // Count other admins
    const { count, error: countError } = await supabase
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .neq("user_id", user.id);
      
    if (countError) {
      return { error: "Failed to verify admin status" };
    }
    
    if (count === 0) {
      return { 
        error: "You are the only admin. Please promote another member to admin before leaving."
      };
    }
  }
  
  // Remove user from organization
  const { error: leaveError } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", user.id);

  if (leaveError) {
    console.error("Error leaving organization:", leaveError);
    return { error: "Failed to leave organization. Please try again." };
  }

  // Revalidate paths
  const orgUsername = membership.organization?.[0]?.username;
  if (orgUsername) {
    revalidatePath(`/organization/${orgUsername}`);
  }
  revalidatePath('/organization');

  return { success: true };
}
