"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Project } from "@/types";
import { QRCode } from "react-qrcode-logo";
import { Button } from "@/components/ui/button";
import {
  differenceInHours,
  parseISO,
  format,
  isBefore,
  subHours,
} from "date-fns";
import { Printer, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatTimeTo12Hour } from "@/lib/utils";
import { useReactToPrint } from "react-to-print";
import { cn } from "@/lib/utils";
import { getMultiDaySlotDisplayName } from "@/utils/project";
import { createProjectAttendanceQrChallenges } from "./attendance/qr-actions";

// Remove the complex token generation function - we'll use cookies/sessions instead

interface ProjectQRCodeModalProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SessionInfo {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  isVisible: boolean;
  hoursUntilStart: number;
  qrUrl: string;
}

export function ProjectQRCodeModal({
  project,
  open,
  onOpenChange,
}: ProjectQRCodeModalProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [attendanceChallenges, setAttendanceChallenges] = useState<
    Record<string, string>
  >({});
  const printRef = useRef<HTMLDivElement>(null);
  const [selectedQRCode, setSelectedQRCode] = useState<SessionInfo | null>(
    null,
  );

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `QR Code – ${project.title}`,
  });

  useEffect(() => {
    if (!open) {
      setAttendanceChallenges({});
      return;
    }

    let cancelled = false;
    void createProjectAttendanceQrChallenges(project.id).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setAttendanceChallenges(result.challenges);
      } else {
        safeConsole.error(
          "Failed to create secure attendance QR codes:",
          result.error,
        );
        setAttendanceChallenges({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  // Process project schedule to get all sessions with their availability
  useEffect(() => {
    if (project) {
      const now = new Date();
      const processedSessions: SessionInfo[] = [];

      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";
      const buildQrUrl = (scheduleId: string) => {
        const challenge = attendanceChallenges[scheduleId];
        if (!challenge) return "";
        return `${siteUrl}/attend/${project.id}/prepare?challenge=${encodeURIComponent(challenge)}`;
      };

      const calculateAvailability = (
        date: string,
        startTime: string,
        endTime: string,
      ) => {
        const startDate = parseISO(`${date}T${startTime}`);
        const endDate = parseISO(`${date}T${endTime}`); // Parse end time
        const hoursUntilStart = differenceInHours(startDate, now);

        // QR code shows 1 week before, but only functional 2 hours before
        // isVisible: true when within 7 days before start
        // isAvailable (functional): true when within 2 hours before start AND before end time
        const isVisible = hoursUntilStart <= 168; // 7 days = 168 hours
        const isFunctional = hoursUntilStart <= 2;
        const isNotEnded = isBefore(now, endDate); // Check if 'now' is before 'endDate'

        return {
          isAvailable: isFunctional && isNotEnded, // Only functional within 2 hours
          isVisible: isVisible && isNotEnded, // Visible within 7 days
          hoursUntilStart,
        };
      };

      if (project.event_type === "oneTime" && project.schedule.oneTime) {
        const { date, startTime, endTime } = project.schedule.oneTime;
        const availability = calculateAvailability(date, startTime, endTime);

        processedSessions.push({
          id: "oneTime",
          name: "Main event",
          date,
          startTime,
          endTime,
          isAvailable: availability.isAvailable,
          isVisible: availability.isVisible,
          hoursUntilStart: availability.hoursUntilStart,
          qrUrl: buildQrUrl("oneTime"),
        });
      } else if (
        project.event_type === "multiDay" &&
        project.schedule.multiDay
      ) {
        project.schedule.multiDay.forEach((day, dayIndex) => {
          day.slots.forEach((slot, slotIndex) => {
            const scheduleId = `${day.date}-${dayIndex}-${slotIndex}`;
            const availability = calculateAvailability(
              day.date,
              slot.startTime,
              slot.endTime,
            );

            processedSessions.push({
              id: scheduleId,
              name: getMultiDaySlotDisplayName(slot, slotIndex),
              date: day.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              isAvailable: availability.isAvailable,
              isVisible: availability.isVisible,
              hoursUntilStart: availability.hoursUntilStart,
              qrUrl: buildQrUrl(scheduleId),
            });
          });
        });
      } else if (
        project.event_type === "sameDayMultiArea" &&
        project.schedule.sameDayMultiArea
      ) {
        const { date, roles } = project.schedule.sameDayMultiArea;

        roles.forEach((role) => {
          const availability = calculateAvailability(
            date,
            role.startTime,
            role.endTime,
          );

          processedSessions.push({
            id: role.name,
            name: role.name,
            date,
            startTime: role.startTime,
            endTime: role.endTime,
            isAvailable: availability.isAvailable,
            isVisible: availability.isVisible,
            hoursUntilStart: availability.hoursUntilStart,
            qrUrl: buildQrUrl(role.name),
          });
        });
      }

      setSessions(processedSessions);

      // Set active tab to first visible session if any
      const visibleSessions = processedSessions.filter((s) => s.isVisible);
      setSelectedQRCode((current) =>
        current
          ? (processedSessions.find((session) => session.id === current.id) ??
            visibleSessions[0] ??
            null)
          : (visibleSessions[0] ?? null),
      );
    }
  }, [project, open, attendanceChallenges]);

  // Reset modal state when it closes
  useEffect(() => {
    if (!open) {
      setSelectedQRCode(null);
    }
  }, [open]);

  const renderAvailabilityBadge = (session: SessionInfo) => {
    const now = new Date();
    const startDate = parseISO(`${session.date}T${session.startTime}`);

    if (session.isAvailable) {
      return <Badge variant="success">Scannable now</Badge>;
    } else if (session.isVisible && !session.isAvailable) {
      // Visible but not yet scannable: within 7 days, more than 2 hours out.
      const hoursUntilScannable = differenceInHours(
        subHours(startDate, 2),
        now,
      );
      const days = Math.floor(hoursUntilScannable / 24);
      const hours = hoursUntilScannable % 24;
      let scannableIn = "Scannable in ";
      if (days > 0) scannableIn += `${days} day${days > 1 ? "s" : ""} `;
      if (hours > 0) scannableIn += `${hours} hour${hours > 1 ? "s" : ""}`;
      if (days === 0 && hours === 0) scannableIn = "Scannable soon";
      return <Badge variant="info">{scannableIn.trim()}</Badge>;
    } else if (!session.isVisible && isBefore(now, startDate)) {
      // Not yet visible: more than 7 days before start.
      const hoursUntilVisible = differenceInHours(
        subHours(startDate, 168),
        now,
      );
      const days = Math.floor(hoursUntilVisible / 24);
      const hours = hoursUntilVisible % 24;
      let visibleIn = "Visible in ";
      if (days > 0) visibleIn += `${days} day${days > 1 ? "s" : ""} `;
      if (hours > 0) visibleIn += `${hours} hour${hours > 1 ? "s" : ""}`;
      if (days === 0 && hours === 0) visibleIn = "Visible soon";
      return <Badge variant="secondary">{visibleIn.trim()}</Badge>;
    } else {
      return <Badge variant="secondary">Session ended</Badge>;
    }
  };

  const canPrint = Boolean(selectedQRCode?.isAvailable && selectedQRCode.qrUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>QR code check-in</DialogTitle>
          <DialogDescription>
            QR codes become visible 1 week before each session starts. They can
            be scanned 2 hours before for check-in, and expire when the session
            ends.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          {sessions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No sessions found for this project
            </p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedQRCode(session)}
                    aria-pressed={selectedQRCode?.id === session.id}
                    className={cn(
                      "hover:bg-muted/50 focus-visible:ring-ring/50 grid w-full gap-1 px-3 py-2.5 text-left outline-none focus-visible:ring-[3px]",
                      selectedQRCode?.id === session.id && "bg-muted",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium wrap-break-word">
                        {session.name}
                      </span>
                      {renderAvailabilityBadge(session)}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {format(parseISO(session.date), "EEEE, MMM d")} ·{" "}
                      {formatTimeTo12Hour(session.startTime)} -{" "}
                      {formatTimeTo12Hour(session.endTime)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-start justify-center">
            {selectedQRCode ? (
              <div
                ref={printRef}
                className={cn(
                  "rounded-xl border p-3",
                  canPrint ? "bg-white" : "bg-muted/50",
                )}
              >
                {canPrint ? (
                  <QRCode
                    value={selectedQRCode.qrUrl}
                    size={180}
                    logoImage="/logo.png"
                    qrStyle="dots"
                    eyeRadius={{ outer: 8, inner: 1 }}
                    fgColor="#000000"
                    bgColor="#FFFFFF"
                    removeQrCodeBehindLogo
                    logoPadding={2}
                    ecLevel="L"
                  />
                ) : (
                  <div className="text-muted-foreground flex size-45 flex-col items-center justify-center gap-3 p-4 text-center">
                    <Lock className="size-6" aria-hidden="true" />
                    <p className="text-sm">
                      {selectedQRCode.isAvailable && !selectedQRCode.qrUrl
                        ? "Securing QR code..."
                        : !selectedQRCode.isVisible
                          ? "Will be visible 1 week before"
                          : selectedQRCode.isVisible &&
                              !selectedQRCode.isAvailable
                            ? "Visible but scannable 2 hours before"
                            : "Session ended"}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground flex size-45 items-center justify-center rounded-xl border border-dashed p-4 text-center text-sm">
                Select a session to preview QR
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handlePrint();
            }}
            disabled={!canPrint}
          >
            <Printer data-icon="inline-start" aria-hidden="true" />
            Print QR code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
