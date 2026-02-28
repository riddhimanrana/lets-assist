"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

type NotificationSeverity = "info" | "warning" | "success";



export async function createServerNotification(
  userId: string,
  title: string,
  body: string,
  severity: NotificationSeverity = "info",
  actionUrl?: string,
) {
  const supabase = getAdminClient();

  try {
    const { error } = await supabase
      .from("notifications")
      .insert({
        user_id: userId,
        title,
        body,
        type: "general",
        severity,
        action_url: actionUrl,
        displayed: false,
        read: false,
      });

    if (error) {
      console.error("Error creating notification:", error);
    }
  } catch (error) {
    console.error("Exception creating notification:", error);
  }
}

export async function sendSystemNotification(prevState: { error?: string; success?: boolean; message?: string } | null, formData: FormData) {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  const title = formData.get("title") as string;
  const body = formData.get("body") as string;
  const severity = formData.get("severity") as NotificationSeverity;
  const targetUserId = formData.get("targetUserId") as string;
  const actionUrl = formData.get("actionUrl") as string;

  if (!title || !body) {
    return { error: "Title and Body are required." };
  }

  try {
    if (targetUserId === "all") {
      // Bulk insert for all users - this might be heavy, consider batching or background job for real prod
      // For now fetching top 1000 users or similar
      const supabase = getAdminClient();
      const { data: users, error } = await supabase.from('profiles').select('id');

      if (error || !users) return { error: "Failed to fetch users for broadcast." };

      const notifications = users.map(u => ({
        user_id: u.id,
        title,
        body,
        type: "admin_broadcast",
        severity,
        action_url: actionUrl || null,
        displayed: false,
        read: false,
      }));

      const { error: insertError } = await supabase.from('notifications').insert(notifications);
      if (insertError) {
        console.error('Broadcast error:', insertError);
        return { error: "Failed to send broadcast." };
      }

    } else {
      // Single user
      await createServerNotification(targetUserId, title, body, severity, actionUrl || undefined);
    }

    return { success: true, message: "Notification sent successfully." };

  } catch (err) {
    console.error("Error sending notification:", err);
    return { error: "Internal Server Error" };
  }
}

export async function checkSuperAdmin() {
  // Get current user using getClaims() for better performance
  const { user } = await getAuthUser();

  if (!user) {
    return { isAdmin: false };
  }

  try {
    const serviceClient = getAdminClient();
    const { data: { user: adminUser }, error } = await serviceClient.auth.admin.getUserById(user.id);

    if (error || !adminUser) {
      console.error("Error fetching admin user:", error);
      return { isAdmin: false };
    }

    const isSuperAdmin =
      (adminUser as unknown as { is_super_admin?: boolean } | null)?.is_super_admin === true ||
      adminUser?.user_metadata?.is_super_admin === true ||
      adminUser?.app_metadata?.is_super_admin === true;
    return { isAdmin: isSuperAdmin, userId: user.id };
  } catch (err) {
    console.error("Exception checking super admin status:", err);
    return { isAdmin: false };
  }
}

export async function getAllFeedback() {
  const supabase = getAdminClient();

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
      page_path,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching feedback:", error);
    return { error: "Failed to fetch feedback" };
  }

  if (data && data.length > 0) {
    const userIds = [...new Set(data.map((item) => item.user_id))];

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", userIds);

    if (!profileError && profiles) {
      const profileMap = new Map(profiles.map((p) => [p.id, p]));
      const feedbackWithProfiles = data.map((item) => ({
        ...item,
        profiles: profileMap.get(item.user_id) || null,
      }));

      return { data: feedbackWithProfiles };
    }
  }

  const feedbackWithNullProfiles = (data || []).map((item) => ({
    ...item,
    profiles: null,
  }));

  return { data: feedbackWithNullProfiles };
}

export async function getTrustedMemberApplications() {
  const supabase = getAdminClient();

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

  if (data && data.length > 0) {
    const userIds = [...new Set(data.map((item) => item.user_id || item.id))];

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", userIds);

    if (!profileError && profiles) {
      const profileMap = new Map(profiles.map((p) => [p.id, p]));
      const applicationsWithProfiles = data.map((item) => ({
        ...item,
        profiles: profileMap.get(item.user_id || item.id) || null,
      }));

      return { data: applicationsWithProfiles };
    }
  }

  const applicationsWithNullProfiles = (data || []).map((item) => ({
    ...item,
    profiles: null,
  }));

  return { data: applicationsWithNullProfiles };
}

export async function updateTrustedMemberStatus(userId: string, status: boolean) {
  // Require user and admin as you already do
  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Perform the write with the service-role client to bypass RLS
  const service = getAdminClient();

  // Try user_id match first
  const { error: userIdError } = await service
    .from("trusted_member")
    .update({ status })
    .eq("user_id", userId);

  if (userIdError) {
    // Fallback to id match
    const { error: idError } = await service
      .from("trusted_member")
      .update({ status })
      .eq("id", userId);

    if (idError) {
      console.error("Error updating trusted_member status:", idError);
      return { error: "Failed to update trusted member status" };
    }
  }

  await service
    .from("profiles")
    .update({ trusted_member: status })
    .eq("id", userId);

  // Send notification with service client (already bypasses RLS)
  if (status === true) {
    await createServerNotification(
      userId,
      "Trusted Member Application Approved!",
      "Congratulations! Your trusted member application has been approved. You can now create projects and organizations.",
      "success",
      "/trusted-member"
    );
  } else {
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

export async function deleteFeedback(feedbackId: string) {
  const supabase = getAdminClient();

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

export async function searchUsers(query: string) {
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Search in profiles table directly which is much more efficient than listUsers
  // and allows searching by name
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, email, avatar_url')
    .or(`full_name.ilike.%${query}%,email.ilike.%${query}%,username.ilike.%${query}%`)
    .limit(5);

  if (error) {
    console.error("Error searching users:", error);
    return { error: "Failed to search users" };
  }

  if (!profiles || profiles.length === 0) return { data: [] };

  const results = profiles.map(p => ({
    id: p.id,
    email: p.email || "", // profiles should have email, fallback to empty if null
    full_name: p.full_name,
    avatar_url: p.avatar_url,
    username: p.username
  }));

  return { data: results };
}

export async function addTrustedMember(userId: string, email: string, name: string) {
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Check if already exists
  const { data: existing } = await supabase
    .from('trusted_member')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    return { error: "User is already in the trusted member list." };
  }

  const now = new Date().toISOString();
  // removed updated_at as it doesn't exist in the table
  const { error } = await supabase
    .from('trusted_member')
    .upsert({
      id: userId,
      user_id: userId,
      email,
      name,
      reason: 'Added manually by Admin',
      status: true,
      created_at: now,
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error("Error adding trusted member:", error);
    return { error: error.message };
  }

  await supabase
    .from('profiles')
    .update({ trusted_member: true })
    .eq('id', userId);

  await createServerNotification(
    userId,
    "You are now a Trusted Member! 🎉",
    "An admin has granted you trusted member status. You can now create projects and organizations.",
    "success",
    "/trusted-member"
  );

  return { success: true };
}
