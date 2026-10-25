import { safeConsole } from "@/lib/safe-console";

import { useEffect, useState, type RefObject } from "react";
import { differenceInMinutes, parse } from "date-fns";
import type { Project } from "@/types";
import {
  getMultiDaySlotByScheduleId,
  getMultiDaySlotDisplayName,
  getSlotDetails,
} from "@/utils/project";

import { formatRemainingTime, type SessionDetails } from "./attendance-session";

/**
 * Resolves the session a QR code points at and tracks how far through it the
 * volunteer is, measured from their check-in time to the session end.
 */
export function useSessionProgress({
  project,
  scheduleId,
  checkInTime,
  sessionHasEnded,
  setSessionHasEnded,
  elapsedTimeRef,
}: {
  project: Project;
  scheduleId: string;
  checkInTime: Date | null;
  sessionHasEnded: boolean;
  setSessionHasEnded: (ended: boolean) => void;
  elapsedTimeRef: RefObject<number>;
}) {
  const [sessionDetails, setSessionDetails] = useState<SessionDetails | null>(
    null,
  );
  // Add state for progress and remaining time
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [remainingTimeFormatted, setRemainingTimeFormatted] = useState("");

  // Get session details
  useEffect(() => {
    if (project && scheduleId) {
      const details = getSlotDetails(project, scheduleId);

      let formattedDetails = null;
      if (details) {
        // Format depending on event type
        if (project.event_type === "oneTime") {
          formattedDetails = {
            ...details,
            name: "Main Event",
            date: project.schedule.oneTime?.date || "",
          };
        } else if (project.event_type === "multiDay") {
          const slotData = getMultiDaySlotByScheduleId(project, scheduleId);
          if (slotData) {
            const { day, slot, slotIndex } = slotData;
            formattedDetails = {
              ...details,
              name: getMultiDaySlotDisplayName(slot, slotIndex),
              date: day.date,
            };
          }
        } else if (project.event_type === "sameDayMultiArea") {
          formattedDetails = {
            ...details,
            name: scheduleId,
            date: project.schedule.sameDayMultiArea?.date || "",
          };
        }
      }

      setSessionDetails(formattedDetails);
    }
  }, [project, scheduleId]);

  // Update progress and remaining time smoothly using requestAnimationFrame
  useEffect(() => {
    // Ensure checkInTime is valid *before* proceeding
    if (
      !checkInTime ||
      !sessionDetails?.date ||
      !sessionDetails?.startTime ||
      !sessionDetails?.endTime
    ) {
      // Clear progress if necessary data is missing
      setProgressPercentage(0);
      setRemainingTimeFormatted("");
      return;
    }

    let animationFrameId: number;
    const updateTimers = () => {
      const now = new Date();

      // Calculate Session Progress (based on check-in time) and Remaining Time (based on session end)
      try {
        // Combine date and time strings and parse them
        const sessionEndDateTime = parse(
          `${sessionDetails.date} ${sessionDetails.endTime}`,
          "yyyy-MM-dd HH:mm",
          new Date(),
        );

        // Check if sessionEndDateTime is valid
        if (isNaN(sessionEndDateTime.getTime())) {
          safeConsole.error(
            "Invalid end date/time for progress calculation",
            sessionDetails,
          );
          setProgressPercentage(0);
          setRemainingTimeFormatted("Error: Invalid time");
          return;
        }

        // Calculate remaining time until session end (for display text)
        const remainingMinutes = differenceInMinutes(sessionEndDateTime, now);
        setRemainingTimeFormatted(formatRemainingTime(remainingMinutes));

        // Calculate progress based on time since check-in relative to session end
        const totalDurationMinutes = differenceInMinutes(
          sessionEndDateTime,
          checkInTime,
        );
        const elapsedSinceCheckInMinutes = differenceInMinutes(
          now,
          checkInTime,
        );

        // Track elapsed time for the end screen
        const elapsedMs = elapsedSinceCheckInMinutes * 60 * 1000;
        elapsedTimeRef.current = Math.max(0, elapsedMs);

        let newProgress: number;
        if (totalDurationMinutes <= 0) {
          // If session ended before or exactly when user checked in, or if check-in is after session end
          newProgress = now >= sessionEndDateTime ? 100 : 0;
        } else {
          // Calculate progress percentage from check-in time to session end time
          newProgress = Math.max(
            0,
            Math.min(
              100,
              (elapsedSinceCheckInMinutes / totalDurationMinutes) * 100,
            ),
          );
        }

        setProgressPercentage(newProgress);

        // Check if session has ended (reached 100%)
        if (newProgress >= 100 && !sessionHasEnded) {
          setSessionHasEnded(true);
        }
      } catch (error) {
        safeConsole.error("Error calculating progress:", error);
        setProgressPercentage(0);
        setRemainingTimeFormatted("Error calculating");
      }

      // Schedule next update using requestAnimationFrame for smooth animation
      animationFrameId = requestAnimationFrame(updateTimers);
    };

    updateTimers(); // Initial call

    return () => cancelAnimationFrame(animationFrameId);
    // Depend on checkInTime and session end details
  }, [
    checkInTime,
    sessionDetails?.date,
    sessionDetails?.endTime,
    sessionHasEnded,
  ]);

  return { sessionDetails, progressPercentage, remainingTimeFormatted };
}
