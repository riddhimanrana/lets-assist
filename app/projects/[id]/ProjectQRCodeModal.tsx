"use client";

import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Project } from "@/types";
import { QRCode } from "react-qrcode-logo";
import { Button } from "@/components/ui/button";
import { differenceInHours, parseISO, format, isBefore, subHours } from "date-fns";
import { Printer, Clock, Lock, QrCode as QrIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatTimeTo12Hour } from "@/lib/utils";
import { useReactToPrint } from "react-to-print";
import { cn } from "@/lib/utils";
import { getMultiDaySlotDisplayName } from "@/utils/project";

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

export function ProjectQRCodeModal({ project, open, onOpenChange }: ProjectQRCodeModalProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const printRef = useRef<HTMLDivElement>(null);
  const [selectedQRCode, setSelectedQRCode] = useState<SessionInfo | null>(null);
  
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `QR Code – ${project.title}`,
  });

  // Process project schedule to get all sessions with their availability
  useEffect(() => {
    if (project) {
      const now = new Date();
      const processedSessions: SessionInfo[] = [];

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lets-assist.com';

      const calculateAvailability = (date: string, startTime: string, endTime: string) => {
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
          hoursUntilStart
        };
      };

      if (project.event_type === "oneTime" && project.schedule.oneTime) {
        const { date, startTime, endTime } = project.schedule.oneTime;
        const availability = calculateAvailability(date, startTime, endTime);
        
        processedSessions.push({
          id: "oneTime",
          name: "Main Event",
          date,
          startTime,
          endTime,
          isAvailable: availability.isAvailable,
          isVisible: availability.isVisible,
          hoursUntilStart: availability.hoursUntilStart,
          qrUrl: `${siteUrl}/attend/${project.id}/prepare?session=${encodeURIComponent(project.session_id || '')}&schedule=${encodeURIComponent("oneTime")}`
        });
      } 
      else if (project.event_type === "multiDay" && project.schedule.multiDay) {
        project.schedule.multiDay.forEach((day, _dayIndex) => {
          day.slots.forEach((slot, slotIndex) => {
            const scheduleId = `${day.date}-${slotIndex}`;
            const availability = calculateAvailability(day.date, slot.startTime, slot.endTime);
            
            processedSessions.push({
              id: scheduleId,
              name: getMultiDaySlotDisplayName(slot, slotIndex),
              date: day.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              isAvailable: availability.isAvailable,
              isVisible: availability.isVisible,
              hoursUntilStart: availability.hoursUntilStart,
              qrUrl: `${siteUrl}/attend/${project.id}/prepare?session=${encodeURIComponent(project.session_id || '')}&schedule=${encodeURIComponent(scheduleId)}`
            });
          });
        });
      }
      else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
        const { date, roles } = project.schedule.sameDayMultiArea;
        
        roles.forEach((role) => {
          const availability = calculateAvailability(date, role.startTime, role.endTime);
          
          processedSessions.push({
            id: role.name,
            name: role.name,
            date,
            startTime: role.startTime,
            endTime: role.endTime,
            isAvailable: availability.isAvailable,
            isVisible: availability.isVisible,
            hoursUntilStart: availability.hoursUntilStart,
            qrUrl: `${siteUrl}/attend/${project.id}/prepare?session=${encodeURIComponent(project.session_id || '')}&schedule=${encodeURIComponent(role.name)}`
          });
        });
      }

      setSessions(processedSessions);
      
      // Set active tab to first visible session if any
      const visibleSessions = processedSessions.filter(s => s.isVisible);
      if (visibleSessions.length > 0 && !selectedQRCode) {
        setSelectedQRCode(visibleSessions[0]);
      }
    }
  }, [project, open, selectedQRCode]);

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
      return <Badge variant="default">Scannable Now</Badge>;
    } else if (session.isVisible && !session.isAvailable) {
      // QR is visible but not yet scannable - within 7 days but more than 2 hours before
      const hoursUntilScannable = differenceInHours(subHours(startDate, 2), now);
      const days = Math.floor(hoursUntilScannable / 24);
      const hours = hoursUntilScannable % 24;
      let scannableIn = "Scannable in ";
      if (days > 0) scannableIn += `${days} day${days > 1 ? 's' : ''} `;
      if (hours > 0) scannableIn += `${hours} hour${hours > 1 ? 's' : ''}`;
      if (days === 0 && hours === 0) scannableIn = "Scannable soon";
      return <Badge variant="secondary">{scannableIn.trim()}</Badge>;
    } else if (!session.isVisible && isBefore(now, startDate)) {
      // Not yet visible - more than 7 days before start
      const hoursUntilVisible = differenceInHours(subHours(startDate, 168), now);
      const days = Math.floor(hoursUntilVisible / 24);
      const hours = hoursUntilVisible % 24;
      let visibleIn = "Visible in ";
      if (days > 0) visibleIn += `${days} day${days > 1 ? 's' : ''} `;
      if (hours > 0) visibleIn += `${hours} hour${hours > 1 ? 's' : ''}`;
      if (days === 0 && hours === 0) visibleIn = "Visible soon";
      return <Badge variant="outline" className="text-muted-foreground">{visibleIn.trim()}</Badge>;
    } else { // After end time
      return <Badge variant="destructive">Session Ended</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="text-lg sm:text-xl">QR Code Check-In</DialogTitle>
            <p className="text-sm text-muted-foreground">
              QR codes become visible 1 week before each session starts. They can be scanned 2 hours before for check-in,
              and expire when the session ends.
            </p>
          </DialogHeader>

          <div className="grid gap-4 px-5 pb-5 pt-5 md:grid-cols-2">
            {/* Sessions */}
            <div className="space-y-3">
              <div className="space-y-2 max-h-100 overflow-y-auto pr-2">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedQRCode(session)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition hover:bg-muted/40",
                      selectedQRCode?.id === session.id ? "border-primary bg-primary/5" : "bg-background"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{session.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(parseISO(session.date), "EEEE, MMM d")}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {renderAvailabilityBadge(session)}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {formatTimeTo12Hour(session.startTime)} - {formatTimeTo12Hour(session.endTime)}
                    </div>
                  </button>
                ))}

                {sessions.length === 0 && (
                  <div className="text-center p-4 text-muted-foreground">
                    No sessions found for this project
                  </div>
                )}
              </div>
            </div>

            {/* QR preview */}
            <div className="flex items-center justify-center">
              {selectedQRCode ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-full max-w-70 rounded-3xl border bg-muted/20 p-4 sm:p-6 flex flex-col items-center">
                    <div 
                      ref={printRef}
                      className="rounded-xl border-4 border-muted/30 bg-white p-3 shadow-inner"
                    >
                      {selectedQRCode.isAvailable ? (
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
                        <div className="w-45 h-45 flex flex-col items-center justify-center p-4 text-center">
                          <Lock className="h-10 w-10 mb-3 text-muted-foreground" />
                          <p className="text-[10px] leading-tight text-muted-foreground uppercase tracking-wider font-semibold">
                            {!selectedQRCode.isVisible
                              ? "Will be visible 1 week before"
                              : selectedQRCode.isVisible && !selectedQRCode.isAvailable
                              ? "Visible but scannable 2 hours before"
                              : "Session Ended"}
                          </p>
                        </div>
                      )}
                    </div>

                    <Button
                      type="button"
                      onClick={() => { void handlePrint(); }}
                      disabled={!selectedQRCode.isAvailable}
                      className="mt-6 w-full gap-2"
                      size="lg"
                    >
                      <Printer className="h-4 w-4" /> Print QR Code
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-70 h-87.5 rounded-3xl border border-dashed flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                  <QrIcon className="h-12 w-12 mb-4 opacity-20" />
                  <p className="text-sm">Select a session to preview QR</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
