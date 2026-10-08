"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AttendanceInterval } from "@/lib/projects/paper-signup/intervals";
import {
  correctVolunteerAttendance,
  recordVolunteerAttendance,
} from "./actions";
import {
  canSaveHoursEdit,
  certificateOf,
  savedDraft,
  type AttendanceHoursSignup,
} from "./useHoursAttendance";

type HoursEditor = {
  signup: AttendanceHoursSignup;
  intervals: AttendanceInterval[];
  requestId: string;
};

export function useHoursEdits({
  projectId,
  signups,
  setNotice,
}: {
  projectId: string;
  signups: AttendanceHoursSignup[];
  setNotice: (notice: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<HoursEditor | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  const saving = useRef(false);
  const open = (signup: AttendanceHoursSignup) =>
    setEditing({
      signup,
      intervals: savedDraft(signup).intervals,
      requestId: crypto.randomUUID(),
    });
  const close = () => {
    if (!saving.current) setEditing(null);
  };
  const save = async (
    intervals: AttendanceInterval[],
    reason: string,
  ): Promise<boolean> => {
    if (!editing || saving.current) return false;
    const { signup, requestId } = editing;
    const correcting = Boolean(certificateOf(signup));
    if (
      !canSaveHoursEdit(
        signups.find((row) => row.id === signup.id),
        signup.attendance_revision,
        correcting,
      )
    ) {
      toast.error(
        "Attendance changed. Close this editor and review the latest record before saving.",
      );
      return false;
    }
    saving.current = true;
    try {
      const action = correcting
        ? correctVolunteerAttendance
        : recordVolunteerAttendance;
      const result = await action(
        projectId,
        signup.id,
        signup.attendance_revision,
        correcting ? reason : reason || "Coordinator reviewed attendance",
        intervals,
        requestId,
      );
      if (!result.success) {
        toast.error(result.error || "Attendance could not be saved.");
        return false;
      }
      setNotice(
        correcting
          ? "Correction saved. The existing certificate now shows the corrected hours. No email was sent."
          : "Attendance saved. If this session is already published, its certificate is available. Otherwise publish the session to award hours.",
      );
      startRefresh(() => router.refresh());
      return true;
    } catch {
      toast.error(
        "The attendance result could not be confirmed. Retry this save to check its saved result.",
      );
      return false;
    } finally {
      saving.current = false;
    }
  };
  return { editing, open, close, save, isRefreshing };
}
export type HoursEdits = ReturnType<typeof useHoursEdits>;
