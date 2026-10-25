"use client";
import { safeConsole } from "@/lib/safe-console";

import type { Dispatch, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  AnonymousSignupData,
  Project,
  WaiverSignatureInput,
} from "@/types";
import type { SignupAttemptResult } from "@/app/projects/_components/useSignupConfirmationAction";
import { shouldSendWaiverWithSlot } from "@/lib/waiver/upload-limits";
import { signUpForProject } from "./actions";
import { logSignupClientDebug } from "./signup-client-debug";

type RecordSetter<T> = Dispatch<SetStateAction<Record<string, T>>>;

/**
 * Submits signups: one slot for a signed-in volunteer, or one or more slots
 * for a signed-out volunteer filling the quick sign-up form.
 */
export function useProjectSignupSubmit({
  project,
  demoMode,
  currentScheduleId,
  selectedAnonymousScheduleIds,
  setLoadingStates,
  setHasSignedUp,
  setRemainingSlots,
  setShowConfirmationAlert,
  setConfirmationEmailAccepted,
  setAnonymousDialogOpen,
  setAnonymousSlotSelectionOpen,
  setShowSignupConfirmation,
  setResendAnonymousId,
  setShowResendDialog,
  closeAnonymousFlows,
  refetchAttendees,
}: {
  project: Project;
  demoMode: boolean;
  currentScheduleId: string;
  selectedAnonymousScheduleIds: string[];
  setLoadingStates: RecordSetter<boolean>;
  setHasSignedUp: RecordSetter<boolean>;
  setRemainingSlots: RecordSetter<number>;
  setShowConfirmationAlert: (open: boolean) => void;
  setConfirmationEmailAccepted: (accepted: boolean) => void;
  setAnonymousDialogOpen: (open: boolean) => void;
  setAnonymousSlotSelectionOpen: (open: boolean) => void;
  setShowSignupConfirmation: (open: boolean) => void;
  setResendAnonymousId: (id: string | null) => void;
  setShowResendDialog: (open: boolean) => void;
  closeAnonymousFlows: () => void;
  refetchAttendees: () => Promise<void>;
}) {
  const router = useRouter();

  // Handle signup
  const handleSignUp = async (
    scheduleId: string,
    anonymousData?: AnonymousSignupData,
    volunteerComment?: string,
    waiverSignature?: WaiverSignatureInput | null,
    formData?: Record<string, unknown>,
  ): Promise<SignupAttemptResult> => {
    setLoadingStates((prev) => ({ ...prev, [scheduleId]: true }));
    // Reset alert state on new signup attempt
    setShowConfirmationAlert(false);

    try {
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        toast.info("This is just a demo.", {
          description:
            "No signup was created. Real projects save this signup and update the roster.",
        });
        setAnonymousDialogOpen(false);
        setAnonymousSlotSelectionOpen(false);
        setShowSignupConfirmation(false);
        return { success: true };
      }

      logSignupClientDebug({
        step: "action_start",
        projectId: project.id,
        scheduleId,
        isAnonymous: Boolean(anonymousData),
        hasVolunteerComment: Boolean(volunteerComment),
        hasWaiverSignature: Boolean(waiverSignature),
        hasFormData: Boolean(formData && Object.keys(formData).length > 0),
      });

      const result = await signUpForProject(
        project.id,
        scheduleId,
        anonymousData,
        volunteerComment,
        waiverSignature,
        formData,
      );

      logSignupClientDebug({
        step: "action_result",
        projectId: project.id,
        scheduleId,
        result,
      });

      if (result.error) {
        // Check if this is a pending signup that can be resent
        if (
          "canResend" in result &&
          result.canResend &&
          "anonymousSignupId" in result &&
          result.anonymousSignupId
        ) {
          setResendAnonymousId(result.anonymousSignupId as string);
          setShowResendDialog(true);
        } else {
          toast.error(result.error);
        }
        return { success: false, error: result.error };
      } else if (result.success) {
        if (result.needsConfirmation) {
          // Show the persistent alert
          setConfirmationEmailAccepted(
            result.confirmationDelivery === "accepted",
          );
          setShowConfirmationAlert(true);
          // Also show a toast as immediate feedback
          toast.success("Signup initiated!", {
            description:
              result.confirmationDelivery === "accepted"
                ? "Please check your email to confirm your spot."
                : "Your signup is saved, but email delivery could not be confirmed. Check your inbox or request a new confirmation link.",
            duration: 5000,
          });
          // No UI state change here yet for slots/signup status
        } else {
          // Check if user has Google Calendar connected
          let calendarSynced = false;
          if (result.signupId && result.projectId) {
            try {
              const statusResponse = await fetch(
                "/api/calendar/connection-status",
              );
              const statusData = await statusResponse.json();

              // API returns 'connected' not 'isConnected'
              if (statusData.connected) {
                // Automatically sync to calendar
                const syncResponse = await fetch("/api/calendar/add-signup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    signup_id: result.signupId,
                    project_id: result.projectId,
                    schedule_id: scheduleId,
                  }),
                });

                if (syncResponse.ok) {
                  calendarSynced = true;
                }
              }
            } catch (error) {
              safeConsole.error("Error syncing to calendar:", error);
              // Don't fail the signup if calendar sync fails
            }
          }

          // Success toast with calendar info
          toast.success(
            calendarSynced
              ? "Successfully signed up and added to Google Calendar!"
              : "Successfully signed up!",
            {
              duration: 5000,
            },
          );

          // Update local state to reflect the successful signup
          setHasSignedUp((prev) => ({ ...prev, [scheduleId]: true }));
          setRemainingSlots((prev) => ({
            ...prev,
            [scheduleId]: Math.max(0, (prev[scheduleId] || 0) - 1),
          }));

          // Refetch attendees to update the list in real-time
          logSignupClientDebug({
            step: "refetch_attendees_start",
            traceId: "traceId" in result ? result.traceId : undefined,
            projectId: project.id,
            scheduleId,
          });
          await refetchAttendees();
          logSignupClientDebug({
            step: "refetch_attendees_complete",
            traceId: "traceId" in result ? result.traceId : undefined,
            projectId: project.id,
            scheduleId,
          });

          // Force a refresh of the page data to ensure we're in sync with the server
          logSignupClientDebug({
            step: "router_refresh_start",
            traceId: "traceId" in result ? result.traceId : undefined,
            projectId: project.id,
            scheduleId,
          });
          router.refresh();
          logSignupClientDebug({
            step: "router_refresh_called",
            traceId: "traceId" in result ? result.traceId : undefined,
            projectId: project.id,
            scheduleId,
          });
        }
        return { success: true };
      }
      const error = "The signup response was incomplete. Please try again.";
      toast.error(error);
      return { success: false, error };
    } catch (error) {
      safeConsole.error(
        "[signup-client-debug]",
        JSON.stringify({
          step: "client_exception",
          projectId: project.id,
          scheduleId,
          error,
        }),
      );
      const message = "An unexpected error occurred. Please try again.";
      toast.error(message);
      return { success: false, error: message };
    } finally {
      setLoadingStates((prev) => ({ ...prev, [scheduleId]: false }));
      if (anonymousData) {
        closeAnonymousFlows();
      } else {
        setAnonymousDialogOpen(false);
      }
    }
  };

  // Handle anonymous form submit
  const handleAnonymousSubmit = (
    values: AnonymousSignupData,
    waiverSignature?: WaiverSignatureInput | null,
    formData?: Record<string, unknown>,
  ) => {
    logSignupClientDebug({
      step: "anonymous_submit",
      projectId: project.id,
      currentScheduleId,
      selectedScheduleIds: selectedAnonymousScheduleIds,
      selectedSlotCount: values.selectedSlotCount,
      hasWaiverSignature: Boolean(waiverSignature),
      hasFormData: Boolean(formData && Object.keys(formData).length > 0),
      hasComment: Boolean(values.comment),
    });
    const scheduleIds = Array.from(
      new Set(
        (selectedAnonymousScheduleIds.length > 0
          ? selectedAnonymousScheduleIds
          : [currentScheduleId]
        ).filter(Boolean),
      ),
    );

    if (scheduleIds.length <= 1) {
      const onlyScheduleId = scheduleIds[0] || currentScheduleId;
      logSignupClientDebug({
        step: "anonymous_single_slot_submit",
        projectId: project.id,
        scheduleId: onlyScheduleId,
      });
      const payload: AnonymousSignupData = {
        ...values,
        selectedSlotCount: 1,
      };
      handleSignUp(
        onlyScheduleId,
        payload,
        values.comment,
        waiverSignature,
        formData,
      );
      return;
    }

    void (async () => {
      setShowConfirmationAlert(false);
      setLoadingStates((prev) => {
        const next = { ...prev };
        scheduleIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });

      let successfulSignups = 0;
      let needsConfirmation = false;
      let confirmationAccepted = false;
      let continuationToken: string | undefined;
      const errorMessages: string[] = [];

      try {
        for (let index = 0; index < scheduleIds.length; index += 1) {
          const scheduleId = scheduleIds[index];
          // The waiver travels with every slot until one sign-up has returned
          // a continuation token, so a full or past first slot cannot lose it.
          const sendWaiver = shouldSendWaiverWithSlot(continuationToken);
          logSignupClientDebug({
            step: "anonymous_multi_slot_submit",
            projectId: project.id,
            scheduleId,
            slotIndex: index,
            totalSlots: scheduleIds.length,
            reuseWaiver: sendWaiver,
          });
          const payload: AnonymousSignupData = {
            ...values,
            selectedSlotCount: scheduleIds.length,
            skipConfirmationEmail: index > 0,
            continuationToken,
          };

          const result = await signUpForProject(
            project.id,
            scheduleId,
            payload,
            values.comment,
            sendWaiver ? waiverSignature : null,
            formData,
          );

          if (result.error) {
            logSignupClientDebug({
              step: "anonymous_multi_slot_error",
              projectId: project.id,
              scheduleId,
              slotIndex: index,
              error: result.error,
              traceId: "traceId" in result ? result.traceId : undefined,
            });
            errorMessages.push(result.error);
            continue;
          }

          if (result.success) {
            if (
              "anonymousContinuationToken" in result &&
              typeof result.anonymousContinuationToken === "string"
            ) {
              continuationToken = result.anonymousContinuationToken;
            }
            logSignupClientDebug({
              step: "anonymous_multi_slot_success",
              projectId: project.id,
              scheduleId,
              slotIndex: index,
              needsConfirmation: Boolean(result.needsConfirmation),
              traceId: "traceId" in result ? result.traceId : undefined,
            });
            successfulSignups += 1;
            needsConfirmation = needsConfirmation || !!result.needsConfirmation;
            confirmationAccepted ||= result.confirmationDelivery === "accepted";

            if (!result.needsConfirmation) {
              setHasSignedUp((prev) => ({ ...prev, [scheduleId]: true }));
              setRemainingSlots((prev) => ({
                ...prev,
                [scheduleId]: Math.max(0, (prev[scheduleId] || 0) - 1),
              }));
            }
          }
        }

        if (successfulSignups > 0) {
          if (needsConfirmation) {
            setConfirmationEmailAccepted(confirmationAccepted);
            setShowConfirmationAlert(true);
            toast.success(
              successfulSignups > 1
                ? `Signup initiated for ${successfulSignups} slots!`
                : "Signup initiated!",
              {
                description: confirmationAccepted
                  ? "Please check your email to confirm your signup."
                  : "Your signup is saved, but email delivery could not be confirmed. Check your inbox or request a new confirmation link.",
                duration: 5000,
              },
            );
          } else {
            toast.success(
              successfulSignups > 1
                ? `Successfully signed up for ${successfulSignups} slots!`
                : "Successfully signed up!",
              {
                duration: 5000,
              },
            );

            await refetchAttendees();
            router.refresh();
          }
        }

        if (errorMessages.length > 0) {
          const firstError = errorMessages[0];
          const remaining = errorMessages.length - 1;
          toast.error(
            remaining > 0
              ? `${firstError} (+${remaining} more issue${remaining > 1 ? "s" : ""})`
              : firstError,
          );
        }
      } catch (error) {
        safeConsole.error(
          "Error processing multi-slot anonymous signup:",
          error,
        );
        toast.error("An unexpected error occurred. Please try again.");
      } finally {
        setLoadingStates((prev) => {
          const next = { ...prev };
          scheduleIds.forEach((id) => {
            next[id] = false;
          });
          return next;
        });
        closeAnonymousFlows();
      }
    })();
  };

  return { handleSignUp, handleAnonymousSubmit };
}
