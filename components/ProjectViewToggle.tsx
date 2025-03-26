"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { 
  MapPin, 
  Calendar, 
  Users, 
  Clock, 
  LayoutGrid, 
  List, 
  Table2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  CalendarClock,
  CalendarDays
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import { Badge } from "@/components/ui/badge";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

type Project = any;

type ProjectViewToggleProps = {
  projects: Project[];
  onVolunteerSortChange?: (sort: "asc" | "desc" | undefined) => void;
  volunteerSort?: "asc" | "desc" | undefined;
  view: "card" | "list" | "table";
  onViewChange: (view: "card" | "list" | "table") => void;
};

const STORAGE_KEY = "preferred-project-view";

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

const formatDateDisplay = (project: any) => {
  if (!project.event_type || !project.schedule) return "";

  switch (project.event_type) {
    case "oneTime": {
      return format(new Date(project.schedule.oneTime.date), "MMM d");
    }
    case "multiDay": {
      const dates = project.schedule.multiDay
        .map((day: any) => new Date(day.date))
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());
      
      // If dates are in same month
      const allSameMonth = dates.every(
        (date: Date) => date.getMonth() === dates[0].getMonth()
      );
      
      if (dates.length <= 3) {
        if (allSameMonth) {
          // Format as "Mar 7, 9, 10"
          return `${format(dates[0], "MMM")} ${dates
            .map((date: Date) => format(date, "d"))
            .join(", ")}`;
        } else {
          // Format as "Mar 7, Apr 9, 10"
          return dates
            .map((date: Date, i: number) => {
              const prevDate = i > 0 ? dates[i - 1] : null;
              if (!prevDate || prevDate.getMonth() !== date.getMonth()) {
                return format(date, "MMM d");
              }
              return format(date, "d");
            })
            .join(", ");
        }
      } else {
        // For more than 3 dates, show range
        return `${format(dates[0], "MMM d")} - ${format(dates[dates.length - 1], "MMM d")}`;
      }
    }
    case "sameDayMultiArea": {
      return format(new Date(project.schedule.sameDayMultiArea.date), "MMM d");
    }
    default:
      return "";
  }
};

// Function to get a summary of event schedule for table view
const getEventScheduleSummary = (project: any) => {
  if (!project.event_type || !project.schedule) return "Not specified";

  switch (project.event_type) {
    case "oneTime": {
      const date = format(new Date(project.schedule.oneTime.date), "MMM d, yyyy");
      return `${date}, ${formatTime(project.schedule.oneTime.startTime)} - ${formatTime(project.schedule.oneTime.endTime)}`;
    }
    case "multiDay": {
      const days = project.schedule.multiDay.length;
      const startDate = format(new Date(project.schedule.multiDay[0].date), "MMM d");
      const endDate = format(new Date(project.schedule.multiDay[days - 1].date), "MMM d");
      return `${days} days (${startDate} - ${endDate})`;
    }
    case "sameDayMultiArea": {
      const date = format(new Date(project.schedule.sameDayMultiArea.date), "MMM d, yyyy");
      const roles = project.schedule.sameDayMultiArea.roles.length;
      return `${date}, ${roles} roles`;
    }
    default:
      return "Not specified";
  }
};

// Function to get volunteer count from project
const getVolunteerCount = (project: any) => {
  if (!project.event_type || !project.schedule) return 0;

  switch (project.event_type) {
    case "oneTime":
      return project.schedule.oneTime.volunteers || 0;
    case "multiDay": {
      // Sum all volunteers across all days and slots
      let total = 0;
      if (project.schedule.multiDay) {
        project.schedule.multiDay.forEach((day: any) => {
          if (day.slots) {
            day.slots.forEach((slot: any) => {
              total += slot.volunteers || 0;
            });
          }
        });
      }
      return total;
    }
    case "sameDayMultiArea": {
      // Sum all volunteers across all roles
      let total = 0;
      if (project.schedule.sameDayMultiArea?.roles) {
        project.schedule.sameDayMultiArea.roles.forEach((role: any) => {
          total += role.volunteers || 0;
        });
      }
      return total;
    }
    default:
      return 0;
  }
};

export const ProjectViewToggle: React.FC<ProjectViewToggleProps> = ({
  projects,
  onVolunteerSortChange,
  volunteerSort,
  view,
  onViewChange
}) => {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [initialViewLoaded, setInitialViewLoaded] = useState(false);

  // Combined effect for view preference management
  useEffect(() => {
    if (!initialViewLoaded) {
      // Load initial preference only once
      const savedView = localStorage.getItem(STORAGE_KEY) as "card" | "list" | "table" | null;
      if (savedView && savedView !== view) {
        onViewChange(savedView);
      }
      setInitialViewLoaded(true);
    } else {
      // Save preference on subsequent view changes
      localStorage.setItem(STORAGE_KEY, view);
    }
  }, [view, onViewChange, initialViewLoaded]);

  // Handle volunteer sort toggle
  const handleVolunteerSortToggle = () => {
    if (!onVolunteerSortChange) return;
    
    if (!volunteerSort) {
      onVolunteerSortChange("desc");
    } else if (volunteerSort === "desc") {
      onVolunteerSortChange("asc");
    } else {
      onVolunteerSortChange(undefined);
    }
  };

  // Handle mobile project click for table view
  const handleMobileProjectClick = (project: Project) => {
    setSelectedProject(project);
    setIsSheetOpen(true);
  };

  // Update EventInfo to only show spots
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
          const totalSpots = project.schedule.multiDay.reduce((acc: number, day: any) => {
            return acc + (day.slots?.reduce((sum: number, slot: any) => sum + (slot.volunteers || 0), 0) || 0);
          }, 0);
          return (
            <>
              <Badge variant="outline" className="gap-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(project.schedule.multiDay[0].date), "MMM d")} -{" "}
                {format(new Date(project.schedule.multiDay[days - 1].date), "MMM d")}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Users className="h-3 w-3" />
                {formatSpots(totalSpots)}
              </Badge>
            </>
          );
        case "sameDayMultiArea":
          const totalVolunteers = project.schedule.sameDayMultiArea.roles.reduce(
            (acc: number, role: any) => acc + (role.volunteers || 0),
            0
          );
          return (
            <>
              <Badge variant="outline" className="gap-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(project.schedule.sameDayMultiArea.date), "MMM d, yyyy")}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Users className="h-3 w-3" />
                {formatSpots(totalVolunteers)}
              </Badge>
            </>
          );
        default:
          return null;
      }
    };

    return <div className="flex flex-wrap gap-2">{getEventBadges()}</div>;
  };

  return (
    <div>
      {/* Card View - Cleaner with hover cards */}
      {view === "card" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project: any) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="p-6 hover:shadow-lg transition-all cursor-pointer h-full flex flex-col">
                <h3 className="text-xl font-semibold mb-2 line-clamp-1">{project.title}</h3>
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-muted-foreground truncate">{project.location}</span>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge variant="outline" className="gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDateDisplay(project)}
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" />
                    {formatSpots(getVolunteerCount(project))}
                  </Badge>
                </div>
                
                {/* User info with hover card - no separator */}
                <div className="mt-auto pt-3">
                    <HoverCard>
                    
                      <HoverCardTrigger asChild>
                      <div className="flex items-center gap-2 cursor-pointer">
                        <Avatar className="h-7 w-7">
                        <AvatarImage
                          src={project.profiles?.avatar_url}
                          alt={project.profiles?.full_name || "Creator"}
                        />
                        <AvatarFallback>
                          <NoAvatar fullName={project.profiles?.full_name} />
                        </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate">
                        {project.profiles?.full_name || "Anonymous"}
                        </span>
                      </div>
                      </HoverCardTrigger>
                    
                    <HoverCardContent className="w-auto">
                      <div className="flex justify-between space-x-4 cursor-pointer" onClick={() => window.location.href=`/profile/${project.profiles?.username || "unknown"}`}>
                      <Avatar className="h-10 w-10">
                        <AvatarImage 
                        src={project.profiles?.avatar_url}
                        alt={project.profiles?.full_name || "Creator"}
                        />
                        <AvatarFallback>
                        <NoAvatar fullName={project.profiles?.full_name} />
                        </AvatarFallback>
                      </Avatar>
                      <div className="space-y-1 flex-1">
                        <h4 className="text-sm font-semibold">
                        {project.profiles?.full_name || "Anonymous"}
                        </h4>
                        <p className="text-sm">
                        @{project.profiles?.username || "unknown"}
                        </p>
                        <div className="flex items-center pt-2">
                        <CalendarDays className="mr-2 h-4 w-4 opacity-70" />
                        <span className="text-xs text-muted-foreground">
                          {project.profiles?.created_at ? 
                          `Joined ${format(new Date(project.profiles.created_at), "MMMM yyyy")}` : 
                          "New member"}
                        </span>
                        </div>
                      </div>
                      </div>
                    </HoverCardContent>
                    </HoverCard>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* List View - Improved UI with better mobile support */}
      {view === "list" && (
        <div className="flex flex-col divide-y">
          {projects.map((project: any) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <div className="group py-6 px-4 -mx-4 hover:bg-muted/50 transition-colors project-list-item">
                <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-4">
                      <div>
                        <h3 className="text-lg font-semibold leading-tight mb-1 md:mb-1 group-hover:text-primary transition-colors project-title">
                          {project.title}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2 md:mb-3 project-location">
                          <MapPin className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">{project.location}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-start gap-2 order-1 md:order-none project-badges">
                        <Badge variant="outline" className="gap-1 py-0.5 text-xs">
                          <Calendar className="h-3 w-3 md:h-2.5 md:w-2.5 project-badge-icon" />
                          {formatDateDisplay(project)}
                        </Badge>
                        <Badge variant="outline" className="gap-1 py-0.5 text-xs">
                          <Users className="h-3 w-3 md:h-2.5 md:w-2.5 project-badge-icon" />
                          {formatSpots(getVolunteerCount(project))}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3 project-avatar">
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <div className="flex items-center gap-2 cursor-pointer">
                            <Avatar className="h-7 w-7">
                              <AvatarImage
                                src={project.profiles?.avatar_url}
                                alt={project.profiles?.full_name || "Creator"}
                              />
                              <AvatarFallback>
                                <NoAvatar fullName={project.profiles?.full_name} />
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium truncate">
                              {project.profiles?.full_name || "Anonymous"}
                            </span>
                          </div>
                        </HoverCardTrigger>
                      
                        <HoverCardContent className="w-auto">
                          <div className="flex justify-between space-x-4 cursor-pointer" onClick={(e) => {
                            e.preventDefault();
                            window.location.href=`/profile/${project.profiles?.username || "unknown"}`;
                          }}>
                            <Avatar className="h-10 w-10">
                              <AvatarImage 
                                src={project.profiles?.avatar_url}
                                alt={project.profiles?.full_name || "Creator"}
                              />
                              <AvatarFallback>
                                <NoAvatar fullName={project.profiles?.full_name} />
                              </AvatarFallback>
                            </Avatar>
                            <div className="space-y-1 flex-1">
                              <h4 className="text-sm font-semibold">
                                {project.profiles?.full_name || "Anonymous"}
                              </h4>
                              <p className="text-sm">
                                @{project.profiles?.username || "unknown"}
                              </p>
                              <div className="flex items-center pt-2">
                                <CalendarDays className="mr-2 h-4 w-4 opacity-70" />
                                <span className="text-xs text-muted-foreground">
                                  {project.profiles?.created_at ? 
                                  `Joined ${format(new Date(project.profiles.created_at), "MMMM yyyy")}` : 
                                  "New member"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    className="hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Table View - Now with responsive design */}
      {view === "table" && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="hidden sm:table-cell">Schedule</TableHead>
                <TableHead className="hidden sm:table-cell">Location</TableHead>
                <TableHead className="hidden sm:table-cell">Creator</TableHead>
                <TableHead 
                  className={cn(
                    "text-center cursor-pointer hover:bg-muted/50 transition-colors",
                    volunteerSort && "bg-muted/30"
                  )}
                  onClick={handleVolunteerSortToggle}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span className="hidden sm:inline">Volunteers</span>
                    <span className="sm:hidden">Vol.</span>
                    {!volunteerSort && <ArrowUpDown className="h-3.5 w-3.5" />}
                    {volunteerSort === "desc" && <ArrowDown className="h-3.5 w-3.5" />}
                    {volunteerSort === "asc" && <ArrowUp className="h-3.5 w-3.5" />}
                  </div>
                </TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project: any) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <div className="max-w-[300px] sm:max-w-none">
                      <div className="font-medium line-clamp-1">{project.title}</div>
                      <div className="text-xs text-muted-foreground sm:hidden flex items-center gap-2 mt-1">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{project.location}</span>
                      </div>
                      <div className="text-xs text-muted-foreground sm:hidden flex items-center gap-2 mt-1">
                        <Calendar className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{getEventScheduleSummary(project)}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm">{getEventScheduleSummary(project)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm truncate max-w-[180px]">{project.location}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                  <HoverCard>
                    
                      <HoverCardTrigger asChild>
                      <div className="flex items-center gap-2 cursor-pointer">
                        <Avatar className="h-7 w-7">
                        <AvatarImage
                          src={project.profiles?.avatar_url}
                          alt={project.profiles?.full_name || "Creator"}
                        />
                        <AvatarFallback>
                          <NoAvatar fullName={project.profiles?.full_name} />
                        </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate">
                        {project.profiles?.full_name || "Anonymous"}
                        </span>
                      </div>
                      </HoverCardTrigger>
                    
                    <HoverCardContent className="w-auto">
                      <div className="flex justify-between space-x-4 cursor-pointer" onClick={() => window.location.href=`/profile/${project.profiles?.username || "unknown"}`}>
                      <Avatar className="h-10 w-10">
                        <AvatarImage 
                        src={project.profiles?.avatar_url}
                        alt={project.profiles?.full_name || "Creator"}
                        />
                        <AvatarFallback>
                        <NoAvatar fullName={project.profiles?.full_name} />
                        </AvatarFallback>
                      </Avatar>
                      <div className="space-y-1 flex-1">
                        <h4 className="text-sm font-semibold">
                        {project.profiles?.full_name || "Anonymous"}
                        </h4>
                        <p className="text-sm">
                        @{project.profiles?.username || "unknown"}
                        </p>
                        <div className="flex items-center pt-2">
                        <CalendarDays className="mr-2 h-4 w-4 opacity-70" />
                        <span className="text-xs text-muted-foreground">
                          {project.profiles?.created_at ? 
                          `Joined ${format(new Date(project.profiles.created_at), "MMMM yyyy")}` : 
                          "New member"}
                        </span>
                        </div>
                      </div>
                      </div>
                    </HoverCardContent>
                    </HoverCard>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={volunteerSort ? "secondary" : "outline"} className="gap-1">
                      <Users className="h-3 w-3" />
                      <span className="hidden sm:inline">{formatSpots(getVolunteerCount(project))}</span>
                      <span className="sm:hidden">{getVolunteerCount(project)}</span>
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/projects/${project.id}`}>
                      <Button size="sm" className="h-8 px-3">View</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};
