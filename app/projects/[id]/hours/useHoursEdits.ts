"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProjectSignup } from "@/types";
import type { HoursSessions } from "./useHoursSessions";

export type EditedTime = {
  check_in_time: string | null;
  check_out_time: string | null;
};

/** The organizer's unsaved check-in and check-out edits, per signup. */
export function useHoursEdits({
  initialSignups,
  signupsBySession,
  getAllProjectSessions,
}: {
  initialSignups: ProjectSignup[];
  signupsBySession: HoursSessions["signupsBySession"];
  getAllProjectSessions: HoursSessions["getAllProjectSessions"];
}) {
  // State to hold edited times, keyed by signup ID
  const [editedTimes, setEditedTimes] = useState<Record<string, EditedTime>>(
    {},
  );

  // Initialize editedTimes state when initialSignups change
  useEffect(() => {
    const initialEdits: Record<string, EditedTime> = {};
    initialSignups.forEach((signup) => {
      // --- CORRECTED ACCESS ---
      initialEdits[signup.id] = {
        check_in_time: signup.check_in_time ?? null, // Ensure type is string | null
        check_out_time: signup.check_out_time || null, // Use check_out_time if available
      };
      // --- END CORRECTION ---
    });
    setEditedTimes(initialEdits);
  }, [initialSignups]);

  // Handler for DateTimePicker changes
  const handleTimeChange = (
    signupId: string,
    field: keyof EditedTime,
    timeStr: string,
  ) => {
    // Get existing date from the current value
    const currentValue = editedTimes[signupId]?.[field];
    const date = currentValue ? new Date(currentValue) : new Date();

    // Parse the new time string (format: "HH:mm")
    const [hours, minutes] = timeStr.split(":").map(Number);

    // Update just the time portion of the date
    date.setHours(hours, minutes);

    setEditedTimes((prev) => ({
      ...prev,
      [signupId]: {
        ...prev[signupId],
        [field]: date.toISOString(),
      },
    }));
  };

  // State for batch time adjustment
  const [showBatchAdjustment, setShowBatchAdjustment] = useState<
    Record<string, boolean>
  >({});
  const [batchMinutesAdjustment, setBatchMinutesAdjustment] =
    useState<number>(30);
  const [applyingBatchAdjustment, setApplyingBatchAdjustment] = useState<
    Record<string, boolean>
  >({});

  // Function to handle batch time adjustment
  const handleBatchAdjustment = (sessionId: string, minutes: number) => {
    setApplyingBatchAdjustment((prev) => ({
      ...prev,
      [sessionId]: true,
    }));
    const allSessions = getAllProjectSessions; // Ensure getAllProjectSessions is in scope

    try {
      // Get all signups for this session
      let sessionSignups: ProjectSignup[] = [];

      // First try exact match
      if (signupsBySession[sessionId]) {
        sessionSignups = signupsBySession[sessionId];
      } else {
        // Try all alternative IDs
        const session = allSessions.find((s) => s.id === sessionId);
        if (session) {
          for (const altId of session.alternativeIds) {
            if (signupsBySession[altId]) {
              sessionSignups = signupsBySession[altId];
              break;
            }
          }
        }
      }

      if (sessionSignups.length === 0) {
        toast.error("No volunteers found for this session.");
        return;
      }

      // Apply the adjustment to all signups in the session
      const newEditedTimes = { ...editedTimes };
      let successCount = 0;

      sessionSignups.forEach((signup) => {
        const currentCheckOut = editedTimes[signup.id]?.check_out_time;

        if (currentCheckOut) {
          // Create a date object from the current checkout time
          const checkOutDate = new Date(currentCheckOut);

          // Add the specified minutes
          checkOutDate.setMinutes(checkOutDate.getMinutes() + minutes);

          // Update the edited times
          newEditedTimes[signup.id] = {
            ...newEditedTimes[signup.id],
            check_out_time: checkOutDate.toISOString(),
          };

          successCount++;
        }
      });

      // Update state with new times
      setEditedTimes(newEditedTimes);

      // Show success message
      if (successCount > 0) {
        toast.success(
          `Successfully adjusted ${successCount} volunteer${successCount !== 1 ? "s" : ""} by ${minutes} minutes.`,
        );
      } else {
        toast.warning(
          "No checkout times were adjusted. Make sure volunteers have check-out times set.",
        );
      }

      // Close the batch adjustment UI
      setShowBatchAdjustment((prev) => ({
        ...prev,
        [sessionId]: false,
      }));
    } catch (error) {
      safeConsole.error("Error applying batch adjustment:", error);
      toast.error("Failed to apply time adjustment.");
    } finally {
      setApplyingBatchAdjustment((prev) => ({
        ...prev,
        [sessionId]: false,
      }));
    }
  };

  return {
    editedTimes,
    handleTimeChange,
    showBatchAdjustment,
    batchMinutesAdjustment,
    setBatchMinutesAdjustment,
    applyingBatchAdjustment,
    handleBatchAdjustment,
  };
}

export type HoursEdits = ReturnType<typeof useHoursEdits>;
