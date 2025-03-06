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
import { CalendarDays, MapPin, Users, Share2, Clock } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { signUpForProject } from "./actions";
import { formatTimeTo12Hour } from "@/lib/utils";
import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

type Props = {
  project: Project;
  creator: Profile | null;
};

type ScheduleData =
  | OneTimeSchedule
  | MultiDayScheduleDay[]
  | SameDayMultiAreaSchedule
  | undefined;

const formatSpots = (count: number) => {
  return `${count} ${count === 1 ? 'spot' : 'spots'}`;
};

export default function ProjectDetails({
  project,
  creator,
}: Props): React.ReactElement {
  const { toast } = useToast();

  // Handle share button click
  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      toast({
        title: "Link copied",
        description: "Project link copied to clipboard",
      });
    }).catch(err => {
      toast({
        title: "Copy failed",
        description: "Could not copy link to clipboard",
        variant: "destructive",
      });
      console.error("Copy failed: ", err);
    });
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
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success!",
        description: "You have successfully signed up for this project.",
      });
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
              {formatTimeTo12Hour(oneTimeData.startTime)} -{" "}
              {formatTimeTo12Hour(oneTimeData.endTime)}
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
        return (
          <div className="mt-4">
            <Badge variant="secondary" className="mb-2">
              <CalendarDays className="h-4 w-4 mr-1" />
              {multiDayData.length} Day Event
            </Badge>
            <div className="flex flex-wrap gap-2">
              {multiDayData.map((day, index) => (
                <Badge key={index} variant="outline">
                  {format(new Date(day.date), "MMM d")}
                </Badge>
              ))}
            </div>
          </div>
        );
      }

      case "sameDayMultiArea": {
        const multiAreaData = scheduleData as SameDayMultiAreaSchedule;
        return (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                <CalendarDays className="h-4 w-4 mr-1" />
                {format(new Date(multiAreaData.date), "MMMM d, yyyy")}
              </Badge>
              <Badge variant="secondary">
                <Clock className="h-4 w-4 mr-1" />
                {formatTimeTo12Hour(multiAreaData.overallStart)} -{" "}
                {formatTimeTo12Hour(multiAreaData.overallEnd)}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {multiAreaData.roles?.map((role, index) => (
                <Badge key={index} variant="outline">
                  {role.name}
                </Badge>
              ))}
            </div>
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
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
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

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Project Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Project Coordinator
                </h3>
                <div className="flex items-center gap-3">
                  <HoverCard>
                    <HoverCardTrigger asChild>
                      <Link href={`/profile/${creator?.username || ""}`} className="flex items-center gap-3">
                        <Avatar className="w-10 h-10">
                          {creator?.avatar_url ? (
                            <AvatarImage 
                              src={creator.avatar_url} 
                              alt={creator?.full_name || "Profile"} 
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
                    <HoverCardContent className="w-80">
                      <div className="flex justify-between space-x-4">
                        <Avatar>
                          {creator?.avatar_url ? (
                            <AvatarImage src={creator.avatar_url} />
                          ) : null}
                          <AvatarFallback className="bg-muted">
                            <NoAvatar 
                              fullName={creator?.full_name}
                              className="text-sm font-medium" 
                            />
                          </AvatarFallback>
                        </Avatar>
                        <div className="space-y-1">
                          <h4 className="text-sm font-semibold">
                            {creator?.full_name || "Anonymous"}
                          </h4>
                          <p className="text-sm">@{creator?.username || "user"}</p>
                          <div className="flex items-center pt-2">
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`/profile/${creator?.username || ""}`}>
                                View profile
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                </div>
              </div>

              <div>
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
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
