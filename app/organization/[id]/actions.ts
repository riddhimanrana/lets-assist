"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Update a member's role in an organization
 */
export async function updateMemberRole(
  organizationId: string,
  membershipId: string,
  newRole: string
) {
  const supabase = await createClient();
  
  // Authenticate the user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in" };
  }
  
  // Verify the user has permission to update roles
  const { data: currentUserMembership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();
  
  if (!currentUserMembership) {
    return { error: "You are not a member of this organization" };
  }
  
  // Only admins can make other users admins
  // Staff can only change regular members to staff or back
  if (
    (currentUserMembership.role !== "admin" && newRole === "admin") ||
    (currentUserMembership.role === "staff" && newRole === "admin")
  ) {
    return { error: "You don't have permission to assign this role" };
  }
  
  // Get the membership details
  const { data: membership } = await supabase
    .from("organization_members")
    .select("user_id, role")
    .eq("id", membershipId)
    .eq("organization_id", organizationId)
    .single();
  
  if (!membership) {
    return { error: "Member not found" };
  }
  
  // Staff members can't modify admins
  if (currentUserMembership.role === "staff" && membership.role === "admin") {
    return { error: "You don't have permission to modify admins" };
  }
  
  // Don't allow the last admin to be demoted
  if (membership.role === "admin" && newRole !== "admin") {
    // Count other admins
    const { count, error: countError } = await supabase
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .neq("id", membershipId);
      
    if (countError) {
      return { error: "Failed to verify admin status" };
    }
    
    if (count === 0) {
      return { 
        error: "Cannot demote the last admin. Promote another member to admin first."
      };
    }
  }
  
  // Update the member's role
  const { error: updateError } = await supabase
    .from("organization_members")
    .update({ role: newRole })
    .eq("id", membershipId)
    .eq("organization_id", organizationId);
  
  if (updateError) {
    console.error("Error updating member role:", updateError);
    return { error: "Failed to update member role" };
  }
  
  // Revalidate the organization page
  revalidatePath(`/organization/[id]`);
  
  return { success: true };
}

/**
 * Remove a member from an organization
 */
export async function removeMember(organizationId: string, membershipId: string) {
  const supabase = await createClient();
  
  // Authenticate the user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be logged in" };
  }
  
  // Get the membership details
  const { data: membership } = await supabase
    .from("organization_members")
    .select("user_id, role")
    .eq("id", membershipId)
    .eq("organization_id", organizationId)
    .single();
  
  if (!membership) {
    return { error: "Member not found" };
  }
  
  // Allow users to remove themselves
  const isSelfRemoval = membership.user_id === user.id;
  
  if (!isSelfRemoval) {
    // If not removing self, verify permissions
    const { data: currentUserMembership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();
    
    if (!currentUserMembership) {
      return { error: "You are not a member of this organization" };
    }
    
    // Only admins can remove admins
    // Staff can only remove regular members
    if (
      (currentUserMembership.role !== "admin" && membership.role === "admin") ||
      (currentUserMembership.role === "staff" && membership.role !== "member")
    ) {
      return { error: "You don't have permission to remove this member" };
    }
    
    // Don't allow removing the last admin
    if (membership.role === "admin") {
      // Count other admins
      const { count, error: countError } = await supabase
        .from("organization_members")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("role", "admin")
        .neq("id", membershipId);
        
      if (countError) {
        return { error: "Failed to verify admin status" };
      }
      
      if (count === 0) {
        return { 
          error: "Cannot remove the last admin. Promote another member to admin first."
        };
      }
    }
  } else if (membership.role === "admin") {
    // If user is removing themselves and they're an admin, check if they're the last admin
    const { count, error: countError } = await supabase
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .neq("id", membershipId);
      
    if (countError) {
      return { error: "Failed to verify admin status" };
    }
    
    if (count === 0) {
      return { 
        error: "You are the last admin. Please promote another member to admin before leaving."
      };
    }
  }
  
  // Remove the member
  const { error: removeError } = await supabase
    .from("organization_members")
    .delete()
    .eq("id", membershipId)
    .eq("organization_id", organizationId);
  
  if (removeError) {
    console.error("Error removing member:", removeError);
    return { error: "Failed to remove member" };
  }
  
  // Revalidate the organization page
  revalidatePath(`/organization/[id]`);
  
  return { success: true };
}
