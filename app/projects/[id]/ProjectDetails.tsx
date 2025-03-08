"use client";

import {
  EventType,
  Project,
  MultiDayScheduleDay,
  SameDayMultiAreaSchedule,
  OneTimeSchedule,
  Profile,
} from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CalendarDays, 
  MapPin, 
  Users, 
  Share2, 
  Clock, 
  Image as ImageIcon, 
  FileText, 
  Download, 
  Eye, 
  File, 
  FileImage, 
} from "lucide-react";
import { format } from "date-fns";
import { Toaster, toast } from "sonner";
import { signUpForProject } from "./actions";
import { formatTimeTo12Hour, formatBytes } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image"; 
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose
} from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import FilePreview from "@/components/FilePreview";

type Props = {
  project: Project;
  creator: Profile | null;
};

type ScheduleData =
  | OneTimeSchedule
  | MultiDayScheduleDay[]
  | SameDayMultiAreaSchedule
  | undefined;

// File type icon mapping
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

const formatSpots = (count: number) => {
  return `${count} ${count === 1 ? 'spot' : 'spots'}`;
};

export default function ProjectDetails({
  project,
  creator,
}: Props): React.ReactElement {
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");

  // Check for creation message on component mount with increased delay
  useEffect(() => {
    const timer = setTimeout(() => {
      const message = sessionStorage.getItem("project_creation_message");
      const status = sessionStorage.getItem("project_creation_status");
      
      if (message) {
        if (status === "warning") {
          toast.warning(message);
        } else {
          toast.success(message);
        }
        
        // Clear the message from storage
        sessionStorage.removeItem("project_creation_message");
        sessionStorage.removeItem("project_creation_status");
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // Handle share button click
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
      try {
        navigator.clipboard.writeText(url).then(() => {
          toast.success("Project link copied to clipboard", {
            id: "clipboard-toast"
          });
        });
      } catch (err) {
        console.error("Copy operation failed:", err);
        toast.error("Could not copy link to clipboard");
      }
    }
  };

  // Function to open document preview
  const openPreview = (url: string, fileName: string = "Document", fileType: string = "") => {
    setPreviewDoc(url);
    setPreviewDocName(fileName);
    setPreviewDocType(fileType);
    setPreviewOpen(true);
  };

  // Function to check if file is previewable
  const isPreviewable = (type: string) => {
    return type.includes('pdf') || type.includes('image');
  };

  // Handle different schedule types properly
  const getScheduleData = (): ScheduleData => {
    if (project.event_type === "oneTime") {
      return project.schedule.oneTime as OneTimeSchedule;
    } else if (project.event_type === "multiDay") {
      return project.schedule.multiDay as MultiDayScheduleDay[];
    } else if (project.event_type === "sameDayMultiArea") {
      return project.schedule.sameDayMultiArea as SameDayMultiAreaSchedule;
    }
    return undefined;
  };

  const scheduleData = getScheduleData();

  const handleSignUp = async (scheduleId: string) => {
    const result = await signUpForProject(project.id, scheduleId);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("You have successfully signed up for this project.");
    }
  };

  const renderScheduleOverview = (eventType: EventType) => {
    if (!scheduleData) return null;

    switch (eventType) {
      case "oneTime": {
        const oneTimeData = scheduleData as OneTimeSchedule;
        return (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">
              <CalendarDays className="h-4 w-4 mr-1" />
              {format(new Date(oneTimeData.date), "MMMM d, yyyy")}
            </Badge>
            <Badge variant="secondary">
              <Clock className="h-4 w-4 mr-1" />
              {formatTimeTo12Hour(oneTimeData.startTime)} - {formatTimeTo12Hour(oneTimeData.endTime)}
            </Badge>
            <Badge variant="outline">
              <Users className="h-4 w-4 mr-1" />
              {formatSpots(oneTimeData.volunteers)}
            </Badge>
          </div>
        );
      }

      case "multiDay": {
        const multiDayData = scheduleData as MultiDayScheduleDay[];
        const firstDay = multiDayData[0];
        const lastDay = multiDayData[multiDayData.length - 1];
        return (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">
              <CalendarDays className="h-4 w-4 mr-1" />
              {format(new Date(firstDay.date), "MMMM d")} - {format(new Date(lastDay.date), "MMMM d, yyyy")}
            </Badge>
            <Badge variant="secondary">
              <Clock className="h-4 w-4 mr-1" />
              {multiDayData.length} Days
            </Badge>
            <Badge variant="outline">
              <Users className="h-4 w-4 mr-1" />
              {formatSpots(multiDayData.reduce((total, day) => total + day.slots.reduce((acc, slot) => acc + slot.volunteers, 0), 0))}
            </Badge>
          </div>
        );
      }

      case "sameDayMultiArea": {
        const multiAreaData = scheduleData as SameDayMultiAreaSchedule;
        return (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">
              <CalendarDays className="h-4 w-4 mr-1" />
              {format(new Date(multiAreaData.date), "MMMM d, yyyy")}
            </Badge>
            <Badge variant="secondary">
              <Users className="h-4 w-4 mr-1" />
              {multiAreaData.roles?.length} Roles
            </Badge>
            <Badge variant="outline">
              <Users className="h-4 w-4 mr-1" />
              {formatSpots(multiAreaData.roles?.reduce((total, role) => total + role.volunteers, 0) || 0)}
            </Badge>
          </div>
        );
      }
    }
  };

  const renderVolunteerOpportunities = () => {
    if (!scheduleData) return null;

    switch (project.event_type) {
      case "oneTime": {
        const oneTimeData = scheduleData as OneTimeSchedule;
        return (
          <Card className="bg-card/50 hover:bg-card/80 transition-colors">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-base">
                    {format(new Date(oneTimeData.date), "EEEE, MMMM d")}
                  </h3>
                  <div className="flex items-center gap-2 text-muted-foreground mt-1 text-sm">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      {formatTimeTo12Hour(oneTimeData.startTime)} -{" "}
                      {formatTimeTo12Hour(oneTimeData.endTime)}
                    </span>
                    <span className="flex items-center ml-2">
                      <Users className="h-3.5 w-3.5 mr-1" />
                      {formatSpots(oneTimeData.volunteers)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleSignUp("oneTime")}
                >
                  Sign Up
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      }

      case "multiDay": {
        const multiDayData = scheduleData as MultiDayScheduleDay[];
        return (
          <div className="space-y-3">
            {multiDayData.map((day, index) => (
              <div key={index}>
                <h3 className="font-medium text-base mb-2">
                  {format(new Date(day.date), "EEEE, MMMM d")}
                </h3>
                <div className="space-y-2">
                  {day.slots.map((slot, slotIndex) => (
                    <Card
                      key={slotIndex}
                      className="bg-card/50 hover:bg-card/80 transition-colors"
                    >
                      <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            <span>
                              {formatTimeTo12Hour(slot.startTime)} -{" "}
                              {formatTimeTo12Hour(slot.endTime)}
                            </span>
                            <span className="flex items-center ml-2">
                              <Users className="h-3.5 w-3.5 mr-1" />
                              {formatSpots(slot.volunteers)}
                            </span>
                          </div>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() =>
                              handleSignUp(`${day.date}-${slotIndex}`)
                            }
                          >
                            Sign Up
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case "sameDayMultiArea": {
        const multiAreaData = scheduleData as SameDayMultiAreaSchedule;
        return (
          <div className="space-y-3">
            <h3 className="font-medium text-base">
              {format(new Date(multiAreaData.date), "EEEE, MMMM d")}
            </h3>
            <div className="grid gap-2">
              {multiAreaData.roles?.map((role, index) => (
                <Card
                  key={index}
                  className="bg-card/50 hover:bg-card/80 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm sm:text-base truncate">
                          {role.name}
                        </h4>
                        <div className="flex flex-wrap items-center gap-2 text-muted-foreground mt-1 text-xs sm:text-sm">
                          <div className="flex items-center">
                            <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 flex-shrink-0" />
                            <span className="truncate">
                              {formatTimeTo12Hour(role.startTime)} -{" "}
                              {formatTimeTo12Hour(role.endTime)}
                            </span>
                          </div>
                          <div className="flex items-center">
                            <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 flex-shrink-0" />
                            <span>{formatSpots(role.volunteers)}</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full sm:w-auto mt-2 sm:mt-0"
                        onClick={() => handleSignUp(role.name)}
                      >
                        Sign Up
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      }
    }
  };

  return (
    <>
      <Toaster position="bottom-right" richColors theme="dark" />
      
      <div className="container mx-auto px-4 py-6 max-w-5xl">
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">
                {project.title}
              </h1>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{project.location}</span>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="icon" 
              className="self-start"
              onClick={handleShare}
            >
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>About this Project</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{project.description}</p>
                {renderScheduleOverview(project.event_type)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Volunteer Opportunities</CardTitle>
              </CardHeader>
              <CardContent>{renderVolunteerOpportunities()}</CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
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

                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Project Coordinator
                  </h3>
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
                </div>

                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Check-in Method
                </h3>
                <div className="flex items-center gap-2">
                  {project.verification_method === "qr-code" && (
                    <Badge variant="outline">QR Code Check-in</Badge>
                  )}
                  {project.verification_method === "manual" && (
                    <Badge variant="outline">Manual Check-in</Badge>
                  )}
                  {project.verification_method === "auto" && (
                    <Badge variant="outline">Automatic Check-in</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {project.verification_method === "qr-code"
                    ? "Volunteers will check-in by scanning a QR code"
                    : project.verification_method === "manual"
                      ? "Organizer will check-in volunteers manually"
                      : "System will handle check-ins automatically"}
                </p>
              </CardContent>
            </Card>

            {/* Project Documents Section - Moved here from left column */}
            {project.documents && project.documents.length > 0 && (
              <Card className="bg-card">
                <CardHeader className="pb-3">
                  <CardTitle>Project Documents</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {project.documents.map((doc, index) => (
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
