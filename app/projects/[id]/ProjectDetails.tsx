"use client";

import {
  EventType,
  Project,
  MultiDayScheduleDay,
  SameDayMultiAreaSchedule,
  SameDayMultiAreaRole,
  OneTimeSchedule,
  Profile,
  Organization,
  ProjectStatus,
  LocationData,
  ProjectDocument,
  AnonymousSignupData,
  Signup
} from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { LocationMapCard } from "@/components/LocationMapCard";
import { 
  CalendarDays,
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
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { signUpForProject, cancelSignup } from "./actions";
import { formatTimeTo12Hour, formatBytes } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";
import { getSlotCapacities, getSlotDetails, isSlotAvailable, isMultiDaySlotPast, isMultiDaySlotPastByScheduleId, isSameDayMultiAreaSlotPast, isOneTimeSlotPast } from "@/utils/project";
import { getProjectStatus, getProjectStartDateTime, getProjectEndDateTime } from "@/utils/project"; // Import the getProjectStatus utility and date utils
import { useState, useEffect, useCallback } from "react"; // Add useCallback
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import FilePreview from "@/components/FilePreview";
import CreatorDashboard from "./CreatorDashboard";
// Import the new UserDashboard
import UserDashboard from "./UserDashboard"; 
import { ProjectSignupForm } from "./ProjectForm";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useRef } from "react";
// Import User type from supabase
import { User } from "@supabase/supabase-js"; 
import ProjectInstructionsModal from "./ProjectInstructions";
import { SignupConfirmationModal } from "@/components/SignupConfirmationModal";
import { CancelSignupModal } from "@/components/CancelSignupModal";
import CalendarOptionsModal from "@/components/CalendarOptionsModal";
import { TimezoneBadge } from "@/components/TimezoneBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportContentButton } from "@/components/ReportContentButton";

interface SlotData {
  remainingSlots: Record<string, number>;
  userSignups: Record<string, boolean>;
  rejectedSlots: Record<string, boolean>;
  // Add new property to track attended status
  attendedSlots: Record<string, boolean>;
}

interface Props {
  project: Project;
  creator: Profile | null;
  organization?: Organization | null;
  initialSlotData: SlotData;
  initialIsCreator: boolean;
  // Use the specific User type
  initialUser: User | null; 
  // Add prop for full signup data
  userSignupsData: Signup[]; 
}

const getFileIcon = (type: string) => {
  if (type.includes('pdf')) return <FileText className="h-5 w-5" />;
  if (type.includes('image')) return <FileImage className="h-5 w-5" />;
  if (type.includes('text')) return <FileText className="h-5 w-5" />;
  if (type.includes('word')) return <FileText className="h-5 w-5" />;
  return <File className="h-5 w-5" />;
};

const downloadFile = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  } catch (error) {
    console.error('Download error:', error);
  }
};

export default function ProjectDetails({ 
  project, 
  creator, 
  organization, 
  initialSlotData, 
  initialIsCreator, 
  initialUser,
  // Destructure the new prop
  userSignupsData 
}: Props) {
  const router = useRouter();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [isCreator, setIsCreator] = useState(initialIsCreator);
  const [remainingSlots, setRemainingSlots] = useState<Record<string, number>>(initialSlotData.remainingSlots);
  const [hasSignedUp, setHasSignedUp] = useState<Record<string, boolean>>(initialSlotData.userSignups);
  // Use the specific User type
  const [user, setUser] = useState<User | null>(initialUser); 
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false);
  const [currentScheduleId, setCurrentScheduleId] = useState<string>("");
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  
  // Initialize rejectedSlots from props instead of empty object
  const [rejectedSlots, setRejectedSlots] = useState<Record<string, boolean>>(initialSlotData.rejectedSlots || {});
  
  // Add state for attended slots
  const [attendedSlots, setAttendedSlots] = useState<Record<string, boolean>>(initialSlotData.attendedSlots || {});

  // Add state for the confirmation alert
  const [showConfirmationAlert, setShowConfirmationAlert] = useState(false);
  
  // Add state for confirmation modals
  const [showSignupConfirmation, setShowSignupConfirmation] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [pendingScheduleId, setPendingScheduleId] = useState<string>("");
  const [userProfile, setUserProfile] = useState<{
    full_name: string | null;
    email: string | null;
    phone: string | null;
  }>({ full_name: null, email: null, phone: null });
  
  // Add state to track calculated status
  const [calculatedStatus, setCalculatedStatus] = useState<ProjectStatus>(
    getProjectStatus(project)
  );

  // Add state for calendar modal after signup
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [completedSignup, setCompletedSignup] = useState<{
    signupId: string;
    scheduleId: string;
  } | null>(null);

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
        const { data: rejectedData, error: rejectedError } = await supabase
          .from("project_signups")
          .select("id, schedule_id")
          .eq("project_id", project.id)
          .eq("user_id", user.id)
          .eq("status", "rejected");
          
        if (rejectedError) {
          console.error("Error checking for rejections:", rejectedError);
        } else if (rejectedData && rejectedData.length > 0) {
          // Create a record of rejected slots
          const rejections: Record<string, boolean> = {};
          rejectedData.forEach(rejection => {
            rejections[rejection.schedule_id] = true;
          });
          
          // Update state with rejected slots
          setRejectedSlots(rejections);
        }

        // Query for all attended signups for this user and project
        const { data: attendedData, error: attendedError } = await supabase
          .from("project_signups")
          .select("id, schedule_id")
          .eq("project_id", project.id)
          .eq("user_id", user.id)
          .eq("status", "attended");
          
        if (attendedError) {
          console.error("Error checking for attended status:", attendedError);
        } else if (attendedData && attendedData.length > 0) {
          // Create a record of attended slots
          const attended: Record<string, boolean> = {};
          attendedData.forEach(slot => {
            attended[slot.schedule_id] = true;
          });
          
          // Update state with attended slots
          setAttendedSlots(attended);
        }
      } else {
         // Clear rejected and attended slots if user logs out
         setRejectedSlots({});
         setAttendedSlots({});
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
            window.history.replaceState({}, '', `/projects/${project.id}`);
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


  // Fetch user profile data when user changes
  useEffect(() => {
    async function fetchUserProfile() {
      if (user) {
        const supabase = createClient();
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("full_name, email, phone")
          .eq("id", user.id)
          .single();
          
        if (error) {
          console.error("Error fetching user profile:", error);
        } else if (profile) {
          setUserProfile({
            full_name: profile.full_name,
            email: profile.email,
            phone: profile.phone,
          });
        }
      } else {
        // Clear profile if user logs out
        setUserProfile({ full_name: null, email: null, phone: null });
      }
    }
    
    fetchUserProfile();
  }, [user]);

  // Move updateProjectStatusInDB outside useCallback to break circular dependency
  const updateProjectStatusInDB = async (newStatus: ProjectStatus) => {
    if (isUpdatingStatus) return;
    
    try {
      setIsUpdatingStatus(true);
      const supabase = createClient();
      
      const { error } = await supabase
        .from('projects')
        .update({ status: newStatus })
        .eq('id', project.id);
        
      if (error) {
        console.error("Failed to update project status:", error);
      } else {
        console.log(`Project status updated in DB to ${newStatus}`);
      }
    } catch (error) {
      console.error("Error updating project status:", error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Modify status check effect to avoid unnecessary updates
  // Add a ref to ensure status mismatch update runs only once
  const statusMismatchHandled = useRef(false);

  useEffect(() => {
    const newCalculatedStatus = getProjectStatus(project);

    setCalculatedStatus(prevStatus => {
      if (newCalculatedStatus !== prevStatus) {
        console.log(`Calculated status updated: ${newCalculatedStatus}`);
        return newCalculatedStatus;
      }
      return prevStatus;
    });

    // Only update DB if we're the creator, status differs, and not already handled
    if (
      isCreator &&
      !isUpdatingStatus &&
      newCalculatedStatus !== project.status &&
      !statusMismatchHandled.current
    ) {
      console.log(`Status mismatch detected: prop=${project.status}, calculated=${newCalculatedStatus}`);
      updateProjectStatusInDB(newCalculatedStatus);
      statusMismatchHandled.current = true; // Mark as handled
    }
  }, [
    isCreator,
    project.id,
    project.status,
    project.schedule,
    project.created_at,
    project.cancelled_at,
    isUpdatingStatus
  ]);

  // Modify interval effect to be more selective about updates
  useEffect(() => {
    const checkStatus = () => {
      const newStatus = getProjectStatus(project);
      
      setCalculatedStatus(prevStatus => {
        if (newStatus !== prevStatus) {
          console.log("Status updated via interval:", newStatus);
          
          if (isCreator && !isUpdatingStatus && newStatus !== project.status) {
            updateProjectStatusInDB(newStatus);
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
    isCreator,
    isUpdatingStatus
  ]); // Remove function dependency

  // Handle sign up or cancel click
  const handleSignUpClick = async (scheduleId: string) => {
    // Prevent project creator from signing up
    if (isCreator) {
      toast.info("You cannot sign up for your own project");
      return;
    }
    
    // Check if this specific slot has been rejected
    if (rejectedSlots[scheduleId]) {
      toast.error("You have been rejected for this slot and cannot sign up again.");
      return;
    }

    // Check if user has attended this slot
    if (attendedSlots[scheduleId]) {
      toast.error("You have already attended this slot.");
      return;
    }

    if (hasSignedUp[scheduleId]) {
      handleCancelSignup(scheduleId);
      return;
    }

    // Check if signups are paused
    if (project.pause_signups) {
      toast.error("Signups for this project are temporarily paused by the organizer");
      return;
    }

    // Use calculatedStatus instead of project.status
    if (!isSlotAvailable(project, scheduleId, remainingSlots, calculatedStatus)) {
      console.log(project)
      console.log(scheduleId)
      console.log(remainingSlots)
      console.log(calculatedStatus)
      toast.error("This slot is no longer available");
      return;
    }

    if (!user && project.require_login) {
      setCurrentScheduleId(scheduleId);
      setAuthDialogOpen(true);
      return;
    }

    if (!user && !project.require_login) {
      setCurrentScheduleId(scheduleId);
      setAnonymousDialogOpen(true);
      return;
    }

    // For logged-in users, show confirmation modal
    if (user) {
      setPendingScheduleId(scheduleId);
      setShowSignupConfirmation(true);
      return;
    }

    handleSignUp(scheduleId);
  };

  // Cancel signup
  const handleCancelSignup = async (scheduleId: string) => {
    // Show confirmation modal for logged-in users
    if (user) {
      setPendingScheduleId(scheduleId);
      setShowCancelConfirmation(true);
      return;
    }
  };

  // Handle confirmation modal actions
  const handleConfirmSignup = () => {
    setShowSignupConfirmation(false);
    handleSignUp(pendingScheduleId);
    setPendingScheduleId("");
  };

  const handleCloseModals = () => {
    setShowSignupConfirmation(false);
    setShowCancelConfirmation(false);
    setPendingScheduleId("");
  };

  // Handle signup
  const handleSignUp = async (scheduleId: string, anonymousData?: AnonymousSignupData) => {
    setLoadingStates(prev => ({ ...prev, [scheduleId]: true }));
    // Reset alert state on new signup attempt
    setShowConfirmationAlert(false);

    try {
      const result = await signUpForProject(project.id, scheduleId, anonymousData);

      if (result.error) {
        toast.error(result.error);
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
              const statusResponse = await fetch("/api/calendar/connection-status");
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
            }
          );
          
          // Update local state to reflect the successful signup
          setHasSignedUp(prev => ({ ...prev, [scheduleId]: true }));
          setRemainingSlots(prev => ({
            ...prev,
            [scheduleId]: Math.max(0, (prev[scheduleId] || 0) - 1)
          }));
          
          // Force a refresh of the page data to ensure we're in sync with the server
          router.refresh();
        }
      }
    } catch (error) {
      console.error("Error in signup process:", error);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setLoadingStates(prev => ({ ...prev, [scheduleId]: false }));
      setAnonymousDialogOpen(false); // Close anonymous dialog regardless of outcome
    }
  };

  // Handle anonymous form submit
  const handleAnonymousSubmit = (values: AnonymousSignupData) => {
    handleSignUp(currentScheduleId, values);
  };

  // Redirect to auth pages
  const redirectToAuth = (path: 'login' | 'signup') => {
    sessionStorage.setItem('redirect_after_auth', window.location.href);
    router.push(`/${path}?redirect=${encodeURIComponent(window.location.pathname)}`);
  };

  // Share project
  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share && /Mobi/.test(navigator.userAgent)) {
      navigator
        .share({
          title: `${project.title} - Let's Assist`,
          text: "Check out this project!",
          url
        })
        .catch((err) => {
          console.error("Share failed: ", err);
          toast.error("Could not share link");
        });
    } else {
      navigator.clipboard.writeText(url)
        .then(() => toast.success("Project link copied to clipboard"))
        .catch(() => toast.error("Could not copy link to clipboard"));
    }
  };

  // Preview document
  const openPreview = (url: string, fileName: string = "Document", fileType: string = "") => {
    setPreviewDoc(url);
    setPreviewDocName(fileName);
    setPreviewDocType(fileType);
    setPreviewOpen(true);
  };

  // Check if file is previewable
  const isPreviewable = (type: string) => {
    return type.includes('pdf') || type.includes('image');
  };

  const renderSignupButton = (scheduleId: string) => {
    if (isCreator) {
      return "You are the creator";
    }
    
    // Check if this particular slot is rejected
    if (rejectedSlots[scheduleId]) {
      return (
        <HoverCard>
          <HoverCardTrigger asChild>
            <span className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4" />
              Rejected
            </span>
          </HoverCardTrigger>
          <HoverCardContent className="w-80 p-3">
            <p className="text-sm">
              Your signup for this slot has been rejected by the project coordinator. 
              Please contact them directly if you have questions.
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
          <HoverCardTrigger asChild>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Attended
            </span>
          </HoverCardTrigger>
          <HoverCardContent className="w-80 p-3">
            <p className="text-sm">
              You have been marked as attended for this slot. Attendance records cannot be changed.
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

  return (
    <>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Render Creator Dashboard if user is creator */}
        

        {/* Confirmation Alert */}
        {showConfirmationAlert && (
          <Alert className="mb-6 border-primary/70 bg-primary/10">
            <MailCheck className="h-5 w-5 text-chart-5" />
            <AlertTitle className="font-semibold text-primary">
              Check Your Email
            </AlertTitle>
            <AlertDescription className="text-primary">
              We&apos;ve sent a confirmation link to your email address. Please click the link to finalize your signup for this project.
            </AlertDescription>
          </Alert>
        )}

        {/* Project Header */}
        <div className="mb-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex-1 min-w-0 order-1 sm:order-none">
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
            <div className="flex items-center gap-2 mb-1 sm:mb-0 flex-shrink-0 order-0 sm:order-none justify-between w-full sm:w-auto">
              {/* Use calculatedStatus instead of project.status */}
              <ProjectStatusBadge status={calculatedStatus} className="capitalize" />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleShare}
                >
                  <Share2 className="h-4 w-4 shrink-0" />
                </Button>
                
                {/* Report button - only show for non-creators */}
                {!isCreator && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <MoreVertical className="h-4 w-4" />
                        <span className="sr-only">More options</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <ReportContentButton
                        contentType="project"
                        contentId={project.id}
                        triggerButton={
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                            <Flag className="mr-2 h-4 w-4" />
                            <span>Report Project</span>
                          </DropdownMenuItem>
                        }
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </div>
        </div>

{isCreator && <CreatorDashboard project={project} />}
        {/* Render User Dashboard if user is logged in, NOT creator, and has signups */}
        {user && !isCreator && userSignupsData && userSignupsData.length > 0 && (
          <UserDashboard project={project} user={user} signups={userSignupsData} />
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
              <CardHeader className="pb-3 flex flex-col mb-1 sm:flex-row items-start sm:items-center justify-between">
                <CardTitle>Volunteer Opportunities</CardTitle>
                {/* Add How It Works button for non-creators */}
                {!isCreator && (
                  <div className="mb-2">
                    <ProjectInstructionsModal project={project} isCreator={false} />
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {project.pause_signups && (
                  <Alert className="bg-chart-4/15 border-chart-4/50 mb-4">
                  <Pause className="h-4 w-4 text-chart-4" />
                  <AlertTitle className="text-chart-4/90">
                    Signups are currently paused
                  </AlertTitle>
                  <AlertDescription className="text-chart-4">
                  The project organizer has temporarily paused new volunteer signups. Please check back later or contact the organizer.
                  </AlertDescription>
                </Alert>
                )}
                
                {project.event_type === "oneTime" && project.schedule.oneTime && (
                  <Card className="bg-card/50 hover:bg-card/80 transition-colors">
                    <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="max-w-[400px]">
                          <h3 className="font-medium text-base break-words">
                          {(() => {
                          // Create date with no timezone offset issues
                          const dateStr = project.schedule.oneTime.date;
                          const [year, month, dayNum] = dateStr.split("-").map(Number);
                          // Use Date to correctly handle timezones
                          const date = new Date(year, month - 1, dayNum);
                          return format(date, "EEEE, MMMM d");
                          })()}
                          </h3>
                          <div className="mt-1.5 text-muted-foreground text-sm space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/70" />
                            <div className="flex items-center gap-2">
                              <span>
                                {(() => {
                                  const startLabel = project.schedule.oneTime.startTime ? formatTimeTo12Hour(project.schedule.oneTime.startTime) : "TBD";
                                  const endLabel = project.schedule.oneTime.endTime ? formatTimeTo12Hour(project.schedule.oneTime.endTime) : undefined;
                                  return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
                                })()}
                              </span>
                              {project.project_timezone && (
                                <TimezoneBadge timezone={project.project_timezone} />
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center">
                            <div className="flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/70" />
                            <span className="font-medium">
                              {remainingSlots["oneTime"] ?? project.schedule.oneTime.volunteers}
                              <span className="font-normal"> of </span>
                              {project.schedule.oneTime.volunteers}
                              <span className="font-normal"> spots available</span>
                            </span>
                            </div>
                            
                            {/* Visual indicator for spots */}
                            {/* <div className="ml-2 h-1.5 bg-muted rounded-full w-16 overflow-hidden hidden sm:block"> ... </div> */}
                          </div>
                          </div>
                        </div>
                        <Button
                          variant={hasSignedUp["oneTime"] ? "secondary" : rejectedSlots["oneTime"] ? "destructive" : "default"}
                          size="sm"
                          onClick={() => handleSignUpClick("oneTime")}
                          disabled={
                            isCreator || 
                            loadingStates["oneTime"] || 
                            calculatedStatus === "cancelled" || 
                            isOneTimeSlotPast(project) ||
                            rejectedSlots["oneTime"] || 
                            attendedSlots["oneTime"] ||
                            (!hasSignedUp["oneTime"] && (remainingSlots["oneTime"] === 0))
                          }
                          className={`flex-shrink-0 gap-2 ${attendedSlots["oneTime"] || isOneTimeSlotPast(project) ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          {isOneTimeSlotPast(project) ? "Time Passed" : renderSignupButton("oneTime")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {project.event_type === "multiDay" && project.schedule.multiDay && (
                  <div className="space-y-3">
                    {project.schedule.multiDay.map((day, dayIndex) => {
                      const isDayPast = isMultiDaySlotPast(day);
                      const allSlotsInDayPast = day.slots.every((slot, slotIndex) => {
                        const scheduleId = `${day.date}-${slotIndex}`;
                        return isMultiDaySlotPastByScheduleId(project, scheduleId);
                      });
                      
                      return (
                        <div key={day.date} className="mb-4">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="font-medium">
                              {(() => {
                                const dateStr = day.date;
                                const [year, month, dayNum] = dateStr.split("-").map(Number);
                                // Use Date to correctly handle timezones
                                const date = new Date(year, month - 1, dayNum);
                                return format(date, "EEEE, MMMM d");
                              })()}
                            </h3>
                            {allSlotsInDayPast && (
                              <Badge variant="secondary" className="ml-2">
                                Passed
                              </Badge>
                            )}
                          </div>
                          <div className={`space-y-2 ${allSlotsInDayPast ? "opacity-50" : ""}`}>
                            {day.slots.map((slot, slotIndex) => {
                              const scheduleId = `${day.date}-${slotIndex}`;
                              return (
                                <Card key={scheduleId} className="bg-card/50 hover:bg-card/80 transition-colors">
                                  <CardContent className="p-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                      <div className="max-w-[400px]">
                                        <div className="flex flex-col space-y-2">
                                          <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                            <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                                            <div className="flex items-center gap-2">
                                              <span className="line-clamp-1">
                                                {(() => {
                                                  const startLabel = slot.startTime ? formatTimeTo12Hour(slot.startTime) : "TBD";
                                                  const endLabel = slot.endTime ? formatTimeTo12Hour(slot.endTime) : undefined;
                                                  return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
                                                })()}
                                              </span>
                                              {project.project_timezone && (
                                                <TimezoneBadge timezone={project.project_timezone} />
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                            <Users className="h-3.5 w-3.5 flex-shrink-0" />
                                            <div className="flex items-center gap-1.5">
                                              <span className="font-medium">
                                                {remainingSlots[scheduleId] ?? slot.volunteers}
                                                <span className="font-normal"> of </span>
                                                {slot.volunteers}
                                              </span>
                                              <span className="font-normal">spots available</span>
                                            </div>
                                            
                                            {/* Visual indicator for spots */}
                                            {/* <div className="ml-2 h-1.5 bg-muted rounded-full w-16 overflow-hidden hidden sm:block"> ... </div> */}
                                          </div>
                                        </div>
                                      </div>
                                      <Button
                                        variant={hasSignedUp[scheduleId] ? "secondary" : rejectedSlots[scheduleId] ? "destructive" : "default"}
                                        size="sm"
                                        onClick={() => handleSignUpClick(scheduleId)}
                                        disabled={
                                          isCreator || 
                                          loadingStates[scheduleId] || 
                                          calculatedStatus === "cancelled" || 
                                          rejectedSlots[scheduleId] || 
                                          attendedSlots[scheduleId] ||
                                          isMultiDaySlotPastByScheduleId(project, scheduleId) ||
                                          (!hasSignedUp[scheduleId] && (remainingSlots[scheduleId] === 0))
                                        }
                                        className={`flex-shrink-0 gap-2 ${attendedSlots[scheduleId] || isMultiDaySlotPastByScheduleId(project, scheduleId) ? "opacity-50 cursor-not-allowed" : ""}`}
                                      >
                                        {isMultiDaySlotPastByScheduleId(project, scheduleId) ? "Time Passed" : renderSignupButton(scheduleId)}
                                      </Button>
                                    </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}

                {project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea && (
                  <div className="space-y-3">
                    <div className="mb-4">
                      <h3 className="font-medium mb-2">
                        {(() => {
                          const dateStr = project.schedule.sameDayMultiArea.date
                          const [year, month, dayNum] = dateStr.split("-").map(Number);
                          // Use Date to correctly handle timezones
                          const date = new Date(year, month - 1, dayNum);
                          return format(date, "EEEE, MMMM d");
                        })()}
                      </h3>
                      <div className="space-y-2">
                        {project.schedule.sameDayMultiArea.roles.map((role) => (
                          <Card key={role.name} className="bg-card/50 hover:bg-card/80 transition-colors">
                            <CardContent className="p-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="max-w-[400px]">
                                  <h4 className="font-medium break-words">{role.name}</h4>
                                  <div className="flex flex-col space-y-2 mt-1">
                                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                      <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                                      <div className="flex items-center gap-2">
                                        <span className="line-clamp-1">
                                          {(() => {
                                            const startLabel = role.startTime ? formatTimeTo12Hour(role.startTime) : "TBD";
                                            const endLabel = role.endTime ? formatTimeTo12Hour(role.endTime) : undefined;
                                            return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
                                          })()}
                                        </span>
                                        {project.project_timezone && (
                                          <TimezoneBadge timezone={project.project_timezone} />
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center">
                                      <div className="flex items-center gap-1.5">
                                        <Users className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/70" />
                                        <span className="font-medium text-sm text-muted-foreground">
                                          {remainingSlots[role.name] ?? role.volunteers}
                                          <span className="font-normal"> of </span>
                                          {role.volunteers}
                                          <span className="font-normal"> spots available</span>
                                        </span>
                                      </div>
                                      
                                      {/* Visual indicator for spots */}
                                      {/* <div className="ml-2 h-1.5 bg-muted rounded-full w-16 overflow-hidden hidden sm:block"> ... </div> */}
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  variant={hasSignedUp[role.name] ? "secondary" : rejectedSlots[role.name] ? "destructive" : "default"}
                                  size="sm"
                                  onClick={() => handleSignUpClick(role.name)}
                                  disabled={
                                    isCreator || 
                                    loadingStates[role.name] || 
                                    calculatedStatus === "cancelled" || 
                                    isSameDayMultiAreaSlotPast(project, role.name) ||
                                    rejectedSlots[role.name] || 
                                    attendedSlots[role.name] ||
                                    (!hasSignedUp[role.name] && (remainingSlots[role.name] === 0))
                                  }
                                  className={`flex-shrink-0 gap-2 ${attendedSlots[role.name] || isSameDayMultiAreaSlotPast(project, role.name) ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                  {isSameDayMultiAreaSlotPast(project, role.name) ? "Time Passed" : renderSignupButton(role.name)}
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Message for cancelled projects */}
                {calculatedStatus === "cancelled" && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive p-3 bg-destructive/10 mt-4">
                    <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-muted-foreground">
                      <p>
                        This project has been cancelled and is no longer accepting signups.
                      </p>
                      {project.cancellation_reason && (
                        <p className="mt-1">
                          <span className="font-medium">Reason:</span> {project.cancellation_reason}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Message for completed projects */}
                {calculatedStatus === "completed" && (
                  <div className="flex items-start gap-2 rounded-md border p-3 bg-muted/50 mt-4">
                    <CheckCircle2 className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-muted-foreground">
                      <p>
                        This project has been completed and is no longer accepting signups.
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
                    <div className="relative mb-4 cursor-pointer max-w-[400px]" onClick={() => openPreview(project.cover_image_url!, project.title, "image/jpeg")}>
                      <div className="overflow-hidden rounded-md border">
                        <Image
                          src={project.cover_image_url}
                          alt={project.title}
                          width={300}
                          height={180}
                          className="object-cover w-full aspect-video h-auto hover:scale-105 transition-transform"
                        />
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(project.cover_image_url!, project.title, "image/jpeg");
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
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <Link href={`/profile/${creator?.username || ""}`} className="flex items-center gap-3">
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
                      </HoverCardTrigger>
                      <HoverCardContent className="w-auto">
                        <div 
                          className="flex justify-between space-x-4 cursor-pointer" 
                          onClick={(e) => {
                            e.preventDefault();
                            window.location.href = `/profile/${creator?.username || ""}`;
                          }}
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
                          <div className="space-y-1 flex-1">
                            <h4 className="text-sm font-semibold">
                              {creator?.full_name || "Anonymous"}
                            </h4>
                            <p className="text-sm">
                              @{creator?.username || "user"}
                            </p>
                            <div className="flex items-center pt-2">
                              <CalendarDays className="mr-2 h-4 w-4 opacity-70" />
                              <span className="text-xs text-muted-foreground">
                                {creator?.created_at
                                  ? `Joined ${format(new Date(creator.created_at), "MMMM yyyy")}`
                                  : "New member"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </HoverCardContent>
                    </HoverCard>

                    {project.organization && (
                      <>
                      <div className="flex items-center my-2">
                        <Separator className="shrink" />
                        <span className="px-2 text-xs text-muted-foreground flex items-center">
                        <Building2 className="h-4 w-4 mr-1 flex-shrink-0" /> Organization
                        </span>
                        <Separator className="shrink" />
                      </div>
                      <HoverCard>
                        <HoverCardTrigger asChild>
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
                                  {project.organization.name.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium">
                                  {project.organization.name}
                                </p>
                                {project.organization.verified && (
                                  <BadgeCheck 
                                    className="h-4 w-4 text-primary" 
                                    fill="hsl(var(--primary))"
                                    stroke="hsl(var(--popover))"
                                    strokeWidth={2}
                                  />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                @{project.organization.username}
                              </p>
                            </div>
                          </Link>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-auto">
                          <div 
                            className="flex justify-between space-x-4 cursor-pointer" 
                            onClick={(e) => {
                              e.preventDefault();
                              window.location.href = `/organization/${project.organization?.username}`;
                            }}
                          >
                            <Avatar className="h-10 w-10 border border-muted">
                              {project.organization.logo_url ? (
                                <AvatarImage 
                                  src={project.organization.logo_url}
                                  alt={project.organization.name}
                                />
                              ) : (
                                <AvatarFallback className="bg-muted text-xs">
                                  {project.organization.name.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div className="space-y-1 flex-1">
                              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                                {project.organization.name}
                                {project.organization.verified && (
                                  <BadgeCheck 
                                    className="h-4 w-4 text-primary" 
                                    fill="hsl(var(--primary))"
                                    stroke="hsl(var(--popover))"
                                    strokeWidth={2}
                                  />
                                )}
                              </h4>
                              <p className="text-sm">
                                @{project.organization.username}
                              </p>
                              <div className="flex items-center pt-2">
                                <Building2 className="mr-2 h-4 w-4 opacity-70" />
                                <span className="text-xs text-muted-foreground">
                                  Organization
                                </span>
                              </div>
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
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
                    
                    {/* Add verification method badge */}
                    <Badge 
                      variant="outline"
                      className="text-xs flex items-center gap-1"
                    >
                      {project.verification_method === 'qr-code' ? (
                        <>
                          <QrCode className="h-3 w-3" />
                          QR Code Check-in
                        </>
                      ) : project.verification_method === 'manual' ? (
                        <>
                          <UserCheck className="h-3 w-3" />
                          Manual Check-in
                        </>
                      ) : project.verification_method === 'auto' ? (
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
                <CardHeader className="pb-3">
                  <CardTitle>Project Documents</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {project.documents.map((doc: ProjectDocument, index: number) => (
                      <div 
                        key={index} 
                        className="flex items-center justify-between p-3 rounded-lg border bg-background hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-3 w-0 flex-1">
                          <div className="bg-muted p-2 rounded-md flex-shrink-0">
                            {getFileIcon(doc.type)}
                          </div>
                          <div className="min-w-0 w-full overflow-hidden">
                            <p className="font-medium text-sm truncate">{doc.name}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(doc.size)}</p>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0 ml-2">
                          {isPreviewable(doc.type) && (
                            <Button 
                              variant="outline" 
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openPreview(doc.url, doc.name, doc.type)}
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
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Authentication Dialog */}
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Authentication Required</DialogTitle>
            <DialogDescription>
              This project requires an account to sign up.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-4">
              <Button 
                onClick={() => redirectToAuth('login')}
                className="flex items-center justify-center gap-2"
              >
                <LogIn className="h-4 w-4" />
                Login to Your Account
              </Button>
              <Button 
                onClick={() => redirectToAuth('signup')} 
                variant="outline"
                className="flex items-center justify-center gap-2"
              >
                <UserPlus className="h-4 w-4" />
                Create New Account
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Anonymous Signup Dialog */}
      <Dialog open={anonymousDialogOpen} onOpenChange={setAnonymousDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Quick Sign Up</DialogTitle>
            <DialogDescription>
              Please provide your information to sign up. You&apos;ll receive an email to confirm your spot.
            </DialogDescription>
          </DialogHeader>
          <ProjectSignupForm
            onSubmit={handleAnonymousSubmit}
            onCancel={() => setAnonymousDialogOpen(false)}
            isSubmitting={loadingStates[currentScheduleId]}
          />
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
          project={{
            id: project.id,
            title: project.title,
            date: (() => {
              // Get the appropriate date from the schedule
              if (project.event_type === "oneTime" && project.schedule.oneTime) {
                return project.schedule.oneTime.date;
              } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
                // For multiDay, schedule ID is like "2024-05-31-0", extract the date part
                const datePart = pendingScheduleId.split('-').slice(0, 3).join('-');
                const day = project.schedule.multiDay.find((d: MultiDayScheduleDay) => d.date === datePart);
                return day?.date || project.schedule.multiDay[0]?.date || '';
              } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
                return project.schedule.sameDayMultiArea.date;
              }
              return '';
            })(),
            location: project.location,
            start_time: (() => {
              // Get the appropriate start time from the schedule
              if (project.event_type === "oneTime" && project.schedule.oneTime) {
                return project.schedule.oneTime.startTime;
              } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
                const datePart = pendingScheduleId.split('-').slice(0, 3).join('-');
                const slotIndex = parseInt(pendingScheduleId.split('-')[3]);
                const day = project.schedule.multiDay.find((d: MultiDayScheduleDay) => d.date === datePart);
                return day?.slots[slotIndex]?.startTime;
              } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
                const role = project.schedule.sameDayMultiArea.roles.find((r: SameDayMultiAreaRole) => r.name === pendingScheduleId);
                return role?.startTime;
              }
              return undefined;
            })(),
            end_time: (() => {
              // Get the appropriate end time from the schedule
              if (project.event_type === "oneTime" && project.schedule.oneTime) {
                return project.schedule.oneTime.endTime;
              } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
                const datePart = pendingScheduleId.split('-').slice(0, 3).join('-');
                const slotIndex = parseInt(pendingScheduleId.split('-')[3]);
                const day = project.schedule.multiDay.find((d: MultiDayScheduleDay) => d.date === datePart);
                return day?.slots[slotIndex]?.endTime;
              } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
                const role = project.schedule.sameDayMultiArea.roles.find((r: SameDayMultiAreaRole) => r.name === pendingScheduleId);
                return role?.endTime;
              }
              return undefined;
            })(),
          }}
          scheduleId={pendingScheduleId}
          isLoading={loadingStates[pendingScheduleId]}
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
            setHasSignedUp(prev => ({ ...prev, [scheduleId]: false }));
            setRemainingSlots(prev => ({ 
              ...prev, 
              [scheduleId]: (prev[scheduleId] || 0) + 1
            }));
          }}
          project={{
            title: project.title,
            date: (() => {
              // Get the appropriate date from the schedule
              if (project.event_type === "oneTime" && project.schedule.oneTime) {
                return project.schedule.oneTime.date;
              } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
                // For multiDay, schedule ID is like "2024-05-31-0", extract the date part
                const datePart = pendingScheduleId.split('-').slice(0, 3).join('-');
                const day = project.schedule.multiDay.find((d: MultiDayScheduleDay) => d.date === datePart);
                return day?.date || project.schedule.multiDay[0]?.date || '';
              } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
                return project.schedule.sameDayMultiArea.date;
              }
              return '';
            })(),
            location: project.location,
            start_time: (() => {
              // Get the appropriate start time from the schedule
              if (project.event_type === "oneTime" && project.schedule.oneTime) {
                return project.schedule.oneTime.startTime;
              } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
                const datePart = pendingScheduleId.split('-').slice(0, 3).join('-');
                const slotIndex = parseInt(pendingScheduleId.split('-')[3]);
                const day = project.schedule.multiDay.find((d: MultiDayScheduleDay) => d.date === datePart);
                return day?.slots[slotIndex]?.startTime;
              } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
                const role = project.schedule.sameDayMultiArea.roles.find((r: SameDayMultiAreaRole) => r.name === pendingScheduleId);
                return role?.startTime;
              }
              return undefined;
            })(),
            end_time: (() => {
              // Get the appropriate end time from the schedule
              if (project.event_type === "oneTime" && project.schedule.oneTime) {
                return project.schedule.oneTime.endTime;
              } else if (project.event_type === "multiDay" && project.schedule.multiDay) {
                const datePart = pendingScheduleId.split('-').slice(0, 3).join('-');
                const slotIndex = parseInt(pendingScheduleId.split('-')[3]);
                const day = project.schedule.multiDay.find((d: MultiDayScheduleDay) => d.date === datePart);
                return day?.slots[slotIndex]?.endTime;
              } else if (project.event_type === "sameDayMultiArea" && project.schedule.sameDayMultiArea) {
                const role = project.schedule.sameDayMultiArea.roles.find((r: SameDayMultiAreaRole) => r.name === pendingScheduleId);
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
            status: 'approved',
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
