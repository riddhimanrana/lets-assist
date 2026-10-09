"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState, useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Calendar, MapPin, Clock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cancelSignup } from "@/app/projects/[id]/actions";
import { toast } from "sonner";

interface CancelSignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (scheduleId: string) => void; // Callback when cancellation succeeds
  project: {
    title: string;
    date: string;
    location: string;
    start_time?: string;
    end_time?: string;
  };
  projectId: string; // Project ID for database queries
  scheduleId: string; // Schedule ID for the specific slot
  userId: string; // Current user ID
}

export function CancelSignupModal({
  isOpen,
  onClose,
  onSuccess,
  project,
  projectId,
  scheduleId,
  userId,
}: CancelSignupModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const isLateCancellation = useMemo(() => {
    if (!project.date) return false;
    try {
      const eventDate = new Date(project.date);
      if (project.start_time) {
        const [hours, minutes] = project.start_time.split(":");
        eventDate.setHours(parseInt(hours, 10), parseInt(minutes, 10));
      }
      const now = new Date();
      const diffInHours =
        (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      return diffInHours < 24 && diffInHours > 0;
    } catch (e) {
      safeConsole.error("Error checking cancellation time", e);
      return false;
    }
  }, [project.date, project.start_time]);

  const handleConfirmCancel = async () => {
    safeConsole.log("CancelSignupModal: Starting cancellation process");
    safeConsole.log("Project ID:", projectId);
    safeConsole.log("Schedule ID:", scheduleId);
    safeConsole.log("User ID:", userId);

    setIsLoading(true);

    try {
      const supabase = createClient();

      // Find the signup record to cancel
      const { data: allSignups, error: queryError } = await supabase
        .from("project_signups")
        .select("*")
        .eq("project_id", projectId)
        .eq("schedule_id", scheduleId)
        .eq("user_id", userId);

      safeConsole.log("Found signups:", allSignups);
      safeConsole.log("Query error:", queryError);

      if (queryError) {
        safeConsole.error("Error querying signups:", queryError);
        toast.error("Failed to find signup record");
        return;
      }

      // Find any approved signup (most common case)
      let targetSignup = allSignups?.find((s) => s.status === "approved");

      // If no approved signup, try pending status
      if (!targetSignup) {
        targetSignup = allSignups?.find((s) => s.status === "pending");
      }

      // If still no signup, take any status
      if (!targetSignup && allSignups && allSignups.length > 0) {
        targetSignup = allSignups[0];
      }

      if (!targetSignup) {
        safeConsole.error("No signup found to cancel");
        toast.error("No signup found to cancel");
        return;
      }

      safeConsole.log("Attempting to cancel signup:", targetSignup);

      // Call the server action to cancel the signup
      const result = await cancelSignup(targetSignup.id);
      safeConsole.log("Cancel result:", result);

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Successfully cancelled signup");
        onSuccess(scheduleId); // Notify parent component of successful cancellation
        onClose(); // Close the modal
      }
    } catch (error) {
      safeConsole.error("Error cancelling signup:", error);
      toast.error("Failed to cancel signup");
    } finally {
      setIsLoading(false);
    }
  };
  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(":");
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes));
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Cancel your signup?</DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel your signup for this event? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-semibold text-sm">
              Event you&apos;re cancelling
            </h4>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Calendar className="size-4 text-muted-foreground mt-0.5" />
                <div>
                  <div className="text-sm font-medium">{project.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(project.date)}
                  </div>
                </div>
              </div>
              {(project.start_time || project.end_time) && (
                <div className="flex items-center gap-3">
                  <Clock className="size-4 text-muted-foreground" />
                  <span className="text-sm">
                    {project.start_time && formatTime(project.start_time)}
                    {project.start_time && project.end_time && " - "}
                    {project.end_time && formatTime(project.end_time)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <MapPin className="size-4 text-muted-foreground" />
                <span className="text-sm">{project.location}</span>
              </div>
            </div>
          </div>

          {isLateCancellation && (
            <Alert variant="warning">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>The event starts within 24 hours</AlertTitle>
              <AlertDescription>
                Cancelling this late may affect your reliability score and
                future signup opportunities. Consider contacting the organizers
                directly.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Keep signup
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmCancel}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2
                  data-icon="inline-start"
                  aria-hidden="true"
                  className="animate-spin"
                />
                Cancelling...
              </>
            ) : (
              "Cancel signup"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
