"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  publishVolunteerHours,
  resendCertificateEmails,
  sendCorrectedCertificateEmail,
} from "./actions";
import {
  correctionDeliveryRequest,
  hoursPublicationEntries,
  type AttendanceHoursSignup,
} from "./useHoursAttendance";
import type { HoursSession } from "./useHoursSessions";

export function useHoursPublishing({
  projectId,
  sessions,
  setNotice,
}: {
  projectId: string;
  sessions: HoursSession[];
  setNotice: (notice: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  const running = useRef(false);
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const deliveryRequests = useRef(new Map<string, string>());
  const confirmSession =
    sessions.find((session) => session.id === confirmSessionId) ?? null;

  const run = async (key: string, operation: () => Promise<void>) => {
    if (running.current || isRefreshing) return;
    running.current = true;
    setBusy(key);
    try {
      await operation();
    } catch {
      toast.error(
        "The request could not be completed. Retry to check its saved result.",
      );
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  const refresh = () => startRefresh(() => router.refresh());

  const publish = (session: HoursSession) =>
    run(session.id, async () => {
      if (!session.window || session.window.endsAt > Date.now()) {
        toast.error("Hours can be published after this session ends.");
        return;
      }
      const entries = hoursPublicationEntries(
        session.attendees,
        session.window,
      );
      if (!entries.length) {
        toast.error("No reviewed attendance is ready to publish.");
        return;
      }
      const result = await publishVolunteerHours(
        projectId,
        session.scheduleId,
        entries,
      );
      if (!result.success) {
        toast.error(result.error || "Hours could not be published.");
        return;
      }
      setNotice(
        `Hours published. ${result.certificatesCreated ?? 0} certificates created; ${result.emailsSent ?? 0} emails accepted for delivery.${result.emailErrors?.length ? ` Delivery needs attention: ${result.emailErrors.join(" ")}` : ""}`,
      );
      setConfirmSessionId(null);
      refresh();
    });

  const resend = (session: HoursSession) =>
    run(session.id, async () => {
      const result = await resendCertificateEmails(
        projectId,
        session.scheduleId,
      );
      if (!result.success) {
        toast.error(result.error || "Could not retry delivery.");
        return;
      }
      setNotice(
        `${result.emailsSent ?? 0} certificate emails accepted for delivery.${result.emailErrors?.length ? ` Delivery needs attention: ${result.emailErrors.join(" ")}` : ""}`,
      );
    });

  const sendCorrection = (
    certificate: AttendanceHoursSignup["certificates"][number],
  ) =>
    run(`${certificate.id}:${certificate.attendance_revision}`, async () => {
      const requestId = correctionDeliveryRequest(
        deliveryRequests.current,
        certificate,
      );
      const result = await sendCorrectedCertificateEmail(
        projectId,
        certificate.id,
        certificate.attendance_revision,
        requestId,
      );
      if (!result.success) {
        toast.error(
          result.error || "The corrected certificate could not be sent.",
        );
        return;
      }
      setNotice(
        result.emailErrors?.length
          ? `Updated certificate saved. Delivery needs attention: ${result.emailErrors.join(" ")}`
          : "Updated certificate accepted for delivery. Repeating this request will not send another copy of the same revision.",
      );
    });

  return {
    busy,
    isRefreshing,
    confirmSession,
    setConfirmSessionId,
    publish,
    resend,
    sendCorrection,
  };
}
export type HoursPublishing = ReturnType<typeof useHoursPublishing>;
