"use server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

// Import the notification service types for server-side usage
type NotificationSeverity = 'info' | 'warning' | 'success';

/**
 * Create a notification for a user (server-side version)
 */
async function createServerNotification(
  userId: string,
  title: string,
  body: string,
  severity: NotificationSeverity = 'info',
  actionUrl?: string
) {
  const supabase = await createClient();
  
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title,
        body,
        type: 'general',
        severity,
        action_url: actionUrl,
        displayed: false,
        read: false
      });
    
    if (error) {
      console.error('Error creating notification:', error);
    }
  } catch (error) {
    console.error('Exception creating notification:', error);
  }
}

/**
 * Check if the current user is a super admin
 * Super admin check is based on raw_user_meta_data.is_super_admin field
 */
export async function checkSuperAdmin() {
  const supabase = await createClient();
  
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { isAdmin: false };
  }

  // Check if user has is_super_admin in their metadata
  const isSuperAdmin = user.user_metadata?.is_super_admin === true;
  
  return { isAdmin: isSuperAdmin, userId: user.id };
}

/**
 * Get all feedback from users
 */
export async function getAllFeedback() {
  const supabase = await createClient();
  
  // First verify admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("feedback")
    .select(`
      id,
      user_id,
      section,
      email,
      title,
      feedback,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching feedback:", error);
    return { error: "Failed to fetch feedback" };
  }

  // Fetch profile data separately for each unique user
  if (data && data.length > 0) {
    const userIds = [...new Set(data.map(item => item.user_id))];
    
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", userIds);

    if (!profileError && profiles) {
      // Map profiles to feedback items
      const profileMap = new Map(profiles.map(p => [p.id, p]));
      const feedbackWithProfiles = data.map(item => ({
        ...item,
        profiles: profileMap.get(item.user_id) || null
      }));
      
      return { data: feedbackWithProfiles };
    }
  }

  // If no data or profile fetch failed, return data with null profiles
  const feedbackWithNullProfiles = (data || []).map(item => ({
    ...item,
    profiles: null
  }));

  return { data: feedbackWithNullProfiles };
}

/**
 * Get all pending trusted member applications
 */
export async function getTrustedMemberApplications() {
  const supabase = await createClient();
  
  // First verify admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("trusted_member")
    .select(`
      id,
      user_id,
      name,
      email,
      reason,
      status,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching trusted member applications:", error);
    return { error: "Failed to fetch applications" };
  }

  // Fetch profile data separately for each unique user
  if (data && data.length > 0) {
    const userIds = [...new Set(data.map(item => item.user_id || item.id))];
    
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", userIds);

    if (!profileError && profiles) {
      // Map profiles to trusted member items
      const profileMap = new Map(profiles.map(p => [p.id, p]));
      const applicationsWithProfiles = data.map(item => ({
        ...item,
        profiles: profileMap.get(item.user_id || item.id) || null
      }));
      
      return { data: applicationsWithProfiles };
    }
  }

  // If no data or profile fetch failed, return data with null profiles
  const applicationsWithNullProfiles = (data || []).map(item => ({
    ...item,
    profiles: null
  }));

  return { data: applicationsWithNullProfiles };
}

/**
 * Update trusted member status (approve or deny)
 */
export async function updateTrustedMemberStatus(
  userId: string,
  status: boolean
) {
  const supabase = await createClient();
  
  // First verify admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  // Update the trusted_member table using either user_id or id
  // First try user_id, then fall back to id
  let tmError = null;
  
  // Try updating with user_id first
  const { error: userIdError } = await supabase
    .from("trusted_member")
    .update({ status })
    .eq("user_id", userId);

  // If that fails, try with id
  if (userIdError) {
    const { error: idError } = await supabase
      .from("trusted_member")
      .update({ status })
      .eq("id", userId);
    
    tmError = idError;
  }

  if (tmError) {
    console.error("Error updating trusted_member status:", tmError);
    return { error: "Failed to update trusted member status" };
  }

  // If approved, also update the profiles table
  if (status === true) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ trusted_member: true })
      .eq("id", userId);

    if (profileError) {
      console.error("Error updating profile trusted_member status:", profileError);
      return { error: "Failed to update profile" };
    }

    // Send approval notification
    await createServerNotification(
      userId,
      "Trusted Member Application Approved! 🎉",
      "Congratulations! Your trusted member application has been approved. You can now create projects and organizations.",
      "success",
      "/trusted-member"
    );
  } else {
    // If denied, ensure profile is set to false
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ trusted_member: false })
      .eq("id", userId);

    if (profileError) {
      console.error("Error updating profile trusted_member status:", profileError);
    }

    // Send denial notification
    await createServerNotification(
      userId,
      "Trusted Member Application Update",
      "Thank you for your interest in becoming a trusted member. Unfortunately, your application was not approved at this time. Please contact support for more information.",
      "warning",
      "/trusted-member"
    );
  }

  return { success: true };
}

/**
 * Delete a feedback entry
 */
export async function deleteFeedback(feedbackId: string) {
  const supabase = await createClient();
  
  // First verify admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  const { error } = await supabase
    .from("feedback")
    .delete()
    .eq("id", feedbackId);

  if (error) {
    console.error("Error deleting feedback:", error);
    return { error: "Failed to delete feedback" };
  }

  return { success: true };
}
