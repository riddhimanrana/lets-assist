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
}

export default function ProjectDetails({ project, creator, organization, initialSlotData }: Props) {
  const router = useRouter();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [isCreator, setIsCreator] = useState(false);
  const [remainingSlots, setRemainingSlots] = useState<Record<string, number>>(initialSlotData.remainingSlots);
  const [hasSignedUp, setHasSignedUp] = useState<Record<string, boolean>>(initialSlotData.userSignups);
  const [user, setUser] = useState<any>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false);
  const [currentScheduleId, setCurrentScheduleId] = useState<string>("");
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");

  // Initialize user and creator status
  useEffect(() => {
    const initialize = async () => {
      const supabase = createClient();
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);
      
      if (currentUser && project.creator_id === currentUser.id) {
        setIsCreator(true);
      }
    };
    initialize();
  }, [project]);

  // Handle sign up or cancel click
  const handleSignUpClick = (scheduleId: string) => {
    if (hasSignedUp[scheduleId]) {
      handleCancelSignup(scheduleId);
      return;
    }

    if (!isSlotAvailable(project, scheduleId, remainingSlots)) {
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
        [scheduleId]: (prev[scheduleId] || 0) - 1 
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
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">
                {project.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{project.location}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ProjectStatusBadge status={project.status} className="capitalize" />
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
              <CardHeader className="pb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between">
                <CardTitle>Volunteer Opportunities</CardTitle>
                {project.require_login && (
                  <Badge variant="secondary" className="gap-1 mt-2 sm:mt-0 ml-0 sm:ml-2">
                    <Lock className="h-3 w-3" />
                    Account Required
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                {project.event_type === "oneTime" && (
                  <Card className="bg-card/50 hover:bg-card/80 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="max-w-[400px]">
                          <h3 className="font-medium text-base break-words">
                            {format(new Date(project.schedule.oneTime!.date), "EEEE, MMMM d")}
                          </h3>
                          <div className="flex items-center gap-2 text-muted-foreground mt-1 text-sm">
                            <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="line-clamp-1">
                              {formatTimeTo12Hour(project.schedule.oneTime!.startTime)} -{" "}
                              {formatTimeTo12Hour(project.schedule.oneTime!.endTime)}
                            </span>
                            <span className="flex items-center ml-2">
                              <Users className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                              {formatSpots(remainingSlots["oneTime"] || project.schedule.oneTime!.volunteers)} remaining
                            </span>
                          </div>
                        </div>
                        <Button
                          variant={hasSignedUp["oneTime"] ? "secondary" : "default"}
                          size="sm"
                          onClick={() => handleSignUpClick("oneTime")}
                          disabled={loadingStates["oneTime"] || project.status === "cancelled" || (!hasSignedUp["oneTime"] && remainingSlots["oneTime"] === 0)}
                          className="flex-shrink-0 gap-2"
                        >
                          {hasSignedUp["oneTime"] ? (
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
                {/* Project Coordinator */}
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Project Coordinator
                  </h3>
                  <div className="space-y-4">
                    {/* Creator info */}
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
