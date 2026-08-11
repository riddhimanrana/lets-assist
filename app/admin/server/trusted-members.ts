"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { readAccountAccessFromMetadata } from "@/lib/auth/account-access";
import { checkSuperAdmin } from "./auth";
import {
  createServerNotification,
  readBannedUntil,
  type UserAccessControlResult,
} from "./shared";

export async function getTrustedMemberApplications() {
  "use server";
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("trusted_member")
    .select(
      `
      id,
      user_id,
      name,
      email,
      reason,
      status,
      created_at
    `,
    )
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

export async function updateTrustedMemberStatus(
  userId: string,
  status: boolean,
) {
  "use server";
  // Require user and admin as you already do
  const supabaseUser = await createClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
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
      "/trusted-member",
    );
  } else {
    await createServerNotification(
      userId,
      "Trusted Member Application Update",
      "Thank you for your interest in becoming a trusted member. Unfortunately, your application was not approved at this time. Please contact support for more information.",
      "warning",
      "/trusted-member",
    );
  }

  return { success: true };
}

export async function searchUsers(query: string) {
  "use server";
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Search in profiles table directly which is much more efficient than listUsers
  // and allows searching by name
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, email, avatar_url")
    .or(
      `full_name.ilike.%${query}%,email.ilike.%${query}%,username.ilike.%${query}%`,
    )
    .limit(5);

  if (error) {
    console.error("Error searching users:", error);
    return { error: "Failed to search users" };
  }

  if (!profiles || profiles.length === 0) return { data: [] };

  const results = profiles.map((p) => ({
    id: p.id,
    email: p.email || "", // profiles should have email, fallback to empty if null
    full_name: p.full_name,
    avatar_url: p.avatar_url,
    username: p.username,
  }));

  return { data: results };
}

export async function addTrustedMember(
  userId: string,
  email: string,
  name: string,
) {
  "use server";
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Check if already exists
  const { data: existing } = await supabase
    .from("trusted_member")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return { error: "User is already in the trusted member list." };
  }

  const now = new Date().toISOString();
  // removed updated_at as it doesn't exist in the table
  const { error } = await supabase.from("trusted_member").upsert(
    {
      id: userId,
      user_id: userId,
      email,
      name,
      reason: "Added manually by Admin",
      status: true,
      created_at: now,
    },
    {
      onConflict: "user_id",
    },
  );

  if (error) {
    console.error("Error adding trusted member:", error);
    return { error: error.message };
  }

  await supabase
    .from("profiles")
    .update({ trusted_member: true })
    .eq("id", userId);

  await createServerNotification(
    userId,
    "You are now a Trusted Member! 🎉",
    "An admin has granted you trusted member status. You can now create projects and organizations.",
    "success",
    "/trusted-member",
  );

  return { success: true };
}

export async function getUserAccessControl(
  userId: string,
): Promise<{ data?: UserAccessControlResult; error?: string }> {
  "use server";
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  if (!userId) {
    return { error: "User ID is required" };
  }

  const [{ data: profile }, authResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", userId)
      .maybeSingle(),
    supabase.auth.admin.getUserById(userId),
  ]);

  const targetAuthUser = authResult.data.user;
  if (authResult.error || !targetAuthUser) {
    return { error: "User not found" };
  }

  const access = readAccountAccessFromMetadata(targetAuthUser.app_metadata);
  const bannedUntil = readBannedUntil(targetAuthUser);

  return {
    data: {
      id: userId,
      email: targetAuthUser.email ?? profile?.email ?? null,
      fullName: profile?.full_name ?? null,
      username: profile?.username ?? null,
      bannedUntil,
      access,
    },
  };
}
