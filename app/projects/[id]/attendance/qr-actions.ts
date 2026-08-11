"use server";

import { z } from "zod";

import {
  createAttendanceQrChallenge,
  getAttendanceScheduleWindow,
  listAttendanceScheduleIds,
} from "@/lib/attendance/challenge";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Project } from "@/types";

const projectIdSchema = z.string().uuid();

type AttendanceQrChallengeResult =
  | { success: true; challenges: Record<string, string> }
  | { success: false; error: string };

export async function createProjectAttendanceQrChallenges(
  projectId: string,
): Promise<AttendanceQrChallengeResult> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) {
    return { success: false, error: "Invalid project." };
  }

  const { user } = await getAuthUser({ sensitive: true });
  if (!user) {
    return { success: false, error: "Authentication required." };
  }

  const admin = getAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("*")
    .eq("id", parsedProjectId.data)
    .maybeSingle();

  if (projectError || !project) {
    return { success: false, error: "Project not found." };
  }

  const typedProject = project as Project & {
    can_be_managed_by_staff?: boolean | null;
  };
  let canManage = typedProject.creator_id === user.id;

  if (!canManage && typedProject.organization_id) {
    const { data: membership } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", typedProject.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    canManage =
      membership?.role === "admin" ||
      (membership?.role === "staff" &&
        typedProject.can_be_managed_by_staff === true);
  }

  if (!canManage) {
    return { success: false, error: "You cannot manage this project." };
  }

  if (
    typedProject.verification_method !== "qr-code" ||
    typedProject.status === "cancelled" ||
    !typedProject.session_id
  ) {
    return {
      success: false,
      error: "QR attendance is not available for this project.",
    };
  }

  const challenges: Record<string, string> = {};
  const now = Date.now();
  for (const scheduleId of listAttendanceScheduleIds(typedProject)) {
    const window = getAttendanceScheduleWindow(typedProject, scheduleId);
    if (
      !window ||
      now < window.startsAt - 2 * 60 * 60 * 1000 ||
      now >= window.endsAt
    ) {
      continue;
    }

    const { token } = createAttendanceQrChallenge({
      projectId: typedProject.id,
      sessionId: typedProject.session_id,
      scheduleId: window.scheduleId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    challenges[window.scheduleId] = token;
  }

  return { success: true, challenges };
}
