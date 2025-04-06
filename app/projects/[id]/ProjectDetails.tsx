"use client";

import {
  EventType,
  Project,
  MultiDayScheduleDay,
  SameDayMultiAreaSchedule,
  OneTimeSchedule,
  Profile,
  Organization,
  ProjectStatus,
  LocationData,
  ProjectDocument,
  AnonymousSignupData
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
  XCircle
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { signUpForProject, cancelSignup } from "./actions";
import { formatTimeTo12Hour, formatBytes } from "@/lib/utils";
import { formatSpots } from "./helpers";
import { createClient } from "@/utils/supabase/client";
import { getSlotCapacities, getSlotDetails, isSlotAvailable } from "./utils";
import { getProjectStatus } from "@/utils/project"; // Import the getProjectStatus utility
import { useState, useEffect } from "react";
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
import { ProjectSignupForm } from "./ProjectForm";

interface SlotData {
  remainingSlots: Record<string, number>;
  userSignups: Record<string, boolean>;
}

interface Props {
  project: Project;
  creator: Profile | null;
  organization?: Organization | null;
  initialSlotData: SlotData;
  initialIsCreator: boolean;
  initialUser: any;
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

export default function ProjectDetails({ project, creator, organization, initialSlotData, initialIsCreator, initialUser }: Props) {
  const router = useRouter();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [isCreator, setIsCreator] = useState(initialIsCreator);
  const [remainingSlots, setRemainingSlots] = useState<Record<string, number>>(initialSlotData.remainingSlots);
  const [hasSignedUp, setHasSignedUp] = useState<Record<string, boolean>>(initialSlotData.userSignups);
  const [user, setUser] = useState(initialUser);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false);
  const [currentScheduleId, setCurrentScheduleId] = useState<string>("");
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  
  // Add state to track calculated status
  const [calculatedStatus, setCalculatedStatus] = useState<ProjectStatus>(
    getProjectStatus(project)
  );

  // Update automatic status check for project creators
  useEffect(() => {
    async function checkAndUpdateStatus() {
      if (isCreator && !isUpdatingStatus) {
        try {
          // First, get the current status directly from the database
          const supabase = createClient();
          const { data: currentProjectData, error: fetchError } = await supabase
            .from('projects')
            .select('status')
            .eq('id', project.id)
            .single();
            
          if (fetchError) {
            console.error("Error fetching current project status:", fetchError);
            return;
          }
          
          // Calculate what the status should be based on project data
          const newCalculatedStatus = getProjectStatus(project);
          const databaseStatus = currentProjectData?.status as ProjectStatus;
          
          // Update the calculated status state
          setCalculatedStatus(newCalculatedStatus);
          
          console.log(`Calculated status: ${newCalculatedStatus}`);
          console.log(`Database status: ${databaseStatus}`);
          
          // If the calculated status is different from the database status, update it
          if (newCalculatedStatus !== databaseStatus) {
            console.log(`Status mismatch: database=${databaseStatus}, calculated=${newCalculatedStatus}`);
            updateProjectStatus(newCalculatedStatus);
          }
        } catch (error) {
          console.error("Error in status check:", error);
        }
      } else {
        // Even for non-creators, we still want to calculate the correct status for UI
        setCalculatedStatus(getProjectStatus(project));
      }
    }
    
    checkAndUpdateStatus();
  }, [isCreator, project, isUpdatingStatus]);

  // Realtime status update using setInterval
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Re-calculate project status
      const newCalculatedStatus = getProjectStatus(project);
      
      // Update the calculated status state if it has changed
      if (newCalculatedStatus !== calculatedStatus) {
        setCalculatedStatus(newCalculatedStatus);
        console.log("Status updated via setInterval:", newCalculatedStatus);

        // If user is the project creator, update the status in the database
        if (isCreator) {
          updateProjectStatus(newCalculatedStatus);
        }
      }
    }, 60000); // Update every 60 seconds (adjust as needed)

    // Clear interval on component unmount
    return () => clearInterval(intervalId);
  }, [project, isCreator, calculatedStatus]);

  // Function to update project status in the database
  const updateProjectStatus = async (newStatus: ProjectStatus) => {
    if (isUpdatingStatus) return;
    
    try {
      setIsUpdatingStatus(true);
      const supabase = createClient();
      
      // First update the status in the database
      const { error } = await supabase
        .from('projects')
        .update({ status: newStatus })
        .eq('id', project.id);
        
      if (error) {
        console.error("Failed to update project status:", error);
      } else {
        console.log(`Project status updated from ${project.status} to ${newStatus}`);
        
        // Then immediately fetch the updated project data
        // const { data: updatedProject, error: fetchError } = await supabase
        //   .from('projects')
        //   .select('*')
        //   .eq('id', project.id)
        //   .single();
          
        // if (fetchError) {
        //   console.error("Failed to fetch updated project data:", fetchError);
        // } else if (updatedProject) {
        //   // Directly modify the project object to reflect the new status
        //   project.status = updatedProject.status;
        //   console.log("Project data refreshed with status:", project.status);
        // }
      }
    } catch (error) {
      console.error("Error updating project status:", error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Handle sign up or cancel click
  const handleSignUpClick = async (scheduleId: string) => {
    // Prevent project creator from signing up
    if (isCreator) {
      toast.info("You cannot sign up for your own project");
      return;
    }

    if (hasSignedUp[scheduleId]) {
      handleCancelSignup(scheduleId);
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

    handleSignUp(scheduleId);
  };

  // Cancel signup
  const handleCancelSignup = async (scheduleId: string) => {
    try {
      const { data: signups } = await createClient()
        .from("project_signups")
        .select("id")
        .eq("project_id", project.id)
        .eq("schedule_id", scheduleId)
        .eq("user_id", user.id)
        .eq("status", "confirmed")
        .single();

      if (!signups?.id) {
        toast.error("Signup not found");
        return;
      }

      const result = await cancelSignup(signups.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Successfully cancelled signup");
        setHasSignedUp(prev => ({ ...prev, [scheduleId]: false }));
        setRemainingSlots(prev => ({ 
          ...prev, 
          [scheduleId]: (prev[scheduleId] || 0) + 1
        }));
      }
    } catch (error) {
      console.error("Error cancelling signup:", error);
      toast.error("Failed to cancel signup");
    }
  };

  // Handle signup
  const handleSignUp = async (scheduleId: string, anonymousData?: AnonymousSignupData) => {
    setLoadingStates(prev => ({ ...prev, [scheduleId]: true }));
    
    const result = await signUpForProject(project.id, scheduleId, anonymousData);
    
    setLoadingStates(prev => ({ ...prev, [scheduleId]: false }));
    setAnonymousDialogOpen(false);
    
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Successfully signed up!");
      setHasSignedUp(prev => ({ ...prev, [scheduleId]: true }));
      setRemainingSlots(prev => ({ 
        ...prev, 
        [scheduleId]: Math.max(0, (prev[scheduleId] || 0) - 1)
      }));
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

  return (
    <>
      <div className="container mx-auto px-4 py-6 max-w-5xl">
        {isCreator && <CreatorDashboard project={project} />}
        
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
              <Button
                variant="outline"
                size="icon"
                onClick={handleShare}
              >
                <Share2 className="h-4 w-4 shrink-0" />
              </Button>
            </div>
          </div>
        </div>

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
                {/* {project.require_login && (
                  <Badge variant="secondary" className="gap-1 mt-2 sm:mt-0 ml-0 sm:ml-2">
                    <Lock className="h-3 w-3" />
                    Account Required
                  </Badge>
                )} */}
              </CardHeader>
              <CardContent>
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
                            <span>
                            {formatTimeTo12Hour(project.schedule.oneTime.startTime)} -{" "}
                            {formatTimeTo12Hour(project.schedule.oneTime.endTime)}
                            </span>
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
                            <div className="ml-2 h-1.5 bg-muted rounded-full w-16 overflow-hidden hidden sm:block">
                            <div 
                              className={`h-full ${remainingSlots["oneTime"] === 0 ? 'bg-destructive/80' : 'bg-primary/80'}`}
                              style={{ 
                              width: `${Math.max(0, Math.min(100, ((remainingSlots["oneTime"] ?? project.schedule.oneTime.volunteers) / project.schedule.oneTime.volunteers) * 100))}%` 
                              }}
                            />
                            </div>
                          </div>
                          </div>
                        </div>
                        <Button
                          variant={hasSignedUp["oneTime"] ? "secondary" : "default"}
                          size="sm"
                          onClick={() => handleSignUpClick("oneTime")}
                          disabled={isCreator || loadingStates["oneTime"] || calculatedStatus === "cancelled" || (!hasSignedUp["oneTime"] && (remainingSlots["oneTime"] === 0))}
                          className="flex-shrink-0 gap-2"
                        >
                          {isCreator ? (
                            "You are the creator"
                          ) : hasSignedUp["oneTime"] ? (
                            <>
                              <XCircle className="h-4 w-4" />
                              Cancel Signup
                            </>
                          ) : remainingSlots["oneTime"] === 0 ? (
                            "Full"
                          ) : loadingStates["oneTime"] ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Processing...
                            </>
                          ) : calculatedStatus === "cancelled" ? (
                            "Unavailable"
                          ) : (
                            <>
                              <UserPlus className="h-4 w-4" />
                              Sign Up
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {project.event_type === "multiDay" && project.schedule.multiDay && (
                  <div className="space-y-3">
                    {project.schedule.multiDay.map((day, dayIndex) => (
                      <div key={day.date} className="mb-4">
                        <h3 className="font-medium mb-2">
                          {(() => {
                            const dateStr = day.date;
                            const [year, month, dayNum] = dateStr.split("-").map(Number);
                            // Use Date to correctly handle timezones
                            const date = new Date(year, month - 1, dayNum);
                            return format(date, "EEEE, MMMM d");
                          })()}
                        </h3>
                        <div className="space-y-2">
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
                                          <span className="line-clamp-1">
                                            {formatTimeTo12Hour(slot.startTime)} -{" "}
                                            {formatTimeTo12Hour(slot.endTime)}
                                          </span>
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
                                          <div className="ml-2 h-1.5 bg-muted rounded-full w-16 overflow-hidden hidden sm:block">
                                            <div 
                                              className={`h-full ${remainingSlots[scheduleId] === 0 ? 'bg-destructive/70' : 'bg-primary/70'}`}
                                              style={{ 
                                                width: `${Math.max(0, Math.min(100, ((remainingSlots[scheduleId] ?? slot.volunteers) / slot.volunteers) * 100))}%` 
                                              }}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    <Button
                                      variant={hasSignedUp[scheduleId] ? "secondary" : "default"}
                                      size="sm"
                                      onClick={() => handleSignUpClick(scheduleId)}
                                      disabled={isCreator || loadingStates[scheduleId] || calculatedStatus === "cancelled" || (!hasSignedUp[scheduleId] && (remainingSlots[scheduleId] === 0))}
                                      className="flex-shrink-0 gap-2"
                                    >
                                      {isCreator ? (
                                        "You are the creator"
                                      ) : hasSignedUp[scheduleId] ? (
                                        <>
                                          <XCircle className="h-4 w-4" />
                                          Cancel Signup
                                        </>
                                      ) : remainingSlots[scheduleId] === 0 ? (
                                        "Full"
                                      ) : loadingStates[scheduleId] ? (
                                        <>
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                          Processing...
                                        </>
                                      ) : calculatedStatus === "cancelled" ? (
                                        "Unavailable"
                                      ) : (
                                        <>
                                          <UserPlus className="h-4 w-4" />
                                          Sign Up
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    ))}
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
                                  <div className="flex items-center gap-2 text-muted-foreground text-sm mt-1">
                                    <Clock className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                                    <span className="line-clamp-1">
                                      {formatTimeTo12Hour(role.startTime)} - {formatTimeTo12Hour(role.endTime)}
                                    </span>
                                    <span className="flex items-center ml-2">
                                      <Users className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                                      {formatSpots(remainingSlots[role.name] ?? role.volunteers)} remaining
                                    </span>
                                  </div>
                                </div>
                                <Button
                                  variant={hasSignedUp[role.name] ? "secondary" : "default"}
                                  size="sm"
                                  onClick={() => handleSignUpClick(role.name)}
                                  disabled={isCreator || loadingStates[role.name] || project.status === "cancelled" || (!hasSignedUp[role.name] && (remainingSlots[role.name] === 0))}
                                  className="flex-shrink-0 gap-2"
                                >
                                  {isCreator ? (
                                    "You are the creator"
                                  ) : hasSignedUp[role.name] ? (
                                    <>
                                      <XCircle className="h-4 w-4" />
                                      Cancel Signup
                                    </>
                                  ) : remainingSlots[role.name] === 0 ? (
                                    "Full"
                                  ) : loadingStates[role.name] ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Processing...
                                    </>
                                  ) : project.status === "cancelled" ? (
                                    "Unavailable"
                                  ) : (
                                    <>
                                      <UserPlus className="h-4 w-4" />
                                      Sign Up
                                    </>
                                  )}
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

                {/* Sign-up Requirements */}
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Sign-up Requirements
                  </h3>
                  <div className="flex items-center gap-2">
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
              Please provide your information to sign up for this opportunity.
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
    </>
  );
}
