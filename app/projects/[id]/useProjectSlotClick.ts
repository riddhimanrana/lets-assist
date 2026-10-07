"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect } from "react";
import { toast } from "sonner";
import type { Project, ProjectStatus } from "@/types";
import type { AuthUser } from "@/lib/supabase/types";
import { copyToClipboard, isMobileDevice } from "@/lib/utils";
import { isSlotAvailable } from "@/utils/project";
import type { AnonymousSlotOption } from "./project-details-types";
import { logSignupClientDebug } from "./signup-client-debug";

/**
 * Decides what a click on a slot's button does: open the right dialog for the
 * viewer, start a cancellation, or explain why the slot is unavailable.
 */
export function useProjectSlotClick({
  project,
  user,
  isCreator,
  calculatedStatus,
  hasSignedUp,
  rejectedSlots,
  attendedSlots,
  remainingSlots,
  anonymousSlotOptions,
  setCurrentScheduleId,
  setAuthDialogOpen,
  setSelectedAnonymousScheduleIds,
  setAnonymousDialogOpen,
  setAnonymousSlotSelectionOpen,
  setPendingScheduleId,
  setShowSignupConfirmation,
  setShowCancelConfirmation,
  resetSignupConfirmation,
  handleSignUp,
}: {
  project: Project;
  user: AuthUser | null;
  isCreator: boolean;
  calculatedStatus: ProjectStatus;
  hasSignedUp: Record<string, boolean>;
  rejectedSlots: Record<string, boolean>;
  attendedSlots: Record<string, boolean>;
  remainingSlots: Record<string, number>;
  anonymousSlotOptions: AnonymousSlotOption[];
  setCurrentScheduleId: (scheduleId: string) => void;
  setAuthDialogOpen: (open: boolean) => void;
  setSelectedAnonymousScheduleIds: (scheduleIds: string[]) => void;
  setAnonymousDialogOpen: (open: boolean) => void;
  setAnonymousSlotSelectionOpen: (open: boolean) => void;
  setPendingScheduleId: (scheduleId: string) => void;
  setShowSignupConfirmation: (open: boolean) => void;
  setShowCancelConfirmation: (open: boolean) => void;
  resetSignupConfirmation: () => void;
  handleSignUp: (scheduleId: string) => unknown;
}) {
  // Handle sign up or cancel click
  const handleSignUpClick = async (scheduleId: string) => {
    logSignupClientDebug({
      step: "slot_click",
      projectId: project.id,
      scheduleId,
      isCreator,
      hasSignedUp: Boolean(hasSignedUp[scheduleId]),
      rejected: Boolean(rejectedSlots[scheduleId]),
      attended: Boolean(attendedSlots[scheduleId]),
      remainingSlots: remainingSlots[scheduleId],
      calculatedStatus,
      requireLogin: project.require_login,
      pauseSignups: project.pause_signups,
      eventType: project.event_type,
      userPresent: Boolean(user),
    });

    // Prevent project creator from signing up
    if (isCreator) {
      logSignupClientDebug({
        step: "slot_click_blocked_creator",
        projectId: project.id,
        scheduleId,
      });
      toast.info("You cannot sign up for your own project");
      return;
    }

    // Check if this specific slot has been rejected
    if (rejectedSlots[scheduleId]) {
      logSignupClientDebug({
        step: "slot_click_blocked_rejected",
        projectId: project.id,
        scheduleId,
      });
      toast.error(
        "You have been rejected for this slot and cannot sign up again.",
      );
      return;
    }

    // Check if user has attended this slot
    if (attendedSlots[scheduleId]) {
      logSignupClientDebug({
        step: "slot_click_blocked_attended",
        projectId: project.id,
        scheduleId,
      });
      toast.error("You have already attended this slot.");
      return;
    }

    if (hasSignedUp[scheduleId]) {
      logSignupClientDebug({
        step: "slot_click_cancel_existing",
        projectId: project.id,
        scheduleId,
      });
      handleCancelSignup(scheduleId);
      return;
    }

    // Check if signups are paused
    if (project.pause_signups) {
      logSignupClientDebug({
        step: "slot_click_blocked_paused",
        projectId: project.id,
        scheduleId,
      });
      toast.error(
        "Signups for this project are temporarily paused by the organizer",
      );
      return;
    }

    // Use calculatedStatus instead of project.status
    if (
      !isSlotAvailable(project, scheduleId, remainingSlots, calculatedStatus)
    ) {
      logSignupClientDebug({
        step: "slot_click_blocked_unavailable",
        projectId: project.id,
        scheduleId,
        remainingSlots,
        calculatedStatus,
      });
      toast.error("This slot is no longer available");
      return;
    }

    if (!user && project.require_login) {
      logSignupClientDebug({
        step: "slot_click_open_auth",
        projectId: project.id,
        scheduleId,
      });
      setCurrentScheduleId(scheduleId);
      setAuthDialogOpen(true);
      return;
    }

    if (!user && !project.require_login) {
      logSignupClientDebug({
        step: "slot_click_open_anonymous_flow",
        projectId: project.id,
        scheduleId,
        eventType: project.event_type,
      });
      setCurrentScheduleId(scheduleId);

      if (project.event_type === "oneTime") {
        setSelectedAnonymousScheduleIds([scheduleId]);
        setAnonymousDialogOpen(true);
      } else {
        const orderedIds = anonymousSlotOptions.map((slot) => slot.scheduleId);
        const initialSelection = orderedIds.includes(scheduleId)
          ? [scheduleId]
          : orderedIds.slice(0, 1);

        setSelectedAnonymousScheduleIds(initialSelection);
        setAnonymousSlotSelectionOpen(true);
      }

      return;
    }

    // For logged-in users, show confirmation modal
    if (user) {
      logSignupClientDebug({
        step: "slot_click_open_confirmation_modal",
        projectId: project.id,
        scheduleId,
        userId: user.id,
      });
      setPendingScheduleId(scheduleId);
      resetSignupConfirmation();
      setShowSignupConfirmation(true);
      return;
    }

    handleSignUp(scheduleId);
  };

  // Cancel signup
  const handleCancelSignup = async (scheduleId: string) => {
    // Show confirmation modal for logged-in users
    if (user) {
      logSignupClientDebug({
        step: "cancel_click_open_confirmation_modal",
        projectId: project.id,
        scheduleId,
        userId: user.id,
      });
      setPendingScheduleId(scheduleId);
      setShowCancelConfirmation(true);
      return;
    }
  };

  return { handleSignUpClick };
}

/** Shares the project through the phone share sheet, or copies its link. */
export function useProjectShare(project: Project) {
  // Share project
  const handleShare = async () => {
    const url = window.location.href;

    if (
      isMobileDevice() &&
      typeof navigator !== "undefined" &&
      navigator.share
    ) {
      try {
        await navigator.share({
          title: `${project.title} - Let's Assist`,
          text: "Check out this project!",
          url,
        });
        return;
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          safeConsole.error("Share failed:", error);
        } else {
          // User cancelled the share sheet, don't show error or copy to clipboard
          return;
        }
      }
    }

    // Default to clipboard for desktop or if mobile share failed
    const copied = await copyToClipboard(url);
    if (copied) {
      toast.success("Project link copied to clipboard");
    } else {
      toast.error("Could not copy link to clipboard");
    }
  };

  return handleShare;
}

/** Reopens the signup confirmation after a calendar OAuth round trip. */
export function useReopenSignupAfterOAuth({
  projectId,
  user,
  setPendingScheduleId,
  setShowSignupConfirmation,
}: {
  projectId: string;
  user: AuthUser | null;
  setPendingScheduleId: (scheduleId: string) => void;
  setShowSignupConfirmation: (open: boolean) => void;
}) {
  // Handle reopening signup modal after OAuth
  useEffect(() => {
    const modalState = sessionStorage.getItem("signupModalState");

    // Also check URL params for OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const oauthSuccess = urlParams.get("success");

    if (modalState) {
      try {
        const { projectId, scheduleId, returnToModal } = JSON.parse(modalState);

        // Only reopen if it's for this project and we should return to modal
        if (returnToModal && projectId === projectId && user) {
          // Clear the state
          sessionStorage.removeItem("signupModalState");

          // If returning from OAuth, set the just connected flag
          if (oauthSuccess === "connected") {
            sessionStorage.setItem("calendarJustConnected", "true");

            // Clean URL
            window.history.replaceState({}, "", `/projects/${projectId}`);
          }

          // Reopen the signup modal
          setPendingScheduleId(scheduleId);
          setShowSignupConfirmation(true);
        }
      } catch (error) {
        safeConsole.error("Error parsing modal state:", error);
        sessionStorage.removeItem("signupModalState");
      }
    }
  }, [projectId, user]);
}
