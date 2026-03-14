import type { Signup } from "@/types";

export const VOLUNTEER_DASHBOARD_SIGNUP_STATUSES = [
  "approved",
  "attended",
  "pending",
] as const satisfies readonly Signup["status"][];

type VolunteerDashboardSignup = Pick<
  Signup,
  "id" | "schedule_id" | "status" | "check_in_time" | "check_out_time" | "created_at"
>;

export function buildVolunteerDashboardSlotState(
  signups: VolunteerDashboardSignup[],
) {
  const userSignups: Record<string, boolean> = {};
  const attendedSlots: Record<string, boolean> = {};
  const pendingSlots: Record<string, boolean> = {};

  for (const signup of signups) {
    userSignups[signup.schedule_id] = true;

    if (signup.status === "pending") {
      pendingSlots[signup.schedule_id] = true;
    }

    if (signup.check_in_time) {
      attendedSlots[signup.schedule_id] = true;
    }
  }

  return { userSignups, attendedSlots, pendingSlots };
}