"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Download,
  Loader2,
  CheckCircle,
  MapPin,
  Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  generateProjectICalFile,
  downloadICalFile,
  generateICalFilename,
} from "@/utils/ical";
import type { Project, Signup } from "@/types";

interface CalendarOptionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  signup?: Signup;
  mode: "creator" | "volunteer";
  showSuccessMessage?: boolean; // New prop to show success message
  onSyncSuccess?: () => void; // Callback when sync is successful
}

export default function CalendarOptionsModal({
  open,
  onOpenChange,
  project,
  signup,
  mode,
  showSuccessMessage = false,
  onSyncSuccess,
}: CalendarOptionsModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  void isSyncing;
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      if (!open) return;

      setIsCheckingConnection(true);
      try {
        const response = await fetch("/api/calendar/connection-status");
        const data = await response.json();

        setIsConnected(data.connected || false);
        setConnectedEmail(data.calendar_email || null);
      } catch (error) {
        console.error("Error checking calendar connection:", error);
        setIsConnected(false);
        setConnectedEmail(null);
      } finally {
        setIsCheckingConnection(false);
      }
    };

    checkConnection();
  }, [open]);

  const handleGoogleCalendar = async () => {
    // If already connected, sync immediately
    if (isConnected) {
      await syncToCalendar();
      return;
    }

    // Not connected, initiate OAuth flow
    setIsConnecting(true);
    try {
      // Store project page for redirect back
      const projectUrl = `/projects/${project.id}`;
      sessionStorage.setItem("calendarRedirectUrl", projectUrl);

      // Get OAuth URL
      const connectResponse = await fetch(
        `/api/calendar/google/connect?return_to=${encodeURIComponent(projectUrl)}`,
      );
      const connectData = await connectResponse.json();

      if (!connectResponse.ok) {
        throw new Error(connectData.error || "Failed to connect calendar");
      }

      // Store the signup/project ID to sync after OAuth callback
      if (mode === "volunteer" && signup) {
        sessionStorage.setItem(
          "pendingCalendarSync",
          JSON.stringify({
            type: "signup",
            signupId: signup.id,
            projectId: project.id,
            scheduleId: signup.schedule_id,
          }),
        );
      } else {
        sessionStorage.setItem(
          "pendingCalendarSync",
          JSON.stringify({
            type: "project",
            projectId: project.id,
          }),
        );
      }

      // Store flag to reopen calendar modal after OAuth
      sessionStorage.setItem("reopenCalendarModal", "true");

      // Redirect to Google OAuth
      window.location.href = connectData.authUrl;
    } catch (error) {
      console.error("Failed to connect to Google Calendar:", error);
      toast({
        title: "Connection Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to connect to Google Calendar",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const syncToCalendar = async () => {
    setIsSyncing(true);
    try {
      if (mode === "volunteer" && signup) {
        // Sync volunteer signup - use correct parameter names (snake_case)
        const response = await fetch("/api/calendar/add-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signup_id: signup.id,
            project_id: project.id,
            schedule_id: signup.schedule_id,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to sync signup");
        }

        toast({
          title: "✓ Added to Google Calendar",
          description: "Your volunteer signup has been added to your calendar",
        });

        // Call the success callback to update parent state
        onSyncSuccess?.();
      } else {
        // Sync creator project - use snake_case for API
        const response = await fetch("/api/calendar/sync-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: project.id }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to sync project");
        }

        toast({
          title: "Project Synced",
          description: "Your project has been synced to Google Calendar",
        });

        // Call the success callback to update parent state
        onSyncSuccess?.();
      }

      onOpenChange(false);
    } catch (error) {
      console.error("Failed to sync to calendar:", error);
      toast({
        title: "Sync Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to sync event to calendar",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDownloadICalendar = async () => {
    setIsDownloading(true);
    try {
      // Generate iCal content based on mode
      let scheduleId: string | undefined;

      if (mode === "volunteer" && signup) {
        // For volunteer signup, use the specific schedule ID
        scheduleId = signup.schedule_id;
      }

      // Generate iCal content
      const icalContent = generateProjectICalFile(project, scheduleId);

      // Generate filename and download
      const filename = generateICalFilename(project, scheduleId);
      downloadICalFile(icalContent, filename);

      toast({
        title: "iCal File Downloaded",
        description: "Open the file to add the event to your calendar app",
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to download iCal:", error);
      toast({
        title: "Download Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to download iCal file",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          {showSuccessMessage ? (
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-chart-5/20">
                <CheckCircle className="h-6 w-6 text-chart-5" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-xl">
                  {mode === "creator"
                    ? "Project Created!"
                    : "Signup Confirmed!"}
                </DialogTitle>
              </div>
            </div>
          ) : (
            <DialogTitle className="text-xl">Add to Calendar</DialogTitle>
          )}
          <DialogDescription className="text-base">
            {showSuccessMessage ? (
              <span>
                Choose how you&apos;d like to add this to your calendar
              </span>
            ) : (
              <span>
                Choose how you&apos;d like to add this{" "}
                {mode === "volunteer" ? "volunteer shift" : "project"} to your
                calendar
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Project Info Card - Only show when success message is shown */}
        {showSuccessMessage && (
          <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
            <p className="font-semibold text-sm break-words">{project.title}</p>
            {project.location_data && (
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span className="break-words">
                  {project.location_data.text}
                </span>
              </p>
            )}
            {project.schedule?.oneTime?.date && (
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <CalendarIcon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span className="break-words">
                  {new Date(project.schedule.oneTime.date).toLocaleDateString(
                    "en-US",
                    {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    },
                  )}
                </span>
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          {isCheckingConnection ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
              <span>Loading Google Calendar...</span>
            </div>
          ) : isConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-chart-5/10 border border-chart-5/30 rounded-lg text-chart-5">
                <CheckCircle className="h-5 w-5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm mb-0.5 break-words">
                    Calendar Connected
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed break-words">
                    We&apos;ll automatically add this to your calendar.
                  </p>
                  {connectedEmail && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Connected as {connectedEmail}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Button
              onClick={handleGoogleCalendar}
              disabled={isConnecting}
              className="w-full justify-start h-auto p-4 hover:bg-accent hover:text-accent-foreground transition-colors"
              variant="outline"
            >
              <div className="flex items-center gap-3 text-left w-full min-w-0">
                {isConnecting ? (
                  <Loader2 className="h-5 w-5 animate-spin flex-shrink-0 text-primary" />
                ) : (
                  <Image
                    src="/googlecalendar.svg"
                    alt="Google Calendar"
                    width={20}
                    height={20}
                    className="flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm mb-0.5 break-words">
                    Connect Google Calendar
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed break-words">
                    Connect your account to auto-sync this event
                  </p>
                </div>
              </div>
            </Button>
          )}

          {/* iCal Download Option */}
          <Button
            onClick={handleDownloadICalendar}
            disabled={isDownloading}
            className="w-full justify-start h-auto p-4 hover:bg-accent hover:text-accent-foreground transition-colors"
            variant="outline"
          >
            <div className="flex items-center gap-3 text-left w-full min-w-0">
              {isDownloading ? (
                <Loader2 className="h-5 w-5 animate-spin flex-shrink-0 text-primary" />
              ) : (
                <Download className="h-5 w-5 flex-shrink-0 text-primary" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm mb-0.5 break-words">
                  Download iCal File
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed break-words">
                  For Apple Calendar, Outlook, and other calendar apps
                </p>
              </div>
            </div>
          </Button>

          {/* Maybe Later option when showing success message */}
          {showSuccessMessage && (
            <Button
              onClick={() => onOpenChange(false)}
              variant="ghost"
              className="w-full"
            >
              Maybe Later
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
