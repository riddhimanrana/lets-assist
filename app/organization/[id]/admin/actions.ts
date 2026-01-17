"use server";

import { createClient } from "@/utils/supabase/server";

// Get member directory
export async function getOrganizationMembers(organizationId: string) {
  const supabase = await createClient();

  try {
    const { data: members } = await supabase
      .from("organization_members")
      .select(
        `
        id,
        role,
        joined_at,
        status,
        last_activity_at,
        can_verify_hours,
        profiles(
          id,
          full_name,
          avatar_url,
          email
        )
      `
      )
      .eq("organization_id", organizationId)
      .eq("is_visible", true)
      .order("role", { ascending: false });


    return (((members || []) as unknown) as Array<{
      id: string;
      role: string;
      joined_at: string;
      status: string;
      last_activity_at: string | null;
      can_verify_hours: boolean;
      profiles: { id: string; full_name: string; email: string; avatar_url: string | null } | null;
    }>).map((member) => ({
      id: member.id,
      userId: member.profiles?.id,
      name: member.profiles?.full_name,
      email: member.profiles?.email,
      avatar: member.profiles?.avatar_url,
      role: member.role,
      status: member.status,
      joinedAt: member.joined_at,
      lastActivityAt: member.last_activity_at,
      canVerifyHours: member.can_verify_hours,
    }));
  } catch (error) {
    console.error("Error fetching organization members:", error);
    return [];
  }
}
