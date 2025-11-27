"use server";

import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { redirect } from "next/navigation";

type NotificationSeverity = "info" | "warning" | "success";

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

async function fetchAuthUser(userId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service credentials are not configured.");
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch auth user: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  return json?.user ?? json;
}

async function createServerNotification(
  userId: string,
  title: string,
  body: string,
  severity: NotificationSeverity = "info",
  actionUrl?: string,
) {
  const supabase = getServiceRoleClient();

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

export async function checkSuperAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { isAdmin: false };
  }

  try {
    const adminUser = await fetchAuthUser(user.id);
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
  const supabase = getServiceRoleClient();

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
  const supabase = getServiceRoleClient();

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
  const service = getServiceRoleClient();

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

  // Send notification with service client (already bypasses RLS)
  if (status === true) {
    await createServerNotification(
      userId,
      "Trusted Member Application Approved! 🎉",
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
  const supabase = getServiceRoleClient();

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

export async function searchUsersByEmail(query: string) {
  const supabase = getServiceRoleClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Use listUsers to search by email (this is not efficient for large user bases but works for now)
  // Ideally we'd have a materialized view or a secure function to search users
  const { data: { users }, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 100 // Limit search scope
  });

  if (error) {
    console.error("Error searching users:", error);
    return { error: "Failed to search users" };
  }

  const lowerQuery = query.toLowerCase();
  const matchedUsers = users
    .filter(u => u.email?.toLowerCase().includes(lowerQuery))
    .slice(0, 5);

  if (matchedUsers.length === 0) return { data: [] };

  const userIds = matchedUsers.map(u => u.id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', userIds);

  const results = matchedUsers.map(u => {
    const profile = profiles?.find(p => p.id === u.id);
    return {
      id: u.id,
      email: u.email!,
      full_name: profile?.full_name,
      avatar_url: profile?.avatar_url,
      username: profile?.username
    };
  });

  return { data: results };
}

export async function addTrustedMember(userId: string, email: string, name: string) {
  const supabase = getServiceRoleClient();
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

  const { error } = await supabase.from('trusted_member').insert({
    user_id: userId,
    email,
    name,
    reason: 'Added manually by Admin',
    status: true,
    created_at: new Date().toISOString()
  });

  if (error) {
    console.error("Error adding trusted member:", error);
    return { error: error.message };
  }

  await createServerNotification(
    userId,
    "You are now a Trusted Member! 🎉",
    "An admin has granted you trusted member status. You can now create projects and organizations.",
    "success",
    "/trusted-member"
  );

  return { success: true };
}
