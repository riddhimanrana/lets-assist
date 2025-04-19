"use client";

import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Project, EventType } from "@/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QRCode } from "react-qrcode-logo";
import { Button } from "@/components/ui/button";
import { differenceInHours, parseISO, format } from "date-fns";
import { Printer, Calendar, Clock, Info, Lock, Users, QrCode as QrIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatTimeTo12Hour } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { useReactToPrint } from "react-to-print";
import Image from "next/image";

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
  hoursUntilStart: number;
  qrUrl: string;
}

export function ProjectQRCodeModal({ project, open, onOpenChange }: ProjectQRCodeModalProps) {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const printRef = useRef<HTMLDivElement>(null);
  const [selectedQRCode, setSelectedQRCode] = useState<SessionInfo | null>(null);
  const qrCodeSize = 210;
  
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `QR Code – ${project.title}`,
  });

  // Process project schedule to get all sessions with their availability
  useEffect(() => {
    if (project) {
      const now = new Date();
      const processedSessions: SessionInfo[] = [];

      if (project.event_type === "oneTime" && project.schedule.oneTime) {
        const { date, startTime, endTime } = project.schedule.oneTime;
        const startDate = parseISO(`${date}T${startTime}`);
        const hoursUntilStart = differenceInHours(startDate, now);
        
        processedSessions.push({
          id: "oneTime",
          name: "Main Event",
          date,
          startTime,
          endTime,
          isAvailable: hoursUntilStart <= 24 && hoursUntilStart >= -2, // Available 24h before until 2h after start
          hoursUntilStart,
          qrUrl: `lets-assist.com/attend/${project.id}?session=oneTime`
        });
      } 
      else if (project.event_type === "multiDay" && project.schedule.multiDay) {
        project.schedule.multiDay.forEach((day, dayIndex) => {
          day.slots.forEach((slot, slotIndex) => {
            const scheduleId = `${day.date}-${slotIndex}`;
            const startDate = parseISO(`${day.date}T${slot.startTime}`);
            const hoursUntilStart = differenceInHours(startDate, now);
            
            processedSessions.push({
              id: scheduleId,
              name: `Day ${dayIndex + 1}, Slot ${slotIndex + 1}`,
              date: day.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              isAvailable: hoursUntilStart <= 24 && hoursUntilStart >= -2,
              hoursUntilStart,
              qrUrl: `lets-assist.com/attend/${project.id}?session=${scheduleId}`
            });
          });
        });
      }
      else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
        const { date, roles } = project.schedule.sameDayMultiArea;
        
        roles.forEach((role) => {
          const startDate = parseISO(`${date}T${role.startTime}`);
          const hoursUntilStart = differenceInHours(startDate, now);
          
          processedSessions.push({
            id: role.name,
            name: role.name,
            date,
            startTime: role.startTime,
            endTime: role.endTime,
            isAvailable: hoursUntilStart <= 24 && hoursUntilStart >= -2,
            hoursUntilStart,
            qrUrl: `lets-assist.com/attend/${project.id}?session=${role.name}`
          });
        });
      }

      setSessions(processedSessions);
      
      // Set active tab to first available session if any
      const availableSessions = processedSessions.filter(s => s.isAvailable);
      if (availableSessions.length > 0 && !selectedQRCode) {
        setSelectedQRCode(availableSessions[0]);
      }
    }
  }, [project, open]);

  // Reset modal state when it closes
  useEffect(() => {
    if (!open) {
      setSelectedQRCode(null);
    }
  }, [open]);

  const renderAvailabilityBadge = (session: SessionInfo) => {
    if (session.isAvailable) {
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Available Now</Badge>;
    } else if (session.hoursUntilStart > 24) {
      return <Badge variant="outline" className="text-muted-foreground">
        Available in {Math.ceil(session.hoursUntilStart - 24)} hours
      </Badge>;
    } else {
      return <Badge variant="destructive">No Longer Available</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">QR Code Check-In</DialogTitle>
        </DialogHeader>
        
        <div className="grid md:grid-cols-2 gap-6 mt-4">
          {/* Left side - Session list */}
          <div className="space-y-4 border-r pr-4">
            <h3 className="font-medium text-lg">Project Sessions</h3>
            <p className="text-sm text-muted-foreground mb-4">
              QR codes become available 24 hours before each session starts and remain available for 2 hours after the session starts.
            </p>
            
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
              {sessions.map((session) => (
                <Card 
                  key={session.id}
                  className={`cursor-pointer hover:bg-muted/50 transition-colors ${selectedQRCode?.id === session.id ? 'border-primary' : ''}`}
                  onClick={() => setSelectedQRCode(session)}
                >
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium">{session.name}</h4>
                      {renderAvailabilityBadge(session)}
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        <span>{format(parseISO(session.date), "EEEE, MMMM d, yyyy")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span>{formatTimeTo12Hour(session.startTime)} - {formatTimeTo12Hour(session.endTime)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {sessions.length === 0 && (
                <div className="text-center p-4 text-muted-foreground">
                  No sessions found for this project
                </div>
              )}
            </div>
          </div>
          
          {/* Right side - QR code display */}
          <div className="space-y-4">
            {selectedQRCode ? (
              <>
                {/* On-screen only */}
                <div className="print:hidden flex flex-col items-center justify-center space-y-4">
                  {/* Session header */}
                  <div className="text-center mb-2">
                    <h3 className="font-semibold text-lg">{selectedQRCode.name}</h3>
                    <p className="text-muted-foreground text-sm mb-1">
                      {format(parseISO(selectedQRCode.date), "EEEE, MMMM d, yyyy")}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {formatTimeTo12Hour(selectedQRCode.startTime)} - {formatTimeTo12Hour(selectedQRCode.endTime)}
                    </p>
                  </div>
                  {/* QR code box */}
                  <div className="border p-4 rounded-xl">
                    <QRCode
                      value={selectedQRCode.qrUrl}
                      size={qrCodeSize}
                      logoImage="/logo.png"
                      qrStyle="dots"
                      eyeRadius={{ outer: 8, inner: 1 }}
                      removeQrCodeBehindLogo
                      logoPadding={2}
                      ecLevel="L"
                    />
                  </div>
                  {/* Print button */}
                  <Button
                    type="button"
                    onClick={() => { void handlePrint(); }}
                    disabled={!selectedQRCode.isAvailable}
                    className="mt-2"
                  >
                    <Printer className="mr-2 h-4 w-4" /> Print QR Code
                  </Button>
                </div>

                {/* Print-only view */}
                <div
                  ref={printRef}
                  className="hidden print:flex flex-col items-center justify-center w-full h-screen p-0 bg-white"
                  style={{ pageBreakInside: 'avoid' }}
                >
                  <h1 className="text-4xl font-bold mb-4">{project.title}</h1>
                  <h2 className="text-3xl font-semibold mb-2">{selectedQRCode.name}</h2>
                  <p className="text-2xl mb-6 text-center">
                    {format(parseISO(selectedQRCode.date), "EEEE, MMMM d, yyyy")}<br/>
                    {formatTimeTo12Hour(selectedQRCode.startTime)} - {formatTimeTo12Hour(selectedQRCode.endTime)}
                  </p>
                  <QRCode
                    value={selectedQRCode.qrUrl}
                    size={400}
                    logoImage="/logo.png"
                    qrStyle="dots"
                    eyeRadius={{ outer: 8, inner: 1 }}
                    removeQrCodeBehindLogo
                    logoPadding={4}
                    ecLevel="H"
                  />
                  <p className="text-xl mt-6 text-center">
                    Scan this code to confirm your attendance.
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="text-center p-8">
                  <QrIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-lg mb-2">Select a session</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a project session from the left to view its QR code
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
