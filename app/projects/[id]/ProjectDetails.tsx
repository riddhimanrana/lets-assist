"use client";

import {
  Project,
  SameDayMultiAreaRole,
  Organization,
  ProjectStatus,
  ProjectDocument,
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
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { LocationMapCard } from "@/app/projects/_components/LocationMapCard";
import {
  CheckCircle2,
  MapPin,
  Users,
  Share2,
  Clock,
  FileText,
  Download,
  Eye,
  File,
  FileImage,
  Lock,
  UserPlus,
  LogIn,
  Loader2,
  QrCode,
  UserCheck,
  Zap,
  AlertTriangle,
  Building2,
  BadgeCheck,
  XCircle,
  Mail,
  Pause,
  MailCheck,
  MoreVertical,
  Flag,
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
  formatBytes,
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
import { getProjectStatus } from "@/utils/project"; // Import the getProjectStatus utility and date utils
import {
  startTransition,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import {
  OrganizationHoverCard,
  ProfileHoverCard,
} from "@/components/shared/ProfileHoverCard";
import FilePreview from "@/app/projects/_components/FilePreview";
import CreatorDashboard from "./CreatorDashboard";
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
import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
import {
  TurnstileComponent,
  type TurnstileRef,
} from "@/components/ui/turnstile";
import { SecureCheckPanel } from "@/components/auth/SecureCheckPanel";
import { useSecureCheck } from "@/hooks/useSecureCheck";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const getFileIcon = (type: string) => {
  if (type.includes("pdf")) return <FileText className="h-5 w-5" />;
  if (type.includes("image")) return <FileImage className="h-5 w-5" />;
  if (type.includes("text")) return <FileText className="h-5 w-5" />;
  if (type.includes("word")) return <FileText className="h-5 w-5" />;
  return <File className="h-5 w-5" />;
};

const downloadFile = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  } catch (error) {
    console.error("Download error:", error);
  }
};

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
        console.error("Error fetching attendees:", error);
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
      console.error("Error refetching attendees:", error);
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
          console.error("Error checking for rejections:", rejectedError);
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
          console.error("Error checking for attended status:", attendedError);
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
        console.error("Error parsing modal state:", error);
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
          console.error("Error fetching waiver config:", result.error);
          return;
        }

        if (result.definition) {
          setWaiverDefinition(result.definition as WaiverDefinitionFull);
        }
      } catch (error) {
        console.error("Error fetching waiver configuration:", error);
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
      console.error("Error updating project status:", error);
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
        console.log(`Calculated status updated: ${newCalculatedStatus}`);
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
      console.log(
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
          console.log("Status updated via interval:", newStatus);

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
    console.log("[signup-client-debug]", JSON.stringify(payload));
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
          setShowConfirmationAlert(true);
          // Also show a toast as immediate feedback
          toast.success("Signup initiated!", {
            description: "Please check your email to confirm your spot.",
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
              console.error("Error syncing to calendar:", error);
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
      console.error(
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
            setShowConfirmationAlert(true);
            toast.success(
              successfulSignups > 1
                ? `Signup initiated for ${successfulSignups} slots!`
                : "Signup initiated!",
              {
                description: "Please check your email to confirm your signup.",
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
        console.error("Error processing multi-slot anonymous signup:", error);
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
      console.error("Error resending confirmation:", error);
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
          console.error("Share failed:", error);
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

  // Check if file is previewable
  const isPreviewable = (type: string) => {
    return type.includes("pdf") || type.includes("image");
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
                <XCircle className="h-4 w-4" />
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
                <CheckCircle2 className="h-4 w-4" />
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
                <Clock className="h-4 w-4" />
                Pending Approval
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
          <XCircle className="h-4 w-4" />
          Cancel Signup
        </>
      );
    }

    if (remainingSlots[scheduleId] === 0) {
      return "Full";
    }

    if (loadingStates[scheduleId]) {
      return (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing...
        </>
      );
    }

    if (calculatedStatus === "cancelled") {
      return "Unavailable";
    }

    return (
      <>
        <UserPlus className="h-4 w-4" />
        Sign Up
      </>
    );
  };

  const enableSavedAnonymousInfoReuse = project.event_type !== "oneTime";

  return (
    <>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Render project management dashboard for creators and organization admins */}

        {/* Confirmation Dialog */}
        <Dialog
          open={showConfirmationAlert}
          onOpenChange={setShowConfirmationAlert}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-primary/10 p-4">
                  <Mail className="h-8 w-8 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-2xl text-center">
                Check Your Email
              </DialogTitle>
              <DialogDescription className="text-center text-base pt-4">
                We&apos;ve sent a confirmation link to your email address.
                Please click the link to finalize your signup for this project.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted/50 rounded-lg p-4 my-4">
              <p className="text-sm font-medium text-muted-foreground">
                Don&apos;t see the email?
              </p>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                <li>Check your spam or junk folder</li>
                <li>Make sure you entered your email correctly</li>
                <li>Wait a few minutes for it to arrive</li>
              </ul>
            </div>
            <DialogFooter className="gap-2 flex-col-reverse sm:flex-row">
              <Button
                variant="outline"
                onClick={() => setShowConfirmationAlert(false)}
                className="w-full sm:w-auto"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  copyToClipboard(window.location.href);
                  toast.success("Project link copied to clipboard!");
                }}
                className="w-full sm:w-auto"
              >
                Copy Project Link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Project Header */}
        <div className="mb-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex-1 min-w-0 order-1 sm:order-0">
              <h1 className="text-2xl sm:text-3xl font-bold mb-1.5">
                {project.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2 sm:mb-0">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{project.location}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mb-1 sm:mb-0 shrink-0 order-0 sm:order-0 justify-between w-full sm:w-auto">
              {/* Use calculatedStatus instead of project.status */}
              <ProjectStatusBadge
                status={calculatedStatus}
                className="capitalize"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="icon" onClick={handleShare}>
                  <Share2 className="h-4 w-4 shrink-0" />
                </Button>

                {/* Report button - only show for people who do not manage this project */}
                {!canManageProject && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          suppressHydrationWarning
                        >
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">More options</span>
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setIsReportDialogOpen(true)}
                      >
                        <Flag className="mr-2 h-4 w-4" />
                        <span>Report Project</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Fixed Report Content Dialog - moved outside DropdownMenuContent to avoid unmounting when menu closes */}
                <ReportContentButton
                  contentType="project"
                  contentId={project.id}
                  contentTitle={project.title}
                  contentCreator={
                    creator?.full_name || creator?.username || undefined
                  }
                  contentContext={organization?.name || undefined}
                  open={isReportDialogOpen}
                  onOpenChange={setIsReportDialogOpen}
                  showTrigger={false}
                />
              </div>
            </div>
          </div>
        </div>

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
          <div className="lg:col-span-3 space-y-6">
            {/* About Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>About this Project</CardTitle>
              </CardHeader>
              <CardContent>
                <RichTextContent
                  content={project.description}
                  className="text-muted-foreground text-sm"
                />
              </CardContent>
            </Card>

            {/* Volunteer Opportunities */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <CardTitle>Volunteer Opportunities</CardTitle>
                  </div>
                  {/* Add the volunteer guide button only for non-managers */}
                  {!canManageProject && (
                    <ProjectInstructionsModal
                      project={project}
                      isCreator={false}
                      buttonSize="xs"
                      buttonClassName="whitespace-nowrap"
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {project.pause_signups && (
                  <Alert className="bg-warning/15 border-warning/50 mb-4">
                    <Pause className="h-4 w-4 text-warning" />
                    <AlertTitle className="text-warning/90">
                      Signups are currently paused
                    </AlertTitle>
                    <AlertDescription className="text-warning">
                      The project organizer has temporarily paused new volunteer
                      signups. Please check back later or contact the organizer.
                    </AlertDescription>
                  </Alert>
                )}

                {project.event_type === "oneTime" &&
                  project.schedule.oneTime && (
                    <div className="border rounded-lg p-3 sm:p-4 bg-card/50 hover:bg-card/80 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm sm:text-base mb-2">
                            {(() => {
                              // Create date with no timezone offset issues
                              const dateStr = project.schedule.oneTime.date;
                              const [year, month, dayNum] = dateStr
                                .split("-")
                                .map(Number);
                              // Validate date components
                              if (
                                !year ||
                                !month ||
                                !dayNum ||
                                isNaN(year) ||
                                isNaN(month) ||
                                isNaN(dayNum)
                              ) {
                                return "Invalid date";
                              }
                              // Use Date to correctly handle timezones
                              const date = new Date(year, month - 1, dayNum);
                              // Check if date is valid
                              if (isNaN(date.getTime())) {
                                return "Invalid date";
                              }
                              return format(date, "EEEE, MMMM d");
                            })()}
                          </h3>
                          <div className="space-y-1 text-xs sm:text-sm text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                {(() => {
                                  const startLabel = project.schedule.oneTime
                                    .startTime
                                    ? formatTimeTo12Hour(
                                        project.schedule.oneTime.startTime,
                                      )
                                    : "TBD";
                                  const endLabel = project.schedule.oneTime
                                    .endTime
                                    ? formatTimeTo12Hour(
                                        project.schedule.oneTime.endTime,
                                      )
                                    : undefined;
                                  return endLabel
                                    ? `${startLabel} - ${endLabel}`
                                    : startLabel;
                                })()}
                              </span>
                              {project.project_timezone && (
                                <TimezoneBadge
                                  timezone={project.project_timezone}
                                />
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                <span className="font-medium text-foreground">
                                  {remainingSlots["oneTime"] ??
                                    formatSlotCapacity(
                                      project.schedule.oneTime.volunteers,
                                    )}
                                </span>{" "}
                                of{" "}
                                {formatSlotCapacity(
                                  project.schedule.oneTime.volunteers,
                                )}{" "}
                                spots
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 items-stretch sm:items-end shrink-0">
                          <Button
                            variant={
                              pendingSlots["oneTime"]
                                ? "outline"
                                : hasSignedUp["oneTime"]
                                  ? "secondary"
                                  : rejectedSlots["oneTime"]
                                    ? "destructive"
                                    : "default"
                            }
                            size="sm"
                            onClick={() => handleSignUpClick("oneTime")}
                            disabled={
                              isCreator ||
                              loadingStates["oneTime"] ||
                              calculatedStatus === "cancelled" ||
                              isOneTimeSlotPast(project) ||
                              rejectedSlots["oneTime"] ||
                              attendedSlots["oneTime"] ||
                              (!hasSignedUp["oneTime"] &&
                                remainingSlots["oneTime"] === 0)
                            }
                            className={`w-full sm:w-auto ${attendedSlots["oneTime"] || isOneTimeSlotPast(project) ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            {isOneTimeSlotPast(project)
                              ? "Time Passed"
                              : renderSignupButton("oneTime")}
                          </Button>
                        </div>
                      </div>
                      {(project.show_attendees_publicly ||
                        canManageProject) && (
                        <SlotAttendeesDropdown
                          attendees={getAttendeesForSlot("oneTime")}
                        />
                      )}
                    </div>
                  )}

                {project.event_type === "multiDay" &&
                  project.schedule.multiDay && (
                    <div className="space-y-3">
                      {project.schedule.multiDay.map((day, dayIndex) => {
                        const allSlotsInDayPast = day.slots.every(
                          (slot, slotIndex) => {
                            const scheduleId = `${day.date}-${dayIndex}-${slotIndex}`;
                            return isMultiDaySlotPastByScheduleId(
                              project,
                              scheduleId,
                            );
                          },
                        );

                        return (
                          <div key={`${day.date}-${dayIndex}`} className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="font-medium">
                                {(() => {
                                  const dateStr = day.date;
                                  const [year, month, dayNum] = dateStr
                                    .split("-")
                                    .map(Number);
                                  // Use Date to correctly handle timezones
                                  const date = new Date(
                                    year,
                                    month - 1,
                                    dayNum,
                                  );
                                  return format(date, "EEEE, MMMM d");
                                })()}
                              </h3>
                              {allSlotsInDayPast && (
                                <Badge variant="secondary" className="ml-2">
                                  Passed
                                </Badge>
                              )}
                            </div>
                            <div
                              className={`space-y-2 ${allSlotsInDayPast ? "opacity-50" : ""}`}
                            >
                              {day.slots.map((slot, slotIndex) => {
                                const scheduleId = `${day.date}-${dayIndex}-${slotIndex}`;
                                return (
                                  <div
                                    key={scheduleId}
                                    className="border rounded-lg p-3 bg-card/50 hover:bg-card/80 transition-colors"
                                  >
                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                      <div className="flex-1 min-w-0">
                                        <h4 className="font-semibold text-sm mb-1.5 wrap-break-word">
                                          {getMultiDaySlotDisplayName(
                                            slot,
                                            slotIndex,
                                          )}
                                        </h4>
                                        <div className="space-y-1 text-xs sm:text-sm text-muted-foreground">
                                          <div className="flex items-center gap-1.5">
                                            <Clock className="h-3.5 w-3.5 shrink-0" />
                                            <span>
                                              {(() => {
                                                const startLabel =
                                                  slot.startTime
                                                    ? formatTimeTo12Hour(
                                                        slot.startTime,
                                                      )
                                                    : "TBD";
                                                const endLabel = slot.endTime
                                                  ? formatTimeTo12Hour(
                                                      slot.endTime,
                                                    )
                                                  : undefined;
                                                return endLabel
                                                  ? `${startLabel} - ${endLabel}`
                                                  : startLabel;
                                              })()}
                                            </span>
                                            {project.project_timezone && (
                                              <TimezoneBadge
                                                timezone={
                                                  project.project_timezone
                                                }
                                              />
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <Users className="h-3.5 w-3.5 shrink-0" />
                                            <span>
                                              <span className="font-medium text-foreground">
                                                {remainingSlots[scheduleId] ??
                                                  formatSlotCapacity(
                                                    slot.volunteers,
                                                  )}
                                              </span>{" "}
                                              of{" "}
                                              {formatSlotCapacity(
                                                slot.volunteers,
                                              )}{" "}
                                              spots
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex flex-col gap-2 items-stretch sm:items-end shrink-0">
                                        <Button
                                          variant={
                                            pendingSlots[scheduleId]
                                              ? "outline"
                                              : hasSignedUp[scheduleId]
                                                ? "secondary"
                                                : rejectedSlots[scheduleId]
                                                  ? "destructive"
                                                  : "default"
                                          }
                                          size="sm"
                                          onClick={() =>
                                            handleSignUpClick(scheduleId)
                                          }
                                          disabled={
                                            isCreator ||
                                            loadingStates[scheduleId] ||
                                            calculatedStatus === "cancelled" ||
                                            rejectedSlots[scheduleId] ||
                                            attendedSlots[scheduleId] ||
                                            isMultiDaySlotPastByScheduleId(
                                              project,
                                              scheduleId,
                                            ) ||
                                            (!hasSignedUp[scheduleId] &&
                                              remainingSlots[scheduleId] === 0)
                                          }
                                          className={`w-full sm:w-auto ${attendedSlots[scheduleId] || isMultiDaySlotPastByScheduleId(project, scheduleId) ? "opacity-50 cursor-not-allowed" : ""}`}
                                        >
                                          {isMultiDaySlotPastByScheduleId(
                                            project,
                                            scheduleId,
                                          )
                                            ? "Time Passed"
                                            : renderSignupButton(scheduleId)}
                                        </Button>
                                      </div>
                                    </div>
                                    {(project.show_attendees_publicly ||
                                      canManageProject) && (
                                      <SlotAttendeesDropdown
                                        attendees={getAttendeesForSlot(
                                          scheduleId,
                                        )}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                {project.event_type === "sameDayMultiArea" &&
                  project.schedule.sameDayMultiArea && (
                    <div className="space-y-3">
                      <div className="mb-4">
                        <h3 className="font-medium mb-2">
                          {(() => {
                            const dateStr =
                              project.schedule.sameDayMultiArea.date;
                            const [year, month, dayNum] = dateStr
                              .split("-")
                              .map(Number);
                            // Use Date to correctly handle timezones
                            const date = new Date(year, month - 1, dayNum);
                            return format(date, "EEEE, MMMM d");
                          })()}
                        </h3>
                        <div className="space-y-2">
                          {project.schedule.sameDayMultiArea.roles.map(
                            (role) => (
                              <div
                                key={role.name}
                                className="border rounded-lg p-3 bg-card/50 hover:bg-card/80 transition-colors"
                              >
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-sm mb-1.5 wrap-break-word">
                                      {role.name}
                                    </h4>
                                    <div className="space-y-1 text-xs sm:text-sm text-muted-foreground">
                                      <div className="flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5 shrink-0" />
                                        <span>
                                          {(() => {
                                            const startLabel = role.startTime
                                              ? formatTimeTo12Hour(
                                                  role.startTime,
                                                )
                                              : "TBD";
                                            const endLabel = role.endTime
                                              ? formatTimeTo12Hour(role.endTime)
                                              : undefined;
                                            return endLabel
                                              ? `${startLabel} - ${endLabel}`
                                              : startLabel;
                                          })()}
                                        </span>
                                        {project.project_timezone && (
                                          <TimezoneBadge
                                            timezone={project.project_timezone}
                                          />
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <Users className="h-3.5 w-3.5 shrink-0" />
                                        <span>
                                          <span className="font-medium text-foreground">
                                            {remainingSlots[role.name] ??
                                              formatSlotCapacity(
                                                role.volunteers,
                                              )}
                                          </span>{" "}
                                          of{" "}
                                          {formatSlotCapacity(role.volunteers)}{" "}
                                          spots
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-2 items-stretch sm:items-end shrink-0">
                                    <Button
                                      variant={
                                        pendingSlots[role.name]
                                          ? "outline"
                                          : hasSignedUp[role.name]
                                            ? "secondary"
                                            : rejectedSlots[role.name]
                                              ? "destructive"
                                              : "default"
                                      }
                                      size="sm"
                                      onClick={() =>
                                        handleSignUpClick(role.name)
                                      }
                                      disabled={
                                        isCreator ||
                                        loadingStates[role.name] ||
                                        calculatedStatus === "cancelled" ||
                                        isSameDayMultiAreaSlotPast(
                                          project,
                                          role.name,
                                        ) ||
                                        rejectedSlots[role.name] ||
                                        attendedSlots[role.name] ||
                                        (!hasSignedUp[role.name] &&
                                          remainingSlots[role.name] === 0)
                                      }
                                      className={`w-full sm:w-auto ${attendedSlots[role.name] || isSameDayMultiAreaSlotPast(project, role.name) ? "opacity-50 cursor-not-allowed" : ""}`}
                                    >
                                      {isSameDayMultiAreaSlotPast(
                                        project,
                                        role.name,
                                      )
                                        ? "Time Passed"
                                        : renderSignupButton(role.name)}
                                    </Button>
                                  </div>
                                </div>
                                {(project.show_attendees_publicly ||
                                  canManageProject) && (
                                  <SlotAttendeesDropdown
                                    attendees={getAttendeesForSlot(role.name)}
                                  />
                                )}
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                {/* Message for cancelled projects */}
                {calculatedStatus === "cancelled" && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive p-3 bg-destructive/10 mt-4">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <div className="text-sm text-muted-foreground">
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
                    </div>
                  </div>
                )}

                {/* Message for completed projects */}
                {calculatedStatus === "completed" && (
                  <div className="flex items-start gap-2 rounded-md border p-3 bg-muted/50 mt-4">
                    <CheckCircle2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="text-sm text-muted-foreground">
                      <p>
                        This project has been completed and is no longer
                        accepting signups.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Project Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Project Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Project Cover Image - Only show if it exists */}
                {project.cover_image_url && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      Project Image
                    </h3>
                    <div
                      className="relative mb-4 cursor-pointer max-w-100"
                      onClick={() =>
                        openPreview(
                          project.cover_image_url!,
                          project.title,
                          "image/jpeg",
                        )
                      }
                    >
                      <div className="overflow-hidden rounded-md border">
                        <Image
                          src={project.cover_image_url}
                          alt={project.title}
                          width={300}
                          height={180}
                          loading={demoMode ? "eager" : "lazy"}
                          className="object-cover w-full aspect-video h-auto hover:scale-105 transition-transform"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(
                            project.cover_image_url!,
                            project.title,
                            "image/jpeg",
                          );
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" /> View
                      </Button>
                    </div>
                  </div>
                )}
                {/* Project Coordinator */}
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Project Coordinator
                  </h3>
                  <div className="space-y-4">
                    <ProfileHoverCard
                      username={creator?.username || ""}
                      fullName={creator?.full_name || "Anonymous"}
                      avatarUrl={creator?.avatar_url || undefined}
                      createdAt={creator?.created_at || undefined}
                    >
                      <Link
                        href={`/profile/${creator?.username || ""}`}
                        className="flex items-center gap-3"
                      >
                        <Avatar className="h-10 w-10">
                          {creator?.avatar_url ? (
                            <AvatarImage
                              src={creator.avatar_url}
                              alt={creator?.full_name || "Creator"}
                            />
                          ) : null}
                          <AvatarFallback className="bg-muted">
                            <NoAvatar
                              fullName={creator?.full_name}
                              className="text-sm font-medium"
                            />
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {creator?.full_name || "Anonymous"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            @{creator?.username || "user"}
                          </p>
                        </div>
                      </Link>
                    </ProfileHoverCard>

                    {project.organization && (
                      <>
                        <div className="flex items-center my-2">
                          <Separator className="shrink" />
                          <span className="px-2 text-xs text-muted-foreground flex items-center">
                            <Building2 className="h-4 w-4 mr-1 shrink-0" />{" "}
                            Organization
                          </span>
                          <Separator className="shrink" />
                        </div>
                        <OrganizationHoverCard
                          organization={project.organization}
                        >
                          <Link
                            href={`/organization/${project.organization.username}`}
                            className="flex items-center gap-3"
                          >
                            <Avatar className="h-9 w-9 border border-muted">
                              {project.organization.logo_url ? (
                                <AvatarImage
                                  src={project.organization.logo_url}
                                  alt={project.organization.name}
                                />
                              ) : (
                                <AvatarFallback className="bg-muted text-xs">
                                  {project.organization.name
                                    .substring(0, 2)
                                    .toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium hover:underline underline-offset-4 truncate">
                                  {project.organization.name}
                                </p>
                                {project.organization.verified && (
                                  <BadgeCheck className="h-4 w-4 text-primary" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                @{project.organization.username}
                              </p>
                            </div>
                          </Link>
                        </OrganizationHoverCard>
                      </>
                    )}
                  </div>
                </div>

                {/* Contact Information */}
                {creator?.email && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      Contact Information
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-center gap-1 text-sm">
                        <span>{creator.email}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          window.location.href = `mailto:${creator.email}?subject=Regarding project: ${project.title}`;
                          toast.success("Opening email client");
                        }}
                        className="mt-1 flex items-center gap-2"
                      >
                        <Mail className="h-4 w-4" />
                        Contact Project Coordinator
                      </Button>
                    </div>
                  </div>
                )}

                {/* Sign-up Requirements */}
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Sign-up Requirements
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={project.require_login ? "secondary" : "outline"}
                      className="text-xs flex items-center gap-1"
                    >
                      {project.require_login ? (
                        <>
                          <Lock className="h-3 w-3" />
                          Account Required
                        </>
                      ) : (
                        <>
                          <Users className="h-3 w-3" />
                          Anonymous Sign-ups Allowed
                        </>
                      )}
                    </Badge>

                    {project.waiver_required && (
                      <Badge
                        variant="outline"
                        className="text-xs flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" />
                        Waiver Required
                      </Badge>
                    )}

                    {/* Add verification method badge */}
                    <Badge
                      variant="outline"
                      className="text-xs flex items-center gap-1"
                    >
                      {project.verification_method === "qr-code" ? (
                        <>
                          <QrCode className="h-3 w-3" />
                          QR Code Check-in
                        </>
                      ) : project.verification_method === "manual" ? (
                        <>
                          <UserCheck className="h-3 w-3" />
                          Manual Check-in
                        </>
                      ) : project.verification_method === "auto" ? (
                        <>
                          <Zap className="h-3 w-3" />
                          Automatic Check-in
                        </>
                      ) : (
                        <>
                          <Users className="h-3 w-3" />
                          Sign-up Only
                        </>
                      )}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Location Map */}
            <LocationMapCard
              location={project.location}
              locationData={project.location_data}
            />

            {/* Project Documents Section */}
            {project.documents && project.documents.length > 0 && (
              <Card className="bg-card">
                <CardHeader className="">
                  <CardTitle>Project Documents</CardTitle>
                </CardHeader>
                <CardContent className="">
                  <div className="space-y-3">
                    {project.documents.map(
                      (doc: ProjectDocument, index: number) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 rounded-lg border bg-background hover:bg-muted/20 transition-colors"
                        >
                          <div className="flex items-center gap-3 w-0 flex-1">
                            <div className="bg-muted p-2 rounded-md shrink-0">
                              {getFileIcon(doc.type)}
                            </div>
                            <div className="min-w-0 w-full overflow-hidden">
                              <p className="font-medium text-sm truncate">
                                {doc.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(doc.size)}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0 ml-2">
                            {isPreviewable(doc.type) && (
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                  openPreview(doc.url, doc.name, doc.type)
                                }
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => downloadFile(doc.url, doc.name)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

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
                <LogIn className="h-4 w-4" />
                Login to Your Account
              </Button>
              <Button
                onClick={() => redirectToAuth("signup")}
                variant="outline"
                className="flex items-center justify-center"
              >
                <UserPlus className="h-4 w-4" />
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
              <Mail className="h-5 w-5 text-amber-500" />
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
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <MailCheck className="h-4 w-4" />
                    Resend Email
                  </>
                )}
              </Button>
            </div>

            {showResendTurnstile && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0" />
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
