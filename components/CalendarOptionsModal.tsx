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
import { Download, Loader2, Check } from "lucide-react";
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
}

export default function CalendarOptionsModal({
  open,
  onOpenChange,
  project,
  signup,
  mode,
}: CalendarOptionsModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);

  // Check calendar connection status when modal opens
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
      // Store current page for redirect back
      const currentUrl = window.location.href;
      sessionStorage.setItem("calendarRedirectUrl", currentUrl);

      // Get OAuth URL
      const connectResponse = await fetch("/api/calendar/google/connect");
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
          })
        );
      } else {
        sessionStorage.setItem(
          "pendingCalendarSync",
          JSON.stringify({
            type: "project",
            projectId: project.id,
          })
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
      } else {
        // Sync creator project
        const response = await fetch("/api/calendar/sync-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to sync project");
        }

        toast({
          title: "Project Synced",
          description: "Your project has been synced to Google Calendar",
        });
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Add to Calendar</DialogTitle>
          <DialogDescription className="text-base">
            Choose how you&apos;d like to add this{" "}
            {mode === "volunteer" ? "volunteer shift" : "project"} to your
            calendar
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-6">
          {/* Connection Status Banner (only show when checking is complete) */}
          {!isCheckingConnection && isConnected && connectedEmail && (
            <div className="flex items-center gap-3 p-3 bg-chart-5/10 border border-chart-5/30 rounded-lg">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 rounded-full bg-chart-5/20 flex items-center justify-center">
                  <Check className="h-4 w-4 text-chart-5" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-chart-5">
                  Connected to Google Calendar
                </div>
                <div className="text-xs text-chart-5/80 truncate">
                  {connectedEmail}
                </div>
              </div>
            </div>
          )}

          {/* Google Calendar Option */}
          <Button
            onClick={handleGoogleCalendar}
            disabled={isConnecting || isSyncing || isCheckingConnection}
            className="w-full justify-start h-auto p-5 hover:bg-accent hover:text-accent-foreground transition-colors"
            variant="outline"
          >
            <div className="flex items-center gap-4 text-left w-full">
              {isConnecting || isSyncing || isCheckingConnection ? (
                <Loader2 className="h-6 w-6 animate-spin flex-shrink-0 text-primary" />
              ) : (
                <Image
                  src="/googlecalendar.svg"
                  alt="Google Calendar"
                  width={24}
                  height={24}
                />
              )}
              <div className="flex-1">
                <p className="font-semibold text-base mb-1">
                  {isConnected ? "Add to Google Calendar" : "Connect Google Calendar"}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {isConnected
                    ? "Sync automatically and get updates when events change"
                    : "Connect your account to auto-sync this event"}
                </p>
              </div>
            </div>
          </Button>

          {/* iCal Download Option */}
          <Button
            onClick={handleDownloadICalendar}
            disabled={isDownloading}
            className="w-full justify-start h-auto p-5 hover:bg-accent hover:text-accent-foreground transition-colors"
            variant="outline"
          >
            <div className="flex items-center gap-4 text-left w-full">
              {isDownloading ? (
                <Loader2 className="h-6 w-6 animate-spin flex-shrink-0 text-primary" />
              ) : (
                <Download className="h-6 w-6 flex-shrink-0 text-primary" />
              )}
              <div className="flex-1">
                <p className="font-semibold text-base mb-1">Download iCal File</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  For Apple Calendar, Outlook, and other calendar apps
                </p>
              </div>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
