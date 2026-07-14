"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

type MembershipRow = {
  id: string;
  role: string;
  organization?: { username: string } | { username: string }[] | null;
};

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

  const admin = getAdminClient();
  const { data: joinRows, error: joinError } = await admin.rpc(
    "join_organization_with_code",
    { p_user_id: user.id, p_join_code: joinCode.trim() },
  );
  const joinResult = Array.isArray(joinRows) ? joinRows[0] : joinRows;

  if (joinError || !joinResult) {
    return { error: "Invalid join code. Please check and try again." };
  }

  if (joinResult.join_status === "already_member") {
    return { 
      error: "You are already a member of this organization",
      organizationUsername: joinResult.organization_username,
    };
  }

  // Revalidate the organization page
  revalidatePath(`/organization/${joinResult.organization_username}`);
  revalidatePath('/organization');

  return { 
    success: true, 
    organizationUsername: joinResult.organization_username,
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
  const { data: membership, error: memberError } = (await supabase
    .from("organization_members")
    .select("id, role, organization:organizations(username)")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single()) as {
    data: MembershipRow | null;
    error: { message: string } | null;
  };

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
  
  // Remove through the same transactional suppression boundary used by admin
  // removals so a verified-domain login cannot silently re-add the member.
  const admin = getAdminClient();
  const { data: removed, error: leaveError } = await admin.rpc(
    "remove_organization_member_with_autojoin_suppression",
    {
      p_organization_id: organizationId,
      p_membership_id: membership.id,
      p_removed_by: user.id,
    },
  );

  if (leaveError || removed !== true) {
    console.error("Error leaving organization:", leaveError);
    return { error: "Failed to leave organization. Please try again." };
  }

  // Revalidate paths
  const orgRelation = Array.isArray(membership.organization)
    ? membership.organization[0]
    : membership.organization;
  const orgUsername = orgRelation?.username;
  if (orgUsername) {
    revalidatePath(`/organization/${orgUsername}`);
  }
  revalidatePath('/organization');

  return { success: true };
}
