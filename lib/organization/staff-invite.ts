import { getAdminClient } from "@/lib/supabase/admin";
import { type StaffInviteOutcome } from "@/lib/organization/staff-invite-outcome";

export type { StaffInviteOutcome } from "@/lib/organization/staff-invite-outcome";

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

type StaffInviteRedemptionRow = {
  status: StaffInviteOutcome["status"];
  org_username: string;
  org_name: string | null;
};

export async function applyStaffInviteForUser(
  params: ApplyStaffInviteParams,
  options: ApplyStaffInviteOptions = {},
): Promise<StaffInviteOutcome> {
  const { userId, staffToken, orgUsername } = params;
  const adminClient = options.adminClient ?? getAdminClient();
  const now = options.now ?? new Date();

  try {
    const { data, error } = await adminClient.rpc("redeem_staff_join_token", {
      p_user_id: userId,
      p_staff_token: staffToken,
      p_org_username: orgUsername,
      p_redeemed_at: now.toISOString(),
    });
    if (error) {
      console.error("Error redeeming staff invite:", error);
      return { status: "error", orgUsername };
    }

    const row = (
      Array.isArray(data) ? data[0] : data
    ) as StaffInviteRedemptionRow | null;
    if (
      !row ||
      ![
        "success",
        "invalid_token",
        "expired_token",
        "org_not_found",
        "error",
      ].includes(row.status)
    ) {
      return { status: "error", orgUsername };
    }

    return {
      status: row.status,
      orgUsername: row.org_username || orgUsername,
      orgName: row.org_name,
    };
  } catch (error) {
    console.error("Error processing staff invite:", error);
    return { status: "error", orgUsername };
  }
}
