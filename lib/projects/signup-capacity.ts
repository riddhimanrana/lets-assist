import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";

export type AnonymousSignupConfirmationResult = {
  outcome: string;
  approvedCount: number;
  blockedProjectId: string | null;
  blockedScheduleId: string | null;
};

/**
 * Confirms an anonymous profile and promotes all of its pending signups in one
 * capacity-locked database transaction.
 */
export async function confirmAnonymousSignupWithCapacity(
  anonymousSignupId: string,
): Promise<
  | { data: AnonymousSignupConfirmationResult; error: null }
  | { data: null; error: unknown }
> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc(
    "confirm_anonymous_signup_with_capacity",
    { p_anonymous_id: anonymousSignupId },
  );

  if (error) {
    return { data: null, error };
  }

  type RpcRow = {
    outcome: string;
    approved_count: number;
    blocked_project_id: string | null;
    blocked_schedule_id: string | null;
  };
  const row = (data as RpcRow[] | null)?.[0] ?? null;
  if (!row) {
    return {
      data: null,
      error: new Error("Anonymous signup confirmation returned no result"),
    };
  }

  return {
    data: {
      outcome: row.outcome,
      approvedCount: row.approved_count,
      blockedProjectId: row.blocked_project_id,
      blockedScheduleId: row.blocked_schedule_id,
    },
    error: null,
  };
}
