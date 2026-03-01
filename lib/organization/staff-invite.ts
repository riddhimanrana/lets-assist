import { getAdminClient } from "@/lib/supabase/admin";

export type StaffInviteOutcome =
  | { status: "success"; orgUsername: string }
  | { status: "invalid_token"; orgUsername: string }
  | { status: "expired_token"; orgUsername: string }
  | { status: "org_not_found"; orgUsername: string }
  | { status: "error"; orgUsername: string };

type AdminClient = ReturnType<typeof getAdminClient>;

interface ApplyStaffInviteParams {
  userId: string;
  staffToken: string;
  orgUsername: string;
}

interface ApplyStaffInviteOptions {
  adminClient?: AdminClient;
  now?: Date;
}

export async function applyStaffInviteForUser(
  params: ApplyStaffInviteParams,
  options: ApplyStaffInviteOptions = {},
): Promise<StaffInviteOutcome> {
  const { userId, staffToken, orgUsername } = params;
  const adminClient = options.adminClient ?? getAdminClient();
  const now = options.now ?? new Date();

  try {
    const { data: org, error: orgError } = await adminClient
      .from("organizations")
      .select("id, staff_join_token, staff_join_token_expires_at")
      .eq("username", orgUsername)
      .single();

    if (orgError || !org) {
      return { status: "org_not_found", orgUsername };
    }

    if (org.staff_join_token !== staffToken) {
      return { status: "invalid_token", orgUsername };
    }

    const expiresAt = org.staff_join_token_expires_at;
    if (!expiresAt || new Date(expiresAt).getTime() < now.getTime()) {
      return { status: "expired_token", orgUsername };
    }

    const { error: memberError } = await adminClient
      .from("organization_members")
      .insert({
        organization_id: org.id,
        user_id: userId,
        role: "staff",
        joined_at: now.toISOString(),
      });

    if (!memberError) {
      return { status: "success", orgUsername };
    }

    if (memberError.code !== "23505") {
      console.error(`Error adding staff member to org ${org.id}:`, memberError);
      return { status: "error", orgUsername };
    }

    // Duplicate membership exists: upgrade member -> staff, but never downgrade admin/staff
    const { data: existingMembership, error: queryError } = await adminClient
      .from("organization_members")
      .select("role")
      .eq("organization_id", org.id)
      .eq("user_id", userId)
      .single();

    if (queryError || !existingMembership) {
      console.error(`Error querying existing membership for org ${org.id}:`, queryError);
      return { status: "error", orgUsername };
    }

    if (existingMembership.role === "member") {
      const { error: updateError } = await adminClient
        .from("organization_members")
        .update({ role: "staff" })
        .eq("organization_id", org.id)
        .eq("user_id", userId);

      if (updateError) {
        console.error(`Error updating membership role to staff for org ${org.id}:`, updateError);
        return { status: "error", orgUsername };
      }
    }

    return { status: "success", orgUsername };
  } catch (error) {
    console.error("Error processing staff invite:", error);
    return { status: "error", orgUsername };
  }
}