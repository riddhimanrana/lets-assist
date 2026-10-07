"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Project, ProjectSignup } from "@/types";
import { publishVolunteerHours, resendCertificateEmails } from "./actions";
import { calculateHoursDuration as calculateDuration } from "./hours-duration";
import type { EditedTime } from "./useHoursEdits";
import type { HoursSessions } from "./useHoursSessions";

/** Publishing hours, viewing issued certificates, and resending their emails. */
export function useHoursPublishing({
  project,
  editedTimes,
  sessions,
}: {
  project: Project;
  editedTimes: Record<string, EditedTime>;
  sessions: HoursSessions;
}) {
  const {
    formatSessionName,
    signupsBySession,
    getAllProjectSessions,
    setPublishedSessions,
    getPublishStateKey,
  } = sessions;

  // State to track which sessions are currently being published
  const [publishingSessions, setPublishingSessions] = useState<
    Record<string, boolean>
  >({});

  // Add state for confirmation dialog
  const [confirmPublishSessionId, setConfirmPublishSessionId] = useState<
    string | null
  >(null);
  const [confirmPublishCount, setConfirmPublishCount] = useState<number>(0);

  // State for publish success modal
  const [showPublishSuccessModal, setShowPublishSuccessModal] = useState(false);
  const [currentPublishedSessionName, setCurrentPublishedSessionName] =
    useState<string>("");
  const [publishSummary, setPublishSummary] = useState<{
    certificatesCreated: number;
    totalVolunteers: number;
    registeredVolunteers: number;
    anonymousVolunteers: number;
    emailsSent: number;
    emailErrors: string[];
    missingEmailCount: number;
  } | null>(null);

  // State for certificates modal
  const [showCertificatesModal, setShowCertificatesModal] = useState(false);
  const [certificatesModalData, setCertificatesModalData] = useState<{
    sessionName: string;
    volunteers: Array<{
      name: string;
      email: string;
      checkInTime: string;
      checkOutTime: string;
      hours: string;
      durationMinutes: number;
    }>;
  } | null>(null);
  const [loadingCertificates, setLoadingCertificates] = useState(false);

  // State for resending certificates
  const [showResendDialog, setShowResendDialog] = useState<string | null>(null);
  const [resendingSessions, setResendingSessions] = useState<
    Record<string, boolean>
  >({});

  // Function to load certificates data for a session
  const loadCertificatesData = async (sessionId: string) => {
    setLoadingCertificates(true);
    try {
      // Find all signups for this session
      let sessionSignups: ProjectSignup[] = [];
      const allSessions = getAllProjectSessions;

      // Try exact match first
      if (signupsBySession[sessionId]) {
        sessionSignups = signupsBySession[sessionId];
      } else {
        // Try all alternative IDs
        const session = allSessions.find(
          (s: {
            id: string;
            name: string;
            endDateTime: Date;
            status: "upcoming" | "in-progress" | "completed" | "editing";
            alternativeIds: string[];
          }) => s.id === sessionId,
        );
        if (session) {
          for (const altId of session.alternativeIds) {
            if (signupsBySession[altId]) {
              sessionSignups = signupsBySession[altId];
              break;
            }
          }
        }
      }

      // Filter to only volunteers with valid hours (those that would have certificates)
      const volunteersWithHours = sessionSignups
        .map((signup) => {
          const edited = editedTimes[signup.id];
          if (!edited || !edited.check_in_time || !edited.check_out_time) {
            return null;
          }
          const duration = calculateDuration(
            edited.check_in_time,
            edited.check_out_time,
          );
          if (!duration.isValid) {
            return null;
          }

          return {
            name:
              signup.profile?.full_name ||
              signup.anonymous_signup?.name ||
              "Anonymous Volunteer",
            email:
              signup.profile?.email || signup.anonymous_signup?.email || "N/A",
            checkInTime: format(
              new Date(edited.check_in_time),
              "MMM d, yyyy h:mm a",
            ),
            checkOutTime: format(
              new Date(edited.check_out_time),
              "MMM d, yyyy h:mm a",
            ),
            hours: duration.text,
            durationMinutes: duration.minutes,
          };
        })
        .filter((v) => v !== null) as Array<{
        name: string;
        email: string;
        checkInTime: string;
        checkOutTime: string;
        hours: string;
        durationMinutes: number;
      }>;

      setCertificatesModalData({
        sessionName: formatSessionName(project, sessionId),
        volunteers: volunteersWithHours,
      });
      setShowCertificatesModal(true);
    } catch (error) {
      safeConsole.error("Error loading certificates data:", error);
      toast.error("Failed to load certificates data");
    } finally {
      setLoadingCertificates(false);
    }
  };

  // Add function to initiate the publish confirmation
  const initiatePublishHours = (sessionId: string) => {
    // Find all signups for this session to show count in confirmation
    let sessionSignups: ProjectSignup[] = [];
    const allSessions = getAllProjectSessions; // Ensure getAllProjectSessions is in scope

    // Try exact match first
    if (signupsBySession[sessionId]) {
      sessionSignups = signupsBySession[sessionId];
    } else {
      // Try all alternative IDs
      const session = allSessions.find(
        (s: {
          id: string;
          name: string;
          endDateTime: Date;
          status: "upcoming" | "in-progress" | "completed" | "editing";
          alternativeIds: string[];
        }) => s.id === sessionId,
      );
      if (session) {
        for (const altId of session.alternativeIds) {
          if (signupsBySession[altId]) {
            sessionSignups = signupsBySession[altId];
            break;
          }
        }
      }
    }

    // Count valid volunteers
    const validVolunteers = sessionSignups.filter((signup) => {
      const edit = editedTimes[signup.id] || {
        check_in_time: null,
        check_out_time: null,
      };
      const duration = calculateDuration(
        edit.check_in_time,
        edit.check_out_time,
      );
      return duration.isValid && edit.check_in_time && edit.check_out_time;
    });

    // Set state for confirmation dialog
    setConfirmPublishCount(validVolunteers.length);
    setConfirmPublishSessionId(sessionId);
  };

  // Modify the handle publish function to be called after confirmation
  const handlePublishHours = async (sessionId: string) => {
    // Close the confirmation dialog
    setConfirmPublishSessionId(null);

    setPublishingSessions((prev: Record<string, boolean>) => ({
      // Added type for prev
      ...prev,
      [sessionId]: true,
    }));

    try {
      // Find all signups for this session
      let sessionSignups: ProjectSignup[] = [];
      // Try exact match first
      if (signupsBySession[sessionId]) {
        sessionSignups = signupsBySession[sessionId];
      } else {
        // Fallback for alternative session IDs (e.g., from getAllProjectSessions)
        const allProjSessions = getAllProjectSessions; // Ensure getAllProjectSessions is in scope
        const targetSessionInfo = allProjSessions.find(
          (s: { id: string; alternativeIds: string[] }) =>
            s.id === sessionId || s.alternativeIds.includes(sessionId),
        );
        if (targetSessionInfo) {
          // Check primary ID first
          if (signupsBySession[targetSessionInfo.id]) {
            sessionSignups = signupsBySession[targetSessionInfo.id];
          } else {
            // Check alternative IDs
            for (const altId of targetSessionInfo.alternativeIds) {
              if (signupsBySession[altId]) {
                sessionSignups = signupsBySession[altId];
                break;
              }
            }
          }
        }
      }

      const volunteersData = sessionSignups
        .map((signup) => {
          const edited = editedTimes[signup.id];
          if (!edited || !edited.check_in_time || !edited.check_out_time) {
            return null; // Skip if no valid times
          }
          const duration = calculateDuration(
            edited.check_in_time,
            edited.check_out_time,
          );
          return {
            signupId: signup.id,
            userId: signup.user_id,
            name:
              signup.profile?.full_name ||
              signup.anonymous_signup?.name ||
              "Anonymous Volunteer",
            email: signup.profile?.email || signup.anonymous_signup?.email,
            checkIn: edited.check_in_time,
            checkOut: edited.check_out_time,
            durationMinutes: duration.minutes,
            isValid: duration.isValid,
          };
        })
        .filter((v) => v !== null && v.isValid) as {
        signupId: string;
        userId: string | null;
        name: string | null;
        email: string | null;
        checkIn: string;
        checkOut: string;
        durationMinutes: number;
        isValid: boolean;
      }[]; // Type assertion

      if (volunteersData.length === 0) {
        toast.error("No Valid Hours", {
          description:
            "No volunteers with valid check-in and check-out times to publish.",
        });
        return;
      }

      const publicationEntries = volunteersData.map((volunteer) => ({
        signupId: volunteer.signupId,
        checkIn: volunteer.checkIn,
        checkOut: volunteer.checkOut,
        isValid: volunteer.isValid,
      }));
      const result = await publishVolunteerHours(
        project.id,
        sessionId,
        publicationEntries,
      );

      if (result.success) {
        const emailsSent = result.emailsSent ?? 0;
        const emailErrors = result.emailErrors ?? [];
        const wasReplayed = result.outcome === "replayed";
        const wasPartial = result.outcome === "partial";

        if (wasReplayed) {
          toast.success("Hours Already Published", {
            description: `The existing publication receipt was replayed safely for session: ${formatSessionName(project, sessionId)}. No certificates were duplicated.`,
          });
        } else if (emailsSent > 0 && !wasPartial) {
          toast.success("Hours Published & Emails Sent!", {
            description: `${result.certificatesCreated} certificates generated and ${emailsSent} email notifications sent for session: ${formatSessionName(project, sessionId)}.`,
          });
        } else if (wasPartial) {
          toast.warning("Hours Published; Delivery Needs Attention", {
            description: `${result.certificatesCreated} certificates were committed for session: ${formatSessionName(project, sessionId)}. Some email work was recorded for safe follow-up.`,
          });
        } else {
          toast.success("Hours Published!", {
            description: `${result.certificatesCreated} certificates generated for session: ${formatSessionName(project, sessionId)}. ${emailErrors.length > 0 ? "However, some email notifications failed to send." : "Email notifications were not sent."}`,
          });
        }

        // Update published status locally
        const publishKey = getPublishStateKey(sessionId); // Ensure getPublishStateKey is in scope
        setPublishedSessions((prev: Record<string, boolean>) => ({
          ...prev,
          [publishKey]: true,
        })); // Corrected to setPublishedSessions and added type for prev

        // Prepare for success modal with updated information
        setCurrentPublishedSessionName(formatSessionName(project, sessionId));

        const totalVolunteers = volunteersData.length;
        const registeredVolunteers = volunteersData.filter(
          (volunteer) => volunteer.userId,
        ).length;
        const anonymousVolunteers = totalVolunteers - registeredVolunteers;
        const missingEmailCount = volunteersData.filter(
          (volunteer) => !volunteer.email,
        ).length;

        // Store email sent information for the modal
        setPublishSummary({
          certificatesCreated: result.certificatesCreated ?? totalVolunteers,
          totalVolunteers,
          registeredVolunteers,
          anonymousVolunteers,
          emailsSent,
          emailErrors,
          missingEmailCount,
        });
        setShowPublishSuccessModal(true);
      } else {
        toast.error("Publishing Failed", {
          description: result.error || "An unknown error occurred.",
        });
      }
    } catch (error) {
      safeConsole.error("Error publishing hours:", error);
      toast.error("Publishing Error", {
        description: "An unexpected error occurred while publishing hours.",
      });
    } finally {
      setPublishingSessions((prev) => ({
        ...prev,
        [sessionId]: false,
      }));
    }
  };

  // Handler for resending certificate emails
  const handleResendCertificates = async (sessionId: string) => {
    setResendingSessions((prev) => ({
      ...prev,
      [sessionId]: true,
    }));

    try {
      const result = await resendCertificateEmails(project.id, sessionId);
      if (!result.success) {
        toast.error("Certificates were not resent", {
          description: result.error || "No eligible certificates were found.",
        });
        return;
      }

      const emailsSent = result.emailsSent ?? 0;
      const emailErrors = result.emailErrors ?? [];
      if (result.deliveryMode === "durable-retry") {
        toast.success(
          `${emailsSent} certificate email${emailsSent === 1 ? " is" : "s are"} confirmed accepted`,
          emailErrors.length > 0
            ? {
                description: `${emailErrors.length} durable delivery item${emailErrors.length === 1 ? " still needs" : "s still need"} attention.`,
              }
            : {
                description:
                  "The durable publication ledger is fully reconciled.",
              },
        );
        return;
      }
      toast.success(
        `${emailsSent} certificate email${emailsSent === 1 ? "" : "s"} resent`,
        emailErrors.length > 0
          ? {
              description: `${emailErrors.length} email${emailErrors.length === 1 ? "" : "s"} could not be sent.`,
            }
          : undefined,
      );
    } catch (error) {
      safeConsole.error("Error resending certificates:", error);
      toast.error("Resend Error", {
        description: "An error occurred while resending certificates.",
      });
    } finally {
      setResendingSessions((prev) => ({
        ...prev,
        [sessionId]: false,
      }));
      setShowResendDialog(null);
    }
  };

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com"
  ).replace(/\/$/, "");
  const certificateBaseUrl = `${siteUrl}/certificates`;
  const publishEmailErrors = publishSummary?.emailErrors ?? [];
  const failedEmailCount = publishEmailErrors.filter((err) => {
    const lower = err.toLowerCase();
    return (
      !lower.includes("missing email") && !lower.includes("skipped certificate")
    );
  }).length;
  const skippedEmailCount = Math.max(
    publishSummary?.missingEmailCount ?? 0,
    publishEmailErrors.length - failedEmailCount,
  );
  const totalVolunteers = publishSummary?.totalVolunteers ?? 0;
  const certificatesCreated = publishSummary?.certificatesCreated ?? 0;
  const emailsSent = publishSummary?.emailsSent ?? 0;
  const registeredVolunteers = publishSummary?.registeredVolunteers ?? 0;
  const anonymousVolunteers = publishSummary?.anonymousVolunteers ?? 0;

  return {
    publishingSessions,
    confirmPublishSessionId,
    setConfirmPublishSessionId,
    confirmPublishCount,
    showPublishSuccessModal,
    setShowPublishSuccessModal,
    currentPublishedSessionName,
    publishSummary,
    setPublishSummary,
    showCertificatesModal,
    setShowCertificatesModal,
    certificatesModalData,
    loadingCertificates,
    showResendDialog,
    setShowResendDialog,
    resendingSessions,
    loadCertificatesData,
    initiatePublishHours,
    handlePublishHours,
    handleResendCertificates,
    certificateBaseUrl,
    failedEmailCount,
    skippedEmailCount,
    totalVolunteers,
    certificatesCreated,
    emailsSent,
    registeredVolunteers,
    anonymousVolunteers,
  };
}

export type HoursPublishing = ReturnType<typeof useHoursPublishing>;
