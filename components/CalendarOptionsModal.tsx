"use client";

import { useState } from "react";
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
          sessionStorage.setItem("pendingCalendarSync", JSON.stringify({
            type: "signup",
            signupId: signup.id,
            projectId: project.id,
            scheduleId: signup.schedule_id,
          }));
        } else {
          sessionStorage.setItem("pendingCalendarSync", JSON.stringify({
            type: "project",
            projectId: project.id,
          }));
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
                <svg
                  className="h-6 w-6 flex-shrink-0"
                  viewBox="0 0 48 48"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect width="22" height="22" x="13" y="13" fill="#fff"/>
                  <polygon fill="#1e88e5" points="25.68,20.92 26.688,22.36 28.272,21.208 28.272,29.56 30,29.56 30,18.616 28.56,18.616"/>
                  <path fill="#1e88e5" d="M22.943,23.745c0.625-0.574,1.013-1.37,1.013-2.249c0-1.747-1.533-3.168-3.417-3.168 c-1.602,0-2.972,1.009-3.33,2.453l1.657,0.421c0.165-0.664,0.868-1.146,1.673-1.146c0.942,0,1.709,0.646,1.709,1.44 c0,0.794-0.767,1.44-1.709,1.44h-0.997v1.728h0.997c1.081,0,1.993,0.751,1.993,1.64c0,0.904-0.866,1.64-1.931,1.64 c-0.962,0-1.784-0.61-1.914-1.418L17,26.802c0.262,1.636,1.81,2.87,3.6,2.87c2.007,0,3.64-1.511,3.64-3.368 C24.24,25.281,23.736,24.363,22.943,23.745z"/>
                  <polygon fill="#fbc02d" points="34,42 14,42 13,38 35,38"/>
                  <polygon fill="#4caf50" points="38,35 42,34 42,14 38,13"/>
                  <path fill="#1e88e5" d="M34,14l1-4l-1-4H9C6.791,6,5,7.791,5,10v24l4,1l4-1V10h21L34,14z"/>
                  <polygon fill="#e53935" points="34,34 34,42 42,34"/>
                  <path fill="#1565c0" d="M39,6h-5v8h8V9C42,7.343,40.657,6,39,6z"/>
                  <path fill="#1565c0" d="M9,42h5v-8H6v5C6,40.657,7.343,42,9,42z"/>
                </svg>
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

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-3">
            <span className="text-xl flex-shrink-0">💡</span>
            <div className="text-sm">
              <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                Recommended: Google Calendar
              </p>
              <p className="text-blue-700 dark:text-blue-300 leading-relaxed">
                Events stay updated automatically if the{" "}
                {mode === "volunteer" ? "shift" : "project"} changes or gets
                cancelled.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
