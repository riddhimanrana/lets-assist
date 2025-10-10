"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle, MapPin } from "lucide-react";
import CalendarOptionsModal from "./CalendarOptionsModal";
import type { Project, Signup } from "@/types";

interface CalendarSyncSuccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  signup?: Signup;
  mode: "creator" | "volunteer";
  title?: string;
  description?: string;
}

/**
 * Success modal shown after creating a project or completing a signup.
 * Allows users to add the event to their calendar.
 */
export default function CalendarSyncSuccessModal({
  open,
  onOpenChange,
  project,
  signup,
  mode,
  title,
  description,
}: CalendarSyncSuccessModalProps) {
  const [showCalendarOptions, setShowCalendarOptions] = useState(false);

  const handleAddToCalendar = () => {
    setShowCalendarOptions(true);
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const defaultTitle =
    mode === "creator"
      ? "Project Created Successfully!"
      : "Signup Confirmed!";
  const defaultDescription =
    mode === "creator"
      ? "Your project has been created. Would you like to add it to your calendar?"
      : "You've successfully signed up! Would you like to add this to your calendar?";

  return (
    <>
      <Dialog open={open && !showCalendarOptions} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-chart-5 dark:bg-chart-5/20">
                <CheckCircle className="h-6 w-6 text-chart-5" />
              </div>
              <DialogTitle className="text-xl">
                {title || defaultTitle}
              </DialogTitle>
            </div>
            <DialogDescription className="text-base">
              {description || defaultDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Project/Signup Info */}
            <div className="rounded-lg border p-4 space-y-2">
              <p className="font-semibold">{project.title}</p>
              {project.location_data && (
                <p className="text-sm text-muted-foreground">
                  <MapPin className="inline h-4 w-4 mr-1" />
                   {project.location_data.text}
                </p>
              )}
              {project.schedule?.oneTime?.date && (
                <p className="text-sm text-muted-foreground">
                  <Calendar className="inline h-4 w-4 mr-1" />
                  {new Date(project.schedule.oneTime.date).toLocaleDateString(
                    "en-US",
                    {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }
                  )}
                </p>
              )}
            </div>

            {/* Calendar Prompt */}
            
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleClose} className="w-full sm:w-auto">
              Maybe Later
            </Button>
            <Button onClick={handleAddToCalendar} className="w-full sm:w-auto">
              Add to Calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calendar Options Modal */}
      <CalendarOptionsModal
        open={showCalendarOptions}
        onOpenChange={(open) => {
          setShowCalendarOptions(open);
          if (!open) {
            // Close the parent modal when calendar options is closed
            onOpenChange(false);
          }
        }}
        project={project}
        signup={signup}
        mode={mode}
      />
    </>
  );
}
