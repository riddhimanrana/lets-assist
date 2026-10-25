"use client";
import { safeConsole } from "@/lib/safe-console";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Project, ProjectStatus } from "@/types";
import {
  getProjectStatus,
  isForwardProjectStatusTransition,
} from "@/utils/project";
import { updateProjectStatus } from "./actions";

/**
 * Tracks the schedule-derived status of a project and, for people who can
 * manage it, persists forward transitions through the project status action.
 */
export function useProjectStatusSync(
  project: Project,
  canManageProject: boolean,
) {
  const router = useRouter();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Add state to track calculated status
  // Initialize with project.status to avoid hydration mismatch, then update on client
  const [calculatedStatus, setCalculatedStatus] = useState<ProjectStatus>(
    project.status,
  );

  useEffect(() => {
    setCalculatedStatus(getProjectStatus(project));

    // Update status every minute
    const interval = setInterval(() => {
      setCalculatedStatus(getProjectStatus(project));
    }, 60000);

    return () => clearInterval(interval);
  }, [project]);

  // Persist automatic transitions through the same authorization-aware boundary
  // as explicit project status changes.
  const updateProjectStatusInDB = async (newStatus: ProjectStatus) => {
    if (isUpdatingStatus) return;

    try {
      setIsUpdatingStatus(true);
      const result = await updateProjectStatus(project.id, newStatus);

      if (result.error) {
        toast.error(result.error, {
          description:
            "Your permissions or the project state may have changed. Refresh to load the current status.",
          action: {
            label: "Refresh",
            onClick: () => router.refresh(),
          },
        });
      }
    } catch (error) {
      safeConsole.error("Error updating project status:", error);
      toast.error("Failed to update project status", {
        description: "Refresh the page and try again.",
        action: {
          label: "Refresh",
          onClick: () => router.refresh(),
        },
      });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Modify status check effect to avoid unnecessary updates
  // Add a ref to ensure status mismatch update runs only once
  const statusMismatchHandled = useRef(false);

  useEffect(() => {
    const newCalculatedStatus = getProjectStatus(project);

    setCalculatedStatus((prevStatus) => {
      if (newCalculatedStatus !== prevStatus) {
        safeConsole.log(
          "Application diagnostic from app/projects/[id]/ProjectDetails",
          `Calculated status updated: ${newCalculatedStatus}`,
        );
        return newCalculatedStatus;
      }
      return prevStatus;
    });

    // Only update DB if the current user can manage the project, status differs, and it has not already been handled
    if (
      canManageProject &&
      !isUpdatingStatus &&
      isForwardProjectStatusTransition(project.status, newCalculatedStatus) &&
      !statusMismatchHandled.current
    ) {
      safeConsole.log(
        "Application diagnostic from app/projects/[id]/ProjectDetails",
        `Status mismatch detected: prop=${project.status}, calculated=${newCalculatedStatus}`,
      );
      startTransition(() => {
        void updateProjectStatusInDB(newCalculatedStatus);
      });
      statusMismatchHandled.current = true; // Mark as handled
    }
  }, [
    canManageProject,
    project.id,
    project.status,
    project.schedule,
    project.created_at,
    project.cancelled_at,
    isUpdatingStatus,
  ]);

  // Modify interval effect to be more selective about updates
  useEffect(() => {
    const checkStatus = () => {
      const newStatus = getProjectStatus(project);

      setCalculatedStatus((prevStatus) => {
        if (newStatus !== prevStatus) {
          safeConsole.log("Status updated via interval:", newStatus);

          if (
            canManageProject &&
            !isUpdatingStatus &&
            isForwardProjectStatusTransition(project.status, newStatus)
          ) {
            startTransition(() => {
              void updateProjectStatusInDB(newStatus);
            });
          }
          return newStatus;
        }
        return prevStatus;
      });
    };

    const intervalId = setInterval(checkStatus, 60000);
    return () => clearInterval(intervalId);
  }, [
    project.id,
    project.status,
    project.schedule,
    project.created_at,
    project.cancelled_at,
    canManageProject,
    isUpdatingStatus,
  ]); // Remove function dependency

  return calculatedStatus;
}
