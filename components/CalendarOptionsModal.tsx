"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
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

  const handleGoogleCalendar = async () => {
    setIsConnecting(true);
    try {
      // Check connection status
      const statusResponse = await fetch("/api/calendar/connection-status");
      const statusData = await statusResponse.json();

      if (!statusData.isConnected) {
        // Need to connect first - store current page for redirect back
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

        // Redirect to Google OAuth
        window.location.href = connectData.authUrl;
        return;
      }

      // Already connected, sync immediately
      await syncToCalendar();
    } catch (error) {
      console.error("Failed to add to Google Calendar:", error);
      toast({
        title: "Calendar Sync Failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to add event to Google Calendar",
        variant: "destructive",
      });
    } finally {
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
          {/* Google Calendar Option */}
          <Button
            onClick={handleGoogleCalendar}
            disabled={isConnecting || isSyncing}
            className="w-full justify-start h-auto p-5 hover:bg-accent hover:text-accent-foreground transition-colors"
            variant="outline"
          >
            <div className="flex items-center gap-4 text-left w-full">
              {isConnecting || isSyncing ? (
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
                <p className="font-semibold text-base mb-1">Google Calendar</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Sync automatically and get updates when events change
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
