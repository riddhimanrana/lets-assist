import "server-only";
import type { getAdminClient } from "@/lib/supabase/admin";
import type { AttendanceInterval } from "./paper-signup/intervals";

import { readAllExportPages } from "./attendance-export-pagination";
const SIGNUP_CHUNK_SIZE = 100;
const MAX_INTERVALS_PER_SIGNUP = 50;

/** Only pass signup IDs read through the current volunteer's authenticated query. */
export async function loadVolunteerAttendanceIntervals(
  admin: ReturnType<typeof getAdminClient>,
  projectId: string,
  authorizedSignupIds: string[],
) {
  const result: Record<string, AttendanceInterval[]> = {};
  const signupIds = [...new Set(authorizedSignupIds)];
  for (let start = 0; start < signupIds.length; start += SIGNUP_CHUNK_SIZE) {
    const ids = signupIds.slice(start, start + SIGNUP_CHUNK_SIZE);
    ids.forEach((id) => {
      result[id] = [];
    });
    const maximum = ids.length * MAX_INTERVALS_PER_SIGNUP;
    const intervals = await readAllExportPages<{
      id: string;
      signup_id: string;
      check_in_time: string;
      check_out_time: string;
    }>(async (after, limit) => {
      let query = admin
        .from("project_attendance_intervals")
        .select("id,signup_id,check_in_time,check_out_time")
        .eq("project_id", projectId)
        .in("signup_id", ids)
        .order("id", { ascending: true })
        .limit(limit);
      if (after) query = query.gt("id", after);
      return await query;
    }, maximum).catch(() => {
      throw new Error("Could not load volunteer attendance intervals.");
    });
    for (const interval of intervals) {
      result[interval.signup_id].push({
        checkIn: interval.check_in_time,
        checkOut: interval.check_out_time,
      });
    }
  }
  return result;
}
