"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import {
  createAttendancePresence,
  getAttendancePresenceCookieName,
  getAttendancePresenceCookieOptions,
  getAttendanceScheduleWindow,
  verifyAttendanceQrChallenge,
} from "@/lib/attendance/challenge";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Project } from "@/types";

const redeemSchema = z.object({
  projectId: z.string().uuid(),
  challenge: z.string().min(32).max(4_096),
});

export async function redeemAttendanceChallenge(
  projectId: string,
  challenge: string,
): Promise<
  | {
      success: true;
      projectId: string;
      sessionId: string;
      scheduleId: string;
    }
  | { success: false; error: string }
> {
  const parsed = redeemSchema.safeParse({ projectId, challenge });
  if (!parsed.success) {
    return { success: false, error: "Invalid attendance link." };
  }

  const verifiedChallenge = verifyAttendanceQrChallenge(parsed.data.challenge, {
    projectId: parsed.data.projectId,
  });
  if (!verifiedChallenge.ok) {
    return {
      success: false,
      error:
        verifiedChallenge.reason === "not_active"
          ? "This QR code is not active yet. Try again within two hours of the session."
          : "This attendance QR code is invalid or expired.",
    };
  }

  const admin = getAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("*")
    .eq("id", verifiedChallenge.payload.projectId)
    .maybeSingle();

  if (projectError || !project) {
    return { success: false, error: "Project not found." };
  }

  const typedProject = project as Project;
  if (
    typedProject.status === "cancelled" ||
    typedProject.verification_method !== "qr-code" ||
    !typedProject.session_id ||
    typedProject.session_id !== verifiedChallenge.payload.sessionId
  ) {
    return {
      success: false,
      error: "This attendance QR code is no longer valid.",
    };
  }

  const scheduleWindow = getAttendanceScheduleWindow(
    typedProject,
    verifiedChallenge.payload.scheduleId,
  );
  const now = Date.now();
  if (
    !scheduleWindow ||
    now < scheduleWindow.startsAt - 2 * 60 * 60 * 1000 ||
    now >= scheduleWindow.endsAt
  ) {
    return { success: false, error: "This attendance session is not active." };
  }

  const { token: presenceToken } = createAttendancePresence(
    verifiedChallenge.payload,
  );
  const cookieStore = await cookies();
  cookieStore.set(
    getAttendancePresenceCookieName(typedProject.id),
    presenceToken,
    getAttendancePresenceCookieOptions(typedProject.id),
  );

  return {
    success: true,
    projectId: typedProject.id,
    sessionId: typedProject.session_id,
    scheduleId: scheduleWindow.scheduleId,
  };
}
