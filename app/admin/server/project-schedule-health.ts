"use server";

import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  parseProjectScheduleHealth,
  type ProjectScheduleHealthResult,
} from "@/lib/admin/project-schedule-health";
import { checkSuperAdmin } from "./auth";

export async function getProjectScheduleHealth(): Promise<ProjectScheduleHealthResult> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) return { error: "Super admin access required." };
  try {
    const { data, error } = await getAdminClient().rpc(
      "get_project_schedule_health",
      {
        p_actor_id: userId,
        p_limit: 25,
      },
    );
    if (error)
      return {
        error:
          "Schedule health is unavailable. No clear status can be confirmed.",
      };
    return parseProjectScheduleHealth(data);
  } catch {
    return {
      error:
        "Schedule health is unavailable. No clear status can be confirmed.",
    };
  }
}
