"use client";

import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { MapPin, Calendar, Users, Clock } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { format, parse } from "date-fns";

type Project = any;

type ProjectViewToggleProps = {
  projects: Project[];
};

const formatTime = (timeString: string) => {
  try {
    const date = parse(timeString, "HH:mm", new Date());
    return format(date, "h:mm a");
  } catch {
    return timeString;
  }
};

const formatSpots = (count: number) => {
  return `${count} ${count === 1 ? 'spot' : 'spots'}`;
};

const EventInfo = ({ project }: { project: any }) => {
  if (!project.event_type || !project.schedule) return null;

  const getEventBadges = () => {
    switch (project.event_type) {
      case "oneTime":
        return (
          <>
            <Badge variant="outline" className="gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(project.schedule.oneTime.date), "MMM d, yyyy")}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {formatTime(project.schedule.oneTime.startTime)} - {formatTime(project.schedule.oneTime.endTime)}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Users className="h-3 w-3" />
              {formatSpots(project.schedule.oneTime.volunteers)}
            </Badge>
          </>
        );
      case "multiDay":
        const days = project.schedule.multiDay.length;
        return (
          <>
            <Badge variant="outline" className="gap-1">
              <Calendar className="h-3 w-3" />
              {days} {days === 1 ? "Day" : "Days"}
            </Badge>
            <Badge variant="outline" className="gap-1">
              {format(new Date(project.schedule.multiDay[0].date), "MMM d")} -{" "}
              {format(new Date(project.schedule.multiDay[days - 1].date), "MMM d")}
            </Badge>
          </>
        );
      case "sameDayMultiArea":
        return (
          <>
            <Badge variant="outline" className="gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(project.schedule.sameDayMultiArea.date), "MMM d, yyyy")}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Users className="h-3 w-3" />
              {project.schedule.sameDayMultiArea.roles.length} roles
            </Badge>
          </>
        );
      default:
        return null;
    }
  };

  return <div className="flex flex-wrap gap-2 mb-4">{getEventBadges()}</div>;
};

export const ProjectViewToggle: React.FC<ProjectViewToggleProps> = ({ projects }) => {
  const [view, setView] = React.useState<"card" | "list">("card");

  React.useEffect(() => {
    const savedView = localStorage.getItem("projectsView") as "card" | "list" | null;
    if (savedView) setView(savedView);
  }, []);

  const handleViewChange = (newView: "card" | "list") => {
    setView(newView);
    localStorage.setItem("projectsView", newView);
  };

  return (
    <Tabs value={view} onValueChange={(val) => handleViewChange(val as "card" | "list")}>
      <TabsList className="mb-4">
        <TabsTrigger value="card">Card View</TabsTrigger>
        <TabsTrigger value="list">List View</TabsTrigger>
      </TabsList>
      <TabsContent value="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project: any) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="p-6 hover:shadow-2xl transition-shadow cursor-pointer">
                <h2 className="text-2xl font-bold mb-2">{project.title}</h2>
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">{project.location}</span>
                </div>
                <EventInfo project={project} />
                <div className="flex items-center gap-2">
                  <Avatar className="w-10 h-10">
                    <AvatarImage
                      src={project.profiles?.avatar_url}
                      alt={project.profiles?.full_name || "Creator"}
                    />
                    <AvatarFallback>
                      <NoAvatar fullName={project.profiles?.full_name} />
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{project.profiles?.full_name || "Anonymous"}</p>
                    <p className="text-xs text-muted-foreground">
                      @{project.profiles?.username || "unknown"}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </TabsContent>
      <TabsContent value="list">
        <div className="flex flex-col gap-4">
          {projects.map((project: any) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="p-4 hover:shadow-2xl transition-shadow cursor-pointer">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-bold mb-2">{project.title}</h2>
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin className="h-5 w-5 text-muted-foreground" />
                      <span className="text-sm">{project.location}</span>
                    </div>
                    <EventInfo project={project} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Avatar className="w-10 h-10">
                      <AvatarImage
                        src={project.profiles?.avatar_url}
                        alt={project.profiles?.full_name || "Creator"}
                      />
                      <AvatarFallback>
                        <NoAvatar fullName={project.profiles?.full_name} />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{project.profiles?.full_name || "Anonymous"}</p>
                      <p className="text-xs text-muted-foreground">
                        @{project.profiles?.username || "unknown"}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
};
