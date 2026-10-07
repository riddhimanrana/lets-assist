"use client";
import { safeConsole } from "@/lib/safe-console";

import {
  Project,
  SameDayMultiAreaRole,
  Organization,
  ProjectStatus,
  AnonymousSignupData,
  Signup,
  WaiverDefinitionFull,
  WaiverSignatureInput,
} from "@/types";
import { AuthUser } from "@/lib/supabase/types";
import type { ProjectCreatorProfileRecord } from "@/lib/profile/public";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { LocationMapCard } from "@/app/projects/_components/LocationMapCard";
import {
  CheckCircle2,
  Clock,
  UserPlus,
  LogIn,
  Loader2,
  AlertTriangle,
  XCircle,
  Mail,
  Pause,
  MailCheck,
  Shield,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  signUpForProject,
  resendAnonymousConfirmationEmail,
  getProjectWaiver,
  updateProjectStatus,
} from "./actions";
import {
  formatTimeTo12Hour,
  cn,
  copyToClipboard,
  isMobileDevice,
} from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  getMultiDaySlotDisplayName,
  getMultiDaySlotByScheduleId,
  isSlotAvailable,
  isMultiDaySlotPastByScheduleId,
  isSameDayMultiAreaSlotPast,
  isOneTimeSlotPast,
  isForwardProjectStatusTransition,
} from "@/utils/project";
import { formatDateDisplay, getProjectStatus } from "@/utils/project"; // Import the getProjectStatus utility and date utils
import {
  startTransition,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import {
  type SignupAttemptResult,
  useSignupConfirmationAction,
} from "@/app/projects/_components/useSignupConfirmationAction";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import FilePreview from "@/app/projects/_components/FilePreview";
import CreatorDashboard from "./CreatorDashboard";
import { ProjectDetailsAside } from "./ProjectDetailsAside";
import { ProjectDetailsHeader } from "./ProjectDetailsHeader";
import { ProjectDocumentsCard } from "./ProjectDocumentsCard";
import { ProjectEmailConfirmationDialog } from "./ProjectEmailConfirmationDialog";
import {
  ProjectSignupBar,
  ProjectSignupCta,
  type ProjectSignupCtaState,
} from "./ProjectSignupCta";
import {
  ProjectSlotRow,
  formatScheduleDay,
  formatSlotTimeRange,
} from "./ProjectSlotRow";
// Import the new UserDashboard
import UserDashboard from "./UserDashboard";
import { ProjectSignupForm } from "./ProjectForm";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
// Import User type from supabase
// import { User } from "@supabase/supabase-js";
import ProjectInstructionsModal from "./ProjectInstructionsModalWrapper";
import {
  SlotAttendeesDropdown,
  type SlotAttendee,
} from "@/components/projects/SlotAttendeesDropdown";
import { SignupConfirmationModal } from "@/app/projects/_components/SignupConfirmationModal";
import { CancelSignupModal } from "@/app/projects/_components/CancelSignupModal";
import CalendarOptionsModal from "@/app/projects/_components/CalendarOptionsModal";
import {
  TurnstileComponent,
  type TurnstileRef,
} from "@/components/ui/turnstile";
import { SecureCheckPanel } from "@/components/auth/SecureCheckPanel";
import { useSecureCheck } from "@/hooks/useSecureCheck";
import { ReportContentButton } from "@/components/feedback/ReportContentButton";
import { Checkbox } from "@/components/ui/checkbox";
import { shouldRenderTurnstileWidget } from "@/lib/anonymous-signup-security";

interface SlotData {
  remainingSlots: Record<string, number>;
  userSignups: Record<string, boolean>;
  rejectedSlots: Record<string, boolean>;
  // Add new property to track attended status
  attendedSlots: Record<string, boolean>;
  pendingSlots: Record<string, boolean>;
}

interface AnonymousSlotOption {
  scheduleId: string;
  title: string;
  subtitle: string;
}

const EMPTY_DEMO_ATTENDEES: SlotAttendee[] = [];

interface Props {
  project: Project;
  creator: ProjectCreatorProfileRecord | null;
  organization?: Organization | null;
  initialSlotData: SlotData;
  initialIsCreator: boolean;
  initialCanManageProject: boolean;
  // Use the specific AuthUser type
  initialUser: AuthUser | null;
  // Add prop for full signup data
  userSignupsData: Signup[];
  allSignups?: Array<
    Pick<Signup, "id" | "schedule_id" | "status" | "check_in_time">
  >;
  demoMode?: boolean;
  demoPublicAttendees?: SlotAttendee[];
}

export default function ProjectDetails({
  project,
  creator,
  organization,
  initialSlotData,
  initialIsCreator,
  initialCanManageProject,
  initialUser,
  // Destructure the new prop
  userSignupsData,
  allSignups = [],
  demoMode = false,
  demoPublicAttendees = EMPTY_DEMO_ATTENDEES,
}: Props) {
  const router = useRouter();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {},
  );
  const [isCreator] = useState(initialIsCreator);
  const [canManageProject] = useState(initialCanManageProject);
  const [remainingSlots, setRemainingSlots] = useState<Record<string, number>>(
    initialSlotData.remainingSlots,
  );
  const [hasSignedUp, setHasSignedUp] = useState<Record<string, boolean>>(
    initialSlotData.userSignups,
  );
  // Use the specific AuthUser type
  const [user] = useState<AuthUser | null>(initialUser);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false);
  const [anonymousSlotSelectionOpen, setAnonymousSlotSelectionOpen] =
    useState(false);
  const [currentScheduleId, setCurrentScheduleId] = useState<string>("");
  const [selectedAnonymousScheduleIds, setSelectedAnonymousScheduleIds] =
    useState<string[]>([]);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Initialize rejectedSlots from props instead of empty object
  const [rejectedSlots, setRejectedSlots] = useState<Record<string, boolean>>(
    initialSlotData.rejectedSlots || {},
  );

  // Add state for attended slots
  const [attendedSlots, setAttendedSlots] = useState<Record<string, boolean>>(
    initialSlotData.attendedSlots || {},
  );
  const [pendingSlots, setPendingSlots] = useState<Record<string, boolean>>(
    initialSlotData.pendingSlots || {},
  );

  // Add state for the confirmation alert
  const [showConfirmationAlert, setShowConfirmationAlert] = useState(false);
  const [confirmationEmailAccepted, setConfirmationEmailAccepted] =
    useState(false);

  // Add state for confirmation modals
  const [showSignupConfirmation, setShowSignupConfirmation] = useState(false);
  const signupConfirmation = useSignupConfirmationAction();
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [pendingScheduleId, setPendingScheduleId] = useState<string>("");
  const [publicAttendees, setPublicAttendees] = useState<SlotAttendee[]>(
    demoMode ? demoPublicAttendees : EMPTY_DEMO_ATTENDEES,
  );
  const [waiverDefinition, setWaiverDefinition] =
    useState<WaiverDefinitionFull | null>(null);

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

  useEffect(() => {
    const fetchPublicAttendees = async () => {
      if (demoMode) {
        setPublicAttendees(demoPublicAttendees);
        return;
      }

      // Fetch if public OR if user is a manager
      const shouldFetch = project.show_attendees_publicly || canManageProject;

      if (!shouldFetch) {
        setPublicAttendees((current) =>
          current.length === 0 ? current : EMPTY_DEMO_ATTENDEES,
        );
        return;
      }

      // If not a manager, check visibility
      if (
        !canManageProject &&
        project.visibility !== "public" &&
        project.visibility !== "unlisted"
      ) {
        setPublicAttendees((current) =>
          current.length === 0 ? current : EMPTY_DEMO_ATTENDEES,
        );
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_public_attendees", {
        p_project_id: project.id,
      });

      if (error) {
        safeConsole.error("Error fetching attendees:", error);
        setPublicAttendees([]);
        return;
      }

      setPublicAttendees(data || []);
    };

    fetchPublicAttendees();
  }, [
    project.id,
    project.show_attendees_publicly,
    project.visibility,
    canManageProject,
    demoMode,
    demoPublicAttendees,
  ]);

  // Function to refetch attendees (called after signup/cancel)
  const refetchAttendees = async () => {
    if (demoMode) {
      setPublicAttendees(demoPublicAttendees);
      return;
    }

    const shouldFetch = project.show_attendees_publicly || canManageProject;
    if (!shouldFetch) return;

    if (
      !canManageProject &&
      project.visibility !== "public" &&
      project.visibility !== "unlisted"
    )
      return;

    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_public_attendees", {
      p_project_id: project.id,
    });

    if (error) {
      safeConsole.error("Error refetching attendees:", error);
      return;
    }

    setPublicAttendees(data || []);
  };

  // Add state for calendar modal after signup
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [completedSignup, setCompletedSignup] = useState<{
    signupId: string;
    scheduleId: string;
  } | null>(null);

  // State for resend confirmation email flow
  const [showResendDialog, setShowResendDialog] = useState(false);
  const [resendAnonymousId, setResendAnonymousId] = useState<string | null>(
    null,
  );
  const [isResending, setIsResending] = useState(false);
  const resendTurnstileRef = useRef<TurnstileRef>(null);
  const [resendTurnstileToken, setResendTurnstileToken] = useState<
    string | null
  >(null);
  const resendSecureCheck = useSecureCheck({
    onRetry: () => setResendTurnstileToken(null),
  });
  const resetResendSecureCheck = resendSecureCheck.retry;

  const showResendTurnstile = shouldRenderTurnstileWidget({
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    bypass: process.env.NEXT_PUBLIC_TURNSTILE_BYPASS,
  });

  type SignupStatusRow = { id: string; schedule_id: string };

  // Remove userRejected state as rejectedSlots handles this per slot
  // const [userRejected, setUserRejected] = useState<boolean>(false);

  // Remove the first useEffect for general rejection check
  // useEffect(() => { ... checkPreviousRejection ... }, [user, project.id]);

  // Keep the useEffect for checking rejections per slot
  useEffect(() => {
    async function checkPreviousRejections() {
      if (user) {
        const supabase = createClient();

        // Query for all rejected signups for this user and project
        const { data: rejectedData, error: rejectedError } = (await supabase
          .from("project_signups")
          .select("id, schedule_id")
          .eq("project_id", project.id)
          .eq("user_id", user.id)
          .eq("status", "rejected")) as {
          data: SignupStatusRow[] | null;
          error: { message: string } | null;
        };

        if (rejectedError) {
          safeConsole.error("Error checking for rejections:", rejectedError);
        } else if (rejectedData && rejectedData.length > 0) {
          // Create a record of rejected slots
          const rejections: Record<string, boolean> = {};
          rejectedData.forEach((rejection) => {
            rejections[rejection.schedule_id] = true;
          });

          // Update state with rejected slots
          setRejectedSlots(rejections);
        }

        // Query for all attended signups for this user and project
        const { data: attendedData, error: attendedError } = (await supabase
          .from("project_signups")
          .select("id, schedule_id")
          .eq("project_id", project.id)
          .eq("user_id", user.id)
          .eq("status", "attended")) as {
          data: SignupStatusRow[] | null;
          error: { message: string } | null;
        };

        if (attendedError) {
          safeConsole.error(
            "Error checking for attended status:",
            attendedError,
          );
        } else if (attendedData && attendedData.length > 0) {
          // Create a record of attended slots
          const attended: Record<string, boolean> = {};
          attendedData.forEach((slot) => {
            attended[slot.schedule_id] = true;
          });

          // Update state with attended slots
          setAttendedSlots(attended);
          // Capture a completed signup for calendar modal and certificate display
          setCompletedSignup({
            signupId: attendedData[0].id,
            scheduleId: attendedData[0].schedule_id,
          });
        }
      } else {
        // Clear rejected and attended slots if user logs out
        setRejectedSlots({});
        setAttendedSlots({});
        setPendingSlots({});
      }
    }

    checkPreviousRejections();
  }, [user, project.id]);

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
        if (returnToModal && projectId === project.id && user) {
          // Clear the state
          sessionStorage.removeItem("signupModalState");

          // If returning from OAuth, set the just connected flag
          if (oauthSuccess === "connected") {
            sessionStorage.setItem("calendarJustConnected", "true");

            // Clean URL
            window.history.replaceState({}, "", `/projects/${project.id}`);
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
  }, [project.id, user]);

  useEffect(() => {
    if (!project.waiver_required) return;
    let isMounted = true;

    const fetchWaiverConfig = async () => {
      try {
        const result = await getProjectWaiver(project.id);
        if (!isMounted) return;

        if (result.error) {
          safeConsole.error("Error fetching waiver config:", result.error);
          return;
        }

        if (result.definition) {
          setWaiverDefinition(result.definition as WaiverDefinitionFull);
        }
      } catch (error) {
        safeConsole.error("Error fetching waiver configuration:", error);
      }
    };

    fetchWaiverConfig();

    return () => {
      isMounted = false;
    };
  }, [project.id, project.waiver_required]);

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

  // Helper function to get attendees for a specific schedule slot
  const getAttendeesForSlot = (scheduleId: string): SlotAttendee[] => {
    // Show to managers even if not public
    if (!project.show_attendees_publicly && !canManageProject) return [];
    return publicAttendees.filter(
      (attendee) => attendee.schedule_id === scheduleId,
    );
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

  const isAnonymousSlotSelectable = useCallback(
    (scheduleId: string) => {
      if (isCreator || calculatedStatus === "cancelled") return false;
      if (
        hasSignedUp[scheduleId] ||
        rejectedSlots[scheduleId] ||
        attendedSlots[scheduleId]
      )
        return false;
      if ((remainingSlots[scheduleId] ?? 0) === 0) return false;

      if (project.event_type === "multiDay") {
        return !isMultiDaySlotPastByScheduleId(project, scheduleId);
      }

      if (project.event_type === "sameDayMultiArea") {
        return !isSameDayMultiAreaSlotPast(project, scheduleId);
      }

      return true;
    },
    [
      isCreator,
      calculatedStatus,
      hasSignedUp,
      rejectedSlots,
      attendedSlots,
      remainingSlots,
      project,
    ],
  );

  const formatScheduleDateLabel = useCallback((dateStr: string) => {
    const [year, month, dayNum] = dateStr.split("-").map(Number);
    if (!year || !month || !dayNum) return dateStr;
    const date = new Date(year, month - 1, dayNum);
    if (isNaN(date.getTime())) return dateStr;
    return format(date, "EEE, MMM d");
  }, []);

  const anonymousSlotOptions = useMemo<AnonymousSlotOption[]>(() => {
    if (project.event_type === "oneTime") {
      return [];
    }

    if (project.event_type === "multiDay" && project.schedule.multiDay) {
      return project.schedule.multiDay.flatMap((day, dayIndex) => {
        return day.slots
          .map((slot, idx) => {
            const scheduleId = `${day.date}-${dayIndex}-${idx}`;
            if (!isAnonymousSlotSelectable(scheduleId)) return null;

            const startLabel = slot.startTime
              ? formatTimeTo12Hour(slot.startTime)
              : "TBD";
            const endLabel = slot.endTime
              ? formatTimeTo12Hour(slot.endTime)
              : undefined;
            const timeLabel = endLabel
              ? `${startLabel} - ${endLabel}`
              : startLabel;

            return {
              scheduleId,
              title: `${formatScheduleDateLabel(day.date)} · ${getMultiDaySlotDisplayName(slot, idx)}`,
              subtitle: `${timeLabel} • ${remainingSlots[scheduleId] ?? slot.volunteers} spot(s) left`,
            };
          })
          .filter(
            (slotOption): slotOption is AnonymousSlotOption => !!slotOption,
          );
      });
    }

    if (
      project.event_type === "sameDayMultiArea" &&
      project.schedule.sameDayMultiArea
    ) {
      return project.schedule.sameDayMultiArea.roles
        .map((role) => {
          const scheduleId = role.name;
          if (!isAnonymousSlotSelectable(scheduleId)) return null;

          const startLabel = role.startTime
            ? formatTimeTo12Hour(role.startTime)
            : "TBD";
          const endLabel = role.endTime
            ? formatTimeTo12Hour(role.endTime)
            : undefined;
          const timeLabel = endLabel
            ? `${startLabel} - ${endLabel}`
            : startLabel;

          return {
            scheduleId,
            title: role.name,
            subtitle: `${timeLabel} • ${remainingSlots[scheduleId] ?? role.volunteers} spot(s) left`,
          };
        })
        .filter(
          (slotOption): slotOption is AnonymousSlotOption => !!slotOption,
        );
    }

    return [];
  }, [
    project,
    isCreator,
    calculatedStatus,
    hasSignedUp,
    rejectedSlots,
    attendedSlots,
    remainingSlots,
    isAnonymousSlotSelectable,
    formatScheduleDateLabel,
  ]);

  const closeAnonymousFlows = () => {
    setAnonymousSlotSelectionOpen(false);
    setAnonymousDialogOpen(false);
    setSelectedAnonymousScheduleIds([]);
    setCurrentScheduleId("");
  };

  const continueToAnonymousForm = () => {
    if (selectedAnonymousScheduleIds.length === 0) {
      toast.error("Select at least one slot to continue.");
      return;
    }

    setCurrentScheduleId(selectedAnonymousScheduleIds[0]);
    setAnonymousSlotSelectionOpen(false);
    setAnonymousDialogOpen(true);
  };

  const toggleAnonymousSlotSelection = (
    scheduleId: string,
    checked: boolean,
  ) => {
    setSelectedAnonymousScheduleIds((prev) => {
      if (checked) {
        return prev.includes(scheduleId) ? prev : [...prev, scheduleId];
      }
      return prev.filter((id) => id !== scheduleId);
    });
  };

  const logSignupClientDebug = (payload: Record<string, unknown>) => {
    safeConsole.log("[signup-client-debug]", JSON.stringify(payload));
  };

  const formatSlotCapacity = (value: unknown) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  };

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
      signupConfirmation.reset();
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

  // Handle confirmation modal actions
  const handleConfirmSignup = async (
    comment?: string,
    waiverSignature?: WaiverSignatureInput | null,
    formData?: Record<string, unknown>,
  ) => {
    if (!pendingScheduleId) return;
    logSignupClientDebug({
      step: "confirmation_modal_submit",
      projectId: project.id,
      scheduleId: pendingScheduleId,
      hasComment: Boolean(comment),
      hasWaiverSignature: Boolean(waiverSignature),
      hasFormData: Boolean(formData && Object.keys(formData).length > 0),
    });
    await signupConfirmation.submit(
      handleSignUp,
      [pendingScheduleId, undefined, comment, waiverSignature, formData],
      () => {
        setShowSignupConfirmation(false);
        setPendingScheduleId("");
      },
    );
  };

  const handleCloseModals = () => {
    setShowSignupConfirmation(false);
    setShowCancelConfirmation(false);
    setPendingScheduleId("");
    signupConfirmation.reset();
  };

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
          logSignupClientDebug({
            step: "anonymous_multi_slot_submit",
            projectId: project.id,
            scheduleId,
            slotIndex: index,
            totalSlots: scheduleIds.length,
            reuseWaiver: index === 0,
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
            index === 0 ? waiverSignature : null,
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

  // Handle resending confirmation email
  const handleResendConfirmation = async () => {
    if (!resendAnonymousId) return;

    setIsResending(true);
    try {
      const result = await resendAnonymousConfirmationEmail(
        resendAnonymousId,
        resendTurnstileToken ?? undefined,
      );

      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success("Confirmation email sent!", {
          description:
            "Please check your email inbox (and spam folder) for the confirmation link.",
          duration: 6000,
        });
        setShowResendDialog(false);
      }
    } catch (error) {
      safeConsole.error("Error resending confirmation:", error);
      toast.error("Failed to resend confirmation email. Please try again.");
    } finally {
      resendTurnstileRef.current?.reset();
      setResendTurnstileToken(null);
      setIsResending(false);
    }
  };

  useEffect(() => {
    if (showResendDialog) return;

    // Closing the dialog unmounts the widget, so start the next attempt (and
    // its bounded wait) from scratch.
    resetResendSecureCheck();
  }, [resetResendSecureCheck, showResendDialog]);

  // Redirect to auth pages
  const redirectToAuth = (path: "login" | "signup") => {
    sessionStorage.setItem("redirect_after_auth", window.location.href);
    router.push(
      `/${path}?redirect=${encodeURIComponent(window.location.pathname)}`,
    );
  };

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

  // Preview document
  const openPreview = (
    url: string,
    fileName: string = "Document",
    fileType: string = "",
  ) => {
    setPreviewDoc(url);
    setPreviewDocName(fileName);
    setPreviewDocType(fileType);
    setPreviewOpen(true);
  };

  const renderSignupButton = (scheduleId: string) => {
    if (isCreator) {
      return "You are the creator";
    }

    // Check if this particular slot is rejected
    if (rejectedSlots[scheduleId]) {
      return (
        <HoverCard>
          <HoverCardTrigger
            render={
              <span className="flex items-center gap-1.5">
                <XCircle className="size-4" />
                Rejected
              </span>
            }
          />
          <HoverCardContent className="w-80 p-3">
            <p className="text-sm">
              Your signup for this slot has been rejected by the project
              coordinator. Please contact them directly if you have questions.
            </p>
            {creator?.email && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full text-xs"
                onClick={() => {
                  window.location.href = `mailto:${creator.email}?subject=Regarding rejected signup for: ${project.title}`;
                }}
              >
                <Mail className="h-3.5 w-3.5 mr-1.5" />
                Contact Project Coordinator
              </Button>
            )}
          </HoverCardContent>
        </HoverCard>
      );
    }

    // Check if user has attended this slot
    if (attendedSlots[scheduleId]) {
      return (
        <HoverCard>
          <HoverCardTrigger
            render={
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4" />
                Attended
              </span>
            }
          />
          <HoverCardContent className="w-80 p-3">
            <p className="text-sm">
              You have been marked as attended for this slot. Attendance records
              cannot be changed.
            </p>
          </HoverCardContent>
        </HoverCard>
      );
    }

    if (pendingSlots[scheduleId]) {
      return (
        <HoverCard>
          <HoverCardTrigger
            render={
              <span className="flex items-center gap-1.5">
                <Clock className="size-4" />
                Pending approval
              </span>
            }
          />
          <HoverCardContent className="w-80 p-3">
            <p className="text-sm">
              Your signup for this slot is pending coordinator approval. You can
              still cancel it if your plans change.
            </p>
          </HoverCardContent>
        </HoverCard>
      );
    }

    if (hasSignedUp[scheduleId]) {
      return (
        <>
          <XCircle className="size-4" />
          Cancel signup
        </>
      );
    }

    if (remainingSlots[scheduleId] === 0) {
      return "Full";
    }

    if (loadingStates[scheduleId]) {
      return (
        <>
          <Loader2 className="size-4 animate-spin" />
          Processing...
        </>
      );
    }

    if (calculatedStatus === "cancelled") {
      return "Unavailable";
    }

    return (
      <>
        <UserPlus className="size-4" />
        Sign up
      </>
    );
  };

  // One button per slot. The label carries the slot's state; the page's single
  // filled action lives in the header and the phone sign-up bar.
  const renderSlotAction = (scheduleId: string, isPast: boolean) => (
    <Button
      variant={
        hasSignedUp[scheduleId] && !pendingSlots[scheduleId]
          ? "secondary"
          : rejectedSlots[scheduleId]
            ? "destructive"
            : "outline"
      }
      onClick={() => handleSignUpClick(scheduleId)}
      disabled={
        isCreator ||
        loadingStates[scheduleId] ||
        calculatedStatus === "cancelled" ||
        isPast ||
        rejectedSlots[scheduleId] ||
        attendedSlots[scheduleId] ||
        (!hasSignedUp[scheduleId] && remainingSlots[scheduleId] === 0)
      }
    >
      {isPast ? "Time passed" : renderSignupButton(scheduleId)}
    </Button>
  );

  const showSlotAttendees = project.show_attendees_publicly || canManageProject;

  const oneTimeOpen =
    project.event_type === "oneTime" &&
    Boolean(project.schedule.oneTime) &&
    !hasSignedUp["oneTime"] &&
    !pendingSlots["oneTime"] &&
    !rejectedSlots["oneTime"] &&
    !attendedSlots["oneTime"] &&
    remainingSlots["oneTime"] !== 0 &&
    !isOneTimeSlotPast(project);
  const signupCta: ProjectSignupCtaState | null =
    isCreator ||
    calculatedStatus === "cancelled" ||
    calculatedStatus === "completed"
      ? null
      : project.event_type === "oneTime"
        ? oneTimeOpen
          ? {
              label: "Sign up",
              onClick: () => handleSignUpClick("oneTime"),
              loading: loadingStates["oneTime"],
            }
          : null
        : {
            label: "Choose a slot",
            onClick: () =>
              document
                .getElementById("volunteer-opportunities")
                ?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                  block: "start",
                }),
          };

  const enableSavedAnonymousInfoReuse = project.event_type !== "oneTime";

  return (
    <>
      <div className="container mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <ProjectEmailConfirmationDialog
          open={showConfirmationAlert}
          onOpenChange={setShowConfirmationAlert}
          onCopyLink={() => {
            copyToClipboard(window.location.href);
            toast.success("Project link copied to clipboard!");
          }}
        />

        <ProjectDetailsHeader
          title={project.title}
          status={calculatedStatus}
          when={formatDateDisplay(project)}
          location={project.location}
          hostName={
            project.organization?.name || creator?.full_name || "Anonymous"
          }
          hostIsOrganization={Boolean(project.organization)}
          hostVerified={Boolean(project.organization?.verified)}
          primaryAction={
            signupCta ? (
              <ProjectSignupCta cta={signupCta} className="hidden lg:flex" />
            ) : null
          }
          onShare={handleShare}
          onReport={
            canManageProject ? undefined : () => setIsReportDialogOpen(true)
          }
        />
        {/* Fixed Report Content Dialog - kept outside the menu so it stays mounted when the menu closes */}
        <ReportContentButton
          contentType="project"
          contentId={project.id}
          contentTitle={project.title}
          contentCreator={creator?.full_name || creator?.username || undefined}
          contentContext={organization?.name || undefined}
          open={isReportDialogOpen}
          onOpenChange={setIsReportDialogOpen}
          showTrigger={false}
        />

        {isCreator && (
          <CreatorDashboard
            project={project}
            allSignups={allSignups || []}
            canSyncProjectCalendar={isCreator}
          />
        )}
        {/* Render User Dashboard if user is logged in, NOT creator, and has signups */}
        {user &&
          !isCreator &&
          userSignupsData &&
          userSignupsData.length > 0 && (
            <UserDashboard
              project={project}
              user={user}
              signups={userSignupsData}
            />
          )}
        {/* Project Content */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Left Column */}
          <div className="grid content-start gap-6 lg:col-span-3">
            {/* About Section */}
            <section className="grid gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                About this project
              </h2>
              <RichTextContent
                content={project.description}
                className="text-muted-foreground max-w-prose text-sm"
              />
            </section>

            {/* Volunteer Opportunities */}
            <Card id="volunteer-opportunities" className="scroll-mt-20">
              <CardHeader>
                <div className="flex w-full items-center justify-between gap-2">
                  <CardTitle>Volunteer opportunities</CardTitle>
                  {/* Add the volunteer guide button only for non-managers */}
                  {!canManageProject && (
                    <ProjectInstructionsModal
                      project={project}
                      isCreator={false}
                      buttonSize="sm"
                      buttonClassName="whitespace-nowrap"
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {project.pause_signups && (
                  <Alert variant="warning">
                    <Pause aria-hidden="true" />
                    <AlertTitle>Signups are currently paused</AlertTitle>
                    <AlertDescription>
                      The project organizer has temporarily paused new volunteer
                      signups. Please check back later or contact the organizer.
                    </AlertDescription>
                  </Alert>
                )}

                {project.event_type === "oneTime" &&
                  project.schedule.oneTime && (
                    <div className="grid gap-2">
                      <h3 className="text-sm font-medium">
                        {formatScheduleDay(project.schedule.oneTime.date)}
                      </h3>
                      <ul className="divide-y">
                        <ProjectSlotRow
                          timeLabel={formatSlotTimeRange(
                            project.schedule.oneTime.startTime,
                            project.schedule.oneTime.endTime,
                          )}
                          timezone={project.project_timezone}
                          remaining={
                            remainingSlots["oneTime"] ??
                            formatSlotCapacity(
                              project.schedule.oneTime.volunteers,
                            )
                          }
                          capacity={formatSlotCapacity(
                            project.schedule.oneTime.volunteers,
                          )}
                          action={renderSlotAction(
                            "oneTime",
                            isOneTimeSlotPast(project),
                          )}
                          attendees={
                            showSlotAttendees ? (
                              <SlotAttendeesDropdown
                                attendees={getAttendeesForSlot("oneTime")}
                              />
                            ) : null
                          }
                        />
                      </ul>
                    </div>
                  )}

                {project.event_type === "multiDay" &&
                  project.schedule.multiDay &&
                  project.schedule.multiDay.map((day, dayIndex) => {
                    const allSlotsInDayPast = day.slots.every(
                      (slot, slotIndex) =>
                        isMultiDaySlotPastByScheduleId(
                          project,
                          `${day.date}-${dayIndex}-${slotIndex}`,
                        ),
                    );

                    return (
                      <div
                        key={`${day.date}-${dayIndex}`}
                        className="grid gap-2 border-t pt-4 first:border-t-0 first:pt-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">
                            {formatScheduleDay(day.date)}
                          </h3>
                          {allSlotsInDayPast && (
                            <Badge variant="secondary">Passed</Badge>
                          )}
                        </div>
                        <ul
                          className={cn(
                            "divide-y",
                            allSlotsInDayPast && "opacity-50",
                          )}
                        >
                          {day.slots.map((slot, slotIndex) => {
                            const scheduleId = `${day.date}-${dayIndex}-${slotIndex}`;
                            return (
                              <ProjectSlotRow
                                key={scheduleId}
                                title={getMultiDaySlotDisplayName(
                                  slot,
                                  slotIndex,
                                )}
                                timeLabel={formatSlotTimeRange(
                                  slot.startTime,
                                  slot.endTime,
                                )}
                                timezone={project.project_timezone}
                                remaining={
                                  remainingSlots[scheduleId] ??
                                  formatSlotCapacity(slot.volunteers)
                                }
                                capacity={formatSlotCapacity(slot.volunteers)}
                                action={renderSlotAction(
                                  scheduleId,
                                  isMultiDaySlotPastByScheduleId(
                                    project,
                                    scheduleId,
                                  ),
                                )}
                                attendees={
                                  showSlotAttendees ? (
                                    <SlotAttendeesDropdown
                                      attendees={getAttendeesForSlot(
                                        scheduleId,
                                      )}
                                    />
                                  ) : null
                                }
                              />
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}

                {project.event_type === "sameDayMultiArea" &&
                  project.schedule.sameDayMultiArea && (
                    <div className="grid gap-2">
                      <h3 className="text-sm font-medium">
                        {formatScheduleDay(
                          project.schedule.sameDayMultiArea.date,
                        )}
                      </h3>
                      <ul className="divide-y">
                        {project.schedule.sameDayMultiArea.roles.map((role) => (
                          <ProjectSlotRow
                            key={role.name}
                            title={role.name}
                            timeLabel={formatSlotTimeRange(
                              role.startTime,
                              role.endTime,
                            )}
                            timezone={project.project_timezone}
                            remaining={
                              remainingSlots[role.name] ??
                              formatSlotCapacity(role.volunteers)
                            }
                            capacity={formatSlotCapacity(role.volunteers)}
                            action={renderSlotAction(
                              role.name,
                              isSameDayMultiAreaSlotPast(project, role.name),
                            )}
                            attendees={
                              showSlotAttendees ? (
                                <SlotAttendeesDropdown
                                  attendees={getAttendeesForSlot(role.name)}
                                />
                              ) : null
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Message for cancelled projects */}
                {calculatedStatus === "cancelled" && (
                  <Alert variant="destructive">
                    <AlertTriangle aria-hidden="true" />
                    <AlertDescription>
                      <p>
                        This project has been cancelled and is no longer
                        accepting signups.
                      </p>
                      {project.cancellation_reason && (
                        <p className="mt-1">
                          <span className="font-medium">Reason:</span>{" "}
                          {project.cancellation_reason}
                        </p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Message for completed projects */}
                {calculatedStatus === "completed" && (
                  <Alert>
                    <CheckCircle2 aria-hidden="true" />
                    <AlertDescription>
                      This project has been completed and is no longer accepting
                      signups.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column */}
          <div className="grid content-start gap-6 lg:col-span-2">
            <ProjectDetailsAside
              project={project}
              creator={creator}
              eagerImage={Boolean(demoMode)}
              onPreviewImage={openPreview}
            />

            {/* Location Map */}
            <LocationMapCard
              location={project.location}
              locationData={project.location_data}
            />

            {/* Project Documents Section */}
            {project.documents && project.documents.length > 0 && (
              <ProjectDocumentsCard
                documents={project.documents}
                onPreview={openPreview}
              />
            )}
          </div>
        </div>
      </div>

      {signupCta && !demoMode ? (
        <ProjectSignupBar
          title={project.title}
          detail={formatDateDisplay(project)}
          cta={signupCta}
        />
      ) : null}

      {/* Authentication Dialog */}
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent className="sm:max-w-106.25">
          <DialogHeader>
            <DialogTitle>Authentication Required</DialogTitle>
            <DialogDescription>
              This project requires an account to sign up.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <div className="flex flex-col gap-4">
              <Button
                onClick={() => redirectToAuth("login")}
                className="flex items-center justify-center"
              >
                <LogIn className="size-4" />
                Login to Your Account
              </Button>
              <Button
                onClick={() => redirectToAuth("signup")}
                variant="outline"
                className="flex items-center justify-center"
              >
                <UserPlus className="size-4" />
                Create New Account
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Anonymous Slot Selection Dialog (multi-day / multi-role) */}
      <Dialog
        open={anonymousSlotSelectionOpen}
        onOpenChange={(open) => {
          setAnonymousSlotSelectionOpen(open);
          if (!open) {
            setSelectedAnonymousScheduleIds([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select your slots</DialogTitle>
            <DialogDescription>
              Want to sign up for more than one slot? Select all that apply,
              then continue to quick signup.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {anonymousSlotOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No additional slots are currently available.
              </p>
            ) : (
              anonymousSlotOptions.map((slot) => {
                const checked = selectedAnonymousScheduleIds.includes(
                  slot.scheduleId,
                );

                return (
                  <label
                    key={slot.scheduleId}
                    className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleAnonymousSlotSelection(
                          slot.scheduleId,
                          value === true,
                        )
                      }
                      className="mt-0.5"
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {slot.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {slot.subtitle}
                      </p>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAnonymousFlows}>
              Cancel
            </Button>
            <Button
              onClick={continueToAnonymousForm}
              disabled={selectedAnonymousScheduleIds.length === 0}
            >
              Continue ({selectedAnonymousScheduleIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Anonymous Signup Dialog */}
      <Dialog
        open={anonymousDialogOpen}
        onOpenChange={(open) => {
          setAnonymousDialogOpen(open);
          if (!open) {
            closeAnonymousFlows();
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Quick Sign Up</DialogTitle>
            <DialogDescription>
              {selectedAnonymousScheduleIds.length > 1
                ? `You selected ${selectedAnonymousScheduleIds.length} slots. Fill this once and we'll apply it to all selected slots.`
                : "Please provide your information to sign up. You'll receive an email to confirm your spot."}
            </DialogDescription>
          </DialogHeader>
          <ProjectSignupForm
            onSubmit={handleAnonymousSubmit}
            onCancel={closeAnonymousFlows}
            isSubmitting={loadingStates[currentScheduleId]}
            showCommentField={!!project.enable_volunteer_comments}
            enableSavedInfoReuse={enableSavedAnonymousInfoReuse}
            projectId={project.id}
            waiverRequired={!!project.waiver_required}
            waiverAllowUpload={
              project.waiver_disable_esignature
                ? true
                : (project.waiver_allow_upload ?? true)
            }
            waiverDisableEsignature={project.waiver_disable_esignature ?? false}
            waiverPdfUrl={
              waiverDefinition?.pdf_public_url || project.waiver_pdf_url || null
            }
            waiverDefinition={waiverDefinition}
            signupFormSchema={project.signup_form_schema}
          />
        </DialogContent>
      </Dialog>

      {/* Resend Confirmation Email Dialog */}
      <Dialog open={showResendDialog} onOpenChange={setShowResendDialog}>
        <DialogContent className="sm:max-w-106.25">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-warning" />
              Email Confirmation Pending
            </DialogTitle>
            <DialogDescription className="pt-2">
              You&apos;ve already signed up for this slot but haven&apos;t
              confirmed your email yet. Would you like us to resend the
              confirmation email?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Please check your inbox (and spam folder) for the original
              confirmation email. If you can&apos;t find it, click below to
              receive a new one.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowResendDialog(false)}
                disabled={isResending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleResendConfirmation}
                disabled={
                  isResending || (showResendTurnstile && !resendTurnstileToken)
                }
                className="gap-2"
              >
                {isResending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <MailCheck className="size-4" />
                    Resend Email
                  </>
                )}
              </Button>
            </div>

            {showResendTurnstile && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
                  <Shield className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">
                      Verify before resending
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Complete the security check so we can safely send a fresh
                      confirmation link.
                    </p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <SecureCheckPanel
                    phase={resendSecureCheck.phase}
                    onRetry={resendSecureCheck.retry}
                    className="w-75 rounded-lg border-border/50 bg-background/80"
                    fallbackClassName="w-75 rounded-lg border-border/50 bg-background/80"
                  >
                    <TurnstileComponent
                      action="anonymous-confirmation"
                      key={resendSecureCheck.widgetKey}
                      ref={resendTurnstileRef}
                      onLoad={resendSecureCheck.handleLoad}
                      onVerify={(token) => setResendTurnstileToken(token)}
                      onError={() => {
                        const wasReady = resendSecureCheck.isReady;
                        resendSecureCheck.handleError();
                        setResendTurnstileToken(null);

                        if (wasReady) {
                          toast.error(
                            "Security verification failed. Please try again.",
                          );
                        }
                      }}
                      onExpire={() => setResendTurnstileToken(null)}
                    />
                  </SecureCheckPanel>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Document Preview */}
      <FilePreview
        url={previewDoc || ""}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        fileName={previewDocName}
        fileType={previewDocType}
      />

      {/* Signup Confirmation Modal */}
      {pendingScheduleId && (
        <SignupConfirmationModal
          isOpen={showSignupConfirmation}
          onClose={handleCloseModals}
          onConfirm={handleConfirmSignup}
          enableVolunteerComments={!!project.enable_volunteer_comments}
          waiverRequired={!!project.waiver_required}
          waiverAllowUpload={
            project.waiver_disable_esignature
              ? true
              : (project.waiver_allow_upload ?? true)
          }
          waiverDisableEsignature={project.waiver_disable_esignature ?? false}
          waiverPdfUrl={
            waiverDefinition?.pdf_public_url || project.waiver_pdf_url || null
          }
          waiverDefinition={waiverDefinition}
          signupFormSchema={project.signup_form_schema}
          project={{
            id: project.id,
            title: project.title,
            date: (() => {
              // Get the appropriate date from the schedule
              if (
                project.event_type === "oneTime" &&
                project.schedule.oneTime
              ) {
                return project.schedule.oneTime.date;
              } else if (
                project.event_type === "multiDay" &&
                project.schedule.multiDay
              ) {
                const slotData = getMultiDaySlotByScheduleId(
                  project,
                  pendingScheduleId,
                );
                return (
                  slotData?.day.date || project.schedule.multiDay[0]?.date || ""
                );
              } else if (
                project.event_type === "sameDayMultiArea" &&
                project.schedule.sameDayMultiArea
              ) {
                return project.schedule.sameDayMultiArea.date;
              }
              return "";
            })(),
            location: project.location,
            start_time: (() => {
              // Get the appropriate start time from the schedule
              if (
                project.event_type === "oneTime" &&
                project.schedule.oneTime
              ) {
                return project.schedule.oneTime.startTime;
              } else if (
                project.event_type === "multiDay" &&
                project.schedule.multiDay
              ) {
                const slotData = getMultiDaySlotByScheduleId(
                  project,
                  pendingScheduleId,
                );
                return slotData?.slot.startTime;
              } else if (
                project.event_type === "sameDayMultiArea" &&
                project.schedule.sameDayMultiArea
              ) {
                const role = project.schedule.sameDayMultiArea.roles.find(
                  (r: SameDayMultiAreaRole) => r.name === pendingScheduleId,
                );
                return role?.startTime;
              }
              return undefined;
            })(),
            end_time: (() => {
              // Get the appropriate end time from the schedule
              if (
                project.event_type === "oneTime" &&
                project.schedule.oneTime
              ) {
                return project.schedule.oneTime.endTime;
              } else if (
                project.event_type === "multiDay" &&
                project.schedule.multiDay
              ) {
                const slotData = getMultiDaySlotByScheduleId(
                  project,
                  pendingScheduleId,
                );
                return slotData?.slot.endTime;
              } else if (
                project.event_type === "sameDayMultiArea" &&
                project.schedule.sameDayMultiArea
              ) {
                const role = project.schedule.sameDayMultiArea.roles.find(
                  (r: SameDayMultiAreaRole) => r.name === pendingScheduleId,
                );
                return role?.endTime;
              }
              return undefined;
            })(),
          }}
          scheduleId={pendingScheduleId}
          isLoading={loadingStates[pendingScheduleId]}
          error={signupConfirmation.error}
        />
      )}

      {/* Cancel Confirmation Modal */}
      {/* Cancel Signup Modal */}
      {pendingScheduleId && user && (
        <CancelSignupModal
          isOpen={showCancelConfirmation}
          onClose={handleCloseModals}
          onSuccess={(scheduleId) => {
            // Handle successful cancellation
            setHasSignedUp((prev) => ({ ...prev, [scheduleId]: false }));
            setRemainingSlots((prev) => ({
              ...prev,
              [scheduleId]: (prev[scheduleId] || 0) + 1,
            }));
            // Refetch attendees to update the list in real-time
            refetchAttendees();
          }}
          project={{
            title: project.title,
            date: (() => {
              // Get the appropriate date from the schedule
              if (
                project.event_type === "oneTime" &&
                project.schedule.oneTime
              ) {
                return project.schedule.oneTime.date;
              } else if (
                project.event_type === "multiDay" &&
                project.schedule.multiDay
              ) {
                const slotData = getMultiDaySlotByScheduleId(
                  project,
                  pendingScheduleId,
                );
                return (
                  slotData?.day.date || project.schedule.multiDay[0]?.date || ""
                );
              } else if (
                project.event_type === "sameDayMultiArea" &&
                project.schedule.sameDayMultiArea
              ) {
                return project.schedule.sameDayMultiArea.date;
              }
              return "";
            })(),
            location: project.location,
            start_time: (() => {
              // Get the appropriate start time from the schedule
              if (
                project.event_type === "oneTime" &&
                project.schedule.oneTime
              ) {
                return project.schedule.oneTime.startTime;
              } else if (
                project.event_type === "multiDay" &&
                project.schedule.multiDay
              ) {
                const slotData = getMultiDaySlotByScheduleId(
                  project,
                  pendingScheduleId,
                );
                return slotData?.slot.startTime;
              } else if (
                project.event_type === "sameDayMultiArea" &&
                project.schedule.sameDayMultiArea
              ) {
                const role = project.schedule.sameDayMultiArea.roles.find(
                  (r: SameDayMultiAreaRole) => r.name === pendingScheduleId,
                );
                return role?.startTime;
              }
              return undefined;
            })(),
            end_time: (() => {
              // Get the appropriate end time from the schedule
              if (
                project.event_type === "oneTime" &&
                project.schedule.oneTime
              ) {
                return project.schedule.oneTime.endTime;
              } else if (
                project.event_type === "multiDay" &&
                project.schedule.multiDay
              ) {
                const slotData = getMultiDaySlotByScheduleId(
                  project,
                  pendingScheduleId,
                );
                return slotData?.slot.endTime;
              } else if (
                project.event_type === "sameDayMultiArea" &&
                project.schedule.sameDayMultiArea
              ) {
                const role = project.schedule.sameDayMultiArea.roles.find(
                  (r: SameDayMultiAreaRole) => r.name === pendingScheduleId,
                );
                return role?.endTime;
              }
              return undefined;
            })(),
          }}
          projectId={project.id}
          scheduleId={pendingScheduleId}
          userId={user.id}
        />
      )}

      {/* Calendar options modal after successful signup */}
      {completedSignup && (
        <CalendarOptionsModal
          open={showCalendarModal}
          onOpenChange={setShowCalendarModal}
          project={project}
          signup={{
            id: completedSignup.signupId,
            schedule_id: completedSignup.scheduleId,
            project_id: project.id,
            user_id: user?.id || null,
            status: "approved",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            check_in_time: null,
            check_out_time: null,
          }}
          mode="volunteer"
        />
      )}
    </>
  );
}
