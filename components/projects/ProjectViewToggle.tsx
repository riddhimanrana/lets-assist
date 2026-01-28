"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getProjectStatus } from "@/utils/project";
import { ReportContentButton } from "@/components/feedback/ReportContentButton";
import {
  MapPin,
  Calendar,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  BadgeCheck,
  MoreVertical,
  Flag,
} from "lucide-react";
import { ProjectsMapView } from "./ProjectsMapView";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
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
import { ProfileHoverCard, OrganizationHoverCard } from "@/components/shared/ProfileHoverCard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project as BaseProject, Organization } from "@/types";

type ProjectWithExtras = BaseProject & {
  organizations?: Organization;
  total_confirmed?: number;
};

const STORAGE_KEY = "preferred-project-view";
const VALID_VIEWS = ["card", "list", "table", "map"] as const;

type ValidView = (typeof VALID_VIEWS)[number];

// Update the type definition to include "map"
type ProjectViewToggleProps = {
  projects: ProjectWithExtras[];
  onVolunteerSortChange?: (sort: "asc" | "desc" | undefined) => void;
  volunteerSort?: "asc" | "desc" | undefined;
  view: ValidView;
  onViewChangeAction: (view: ValidView) => void;
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
  return `${count} ${count === 1 ? "spot" : "spots"} left`;
};

const formatDateDisplay = (project: ProjectWithExtras) => {
  if (!project.event_type || !project.schedule) return "";

  switch (project.event_type) {
    case "oneTime": {
      const dateStr = project.schedule.oneTime?.date;
      if (!dateStr) return "";
      const [year, month, dayNum] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, dayNum);
      return format(date, "MMM d");
    }
    case "multiDay": {
      if (!project.schedule.multiDay || project.schedule.multiDay.length === 0) {
        return "";
      }
      const dates = project.schedule.multiDay
        .map((day) => {
          const [year, month, dayNum] = day.date.split("-").map(Number);
          return new Date(year, month - 1, dayNum);
        })
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());

      // If dates are in the same month
      const allSameMonth = dates.every(
        (date: Date) => date.getMonth() === dates[0].getMonth(),
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
      const dateStr = project.schedule.sameDayMultiArea?.date;
      if (!dateStr) return "";
      const [year, month, dayNum] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, dayNum);
      return format(date, "MMM d");
    }
    default:
      return "";
  }
};

// Function to get a summary of event schedule for table view
const getEventScheduleSummary = (project: ProjectWithExtras) => {
  if (!project.event_type || !project.schedule) return "Not specified";

  switch (project.event_type) {
    case "oneTime": {
      const dateStr = project.schedule.oneTime?.date;
      if (!dateStr) {
        return "Not specified";
      }
      const [year, month, dayNum] = dateStr.split("-").map(Number);
      const dateFormat = new Date(year, month - 1, dayNum);
      const date = format(dateFormat, "MMM d, yyyy");
      const startTime = project.schedule.oneTime?.startTime;
      const endTime = project.schedule.oneTime?.endTime;
      if (startTime && endTime) {
        return `${date}, ${formatTime(startTime)} - ${formatTime(endTime)}`;
      }
      if (startTime) {
        return `${date}, starts ${formatTime(startTime)}`;
      }
      if (endTime) {
        return `${date}, ends ${formatTime(endTime)}`;
      }
      return date;
    }
    case "multiDay": {
      if (!project.schedule.multiDay || project.schedule.multiDay.length === 0) {
        return "Not specified";
      }
      const days = project.schedule.multiDay.length;
      const startDateStr = project.schedule.multiDay[0].date;
      const endDateStr = project.schedule.multiDay[days - 1].date;

      const [startYear, startMonth, startDayNum] = startDateStr
        .split("-")
        .map(Number);
      const [endYear, endMonth, endDayNum] = endDateStr.split("-").map(Number);

      const startDateFormat = new Date(startYear, startMonth - 1, startDayNum);
      const endDateFormat = new Date(endYear, endMonth - 1, endDayNum);

      const startDate = format(startDateFormat, "MMM d");
      const endDate = format(endDateFormat, "MMM d");

      return `${days} days (${startDate} - ${endDate})`;
    }
    case "sameDayMultiArea": {
      if (!project.schedule.sameDayMultiArea?.date) {
        return "Not specified";
      }
      const dateStr = project.schedule.sameDayMultiArea.date;
      const [year, month, dayNum] = dateStr.split("-").map(Number);
      const dateFormat = new Date(year, month - 1, dayNum);
      const date = format(dateFormat, "MMM d, yyyy");
      const roles = project.schedule.sameDayMultiArea.roles.length;
      return `${date}, ${roles} roles`;
    }
    default:
      return "Not specified";
  }
};

// Get volunteer count from project (total spots)
const getVolunteerCount = (project: ProjectWithExtras) => {
  if (!project.event_type || !project.schedule) return 0;

  switch (project.event_type) {
    case "oneTime":
      return project.schedule.oneTime?.volunteers || 0;
    case "multiDay": {
      // Sum all volunteers across all days and slots
      let total = 0;
      if (project.schedule.multiDay) {
        project.schedule.multiDay.forEach((day) => {
          if (day.slots) {
            day.slots.forEach((slot) => {
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
        project.schedule.sameDayMultiArea.roles.forEach((role) => {
          total += role.volunteers || 0;
        });
      }
      return total;
    }
    default:
      return 0;
  }
};

// New function to get remaining spots
const getRemainingSpots = (project: ProjectWithExtras) => {
  const totalSpots = getVolunteerCount(project);

  // Use confirmed_signups from server or count manually if signups array exists
  let filledSpots = 0;
  if (project.signups && Array.isArray(project.signups)) {
    // Include both approved and pending to avoid overestimating availability
    filledSpots = project.signups.filter(s => s.status === 'approved' || s.status === 'pending').length;
  } else {
    filledSpots = project.total_confirmed || 0;
  }

  return Math.max(0, totalSpots - filledSpots);
};

// Function to check if project has upcoming status
const isUpcomingProject = (project: ProjectWithExtras) => {
  return (
    project.status === "upcoming" || getProjectStatus(project) === "upcoming"
  );
};

// Function to get project organization or creator name
const getProjectCreator = (project: ProjectWithExtras) => {
  if (project.organization) {
    return project.organization.name || "Organization";
  } else if (project.organization_id && project.organizations) {
    // Alternative structure where the organization info is in 'organizations'
    return project.organizations.name || "Organization";
  }
  return project.profiles?.full_name || "Anonymous";
};

// Function to get project creator's avatar URL
const getCreatorAvatarUrl = (project: ProjectWithExtras) => {
  if (project.organization) {
    return project.organization.logo_url;
  } else if (project.organization_id && project.organizations) {
    return project.organizations.logo_url;
  }
  return project.profiles?.avatar_url;
};

// Function to check if the project's organization is verified
const isOrganizationVerified = (project: ProjectWithExtras) => {
  if (project.organization) {
    return project.organization.verified || false;
  } else if (project.organization_id && project.organizations) {
    return project.organizations.verified || false;
  }
  return false;
};

export const ProjectViewToggle: React.FC<ProjectViewToggleProps> = ({
  projects,
  onVolunteerSortChange,
  volunteerSort,
  view,
  onViewChangeAction,
}) => {
  const [initialViewLoaded, setInitialViewLoaded] = useState(false);
  const [reportingProject, setReportingProject] = useState<ProjectWithExtras | null>(null);

  // Update the effect to properly handle view persistence
  useEffect(() => {
    if (!initialViewLoaded) {
      const savedView = localStorage.getItem(STORAGE_KEY);
      if (savedView && VALID_VIEWS.includes(savedView as ValidView)) {
        onViewChangeAction(savedView as ValidView);
      }
      setInitialViewLoaded(true);
    } else {
      localStorage.setItem(STORAGE_KEY, view);
    }
  }, [view, onViewChangeAction, initialViewLoaded]);

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

  // Filter projects - only show upcoming projects with available spots
  const filteredProjects = projects.filter(
    (project) => isUpcomingProject(project) && getRemainingSpots(project) > 0,
  );

  return (
    <div>
      {/* Card View - Cleaner with hover cards */}
      {view === "card" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <div key={project.id} className="relative group">
              <Link href={`/projects/${project.id}`}>
                <Card className="hover:shadow-xl dark:hover:shadow-primary/10 transition-all cursor-pointer h-full flex flex-col group/project-card border-muted/40">
                  <div className="px-6 py-4 flex flex-col h-full">
                    <h3 className="text-xl font-bold mb-1 line-clamp-2 pr-8 leading-tight">
                      {project.title}
                    </h3>
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground truncate">
                        {project.location}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-4">
                      <Badge variant="outline" className="gap-1.5 py-1 px-2.5 font-medium border-muted-foreground/20 text-xs">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDateDisplay(project)}
                      </Badge>
                      <Badge variant="outline" className="gap-1.5 py-1 px-2.5 font-medium border-muted-foreground/20 text-xs">
                        <Users className="h-3.5 w-3.5" />
                        {formatSpots(getRemainingSpots(project))}
                      </Badge>
                    </div>

                    {/* User info with hover card - updated to show organization if available */}
                    <div className="mt-auto">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage
                            src={getCreatorAvatarUrl(project) || undefined}
                            alt={getProjectCreator(project)}
                          />
                          <AvatarFallback>
                            <NoAvatar
                              fullName={getProjectCreator(project)}
                              className="text-xs"
                            />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {project.organization_id ? (
                              <OrganizationHoverCard
                                organization={{
                                  username: project.organization?.username || project.organizations?.username || "",
                                  name: getProjectCreator(project),
                                  logo_url: getCreatorAvatarUrl(project),
                                  verified: isOrganizationVerified(project),
                                  type: project.organization?.type || project.organizations?.type,
                                }}
                              >
                                <span className="text-sm font-semibold truncate cursor-pointer">
                                  {getProjectCreator(project)}
                                </span>
                              </OrganizationHoverCard>
                            ) : (
                              <ProfileHoverCard
                                username={project.profiles?.username || ""}
                                fullName={getProjectCreator(project)}
                                avatarUrl={getCreatorAvatarUrl(project) || undefined}
                                createdAt={project.profiles?.created_at || undefined}
                              >
                                <span className="text-sm font-semibold truncate cursor-pointer">
                                  {getProjectCreator(project)}
                                </span>
                              </ProfileHoverCard>
                            )}
                            {project.organization_id && isOrganizationVerified(project) && (
                              <BadgeCheck className="h-4 w-4 shrink-0" fill="hsl(var(--primary))" stroke="hsl(var(--popover))" strokeWidth={2.5} />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>

              {/* Three-dot menu in top-right corner */}
              <div className="absolute top-4 right-4 z-10">
                <DropdownMenu>
                  <DropdownMenuTrigger render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                      <span className="sr-only">Open menu</span>
                    </Button>
                  } />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setReportingProject(project)}>
                      <Flag className="mr-2 h-4 w-4" />
                      <span>Report Project</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View - Updated with remaining spots and organization name */}
      {view === "list" && (
        <div className="flex flex-col divide-y">
          {filteredProjects.map((project) => (
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
                          <MapPin className="h-4 w-4 shrink-0" />
                          <span className="truncate">{project.location}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-start gap-2 order-1 md:order-0 project-badges">
                        <Badge
                          variant="outline"
                          className="gap-1 py-0.5 text-xs"
                        >
                          <Calendar className="h-3 w-3 md:h-2.5 md:w-2.5 project-badge-icon shrink-0" />
                          {formatDateDisplay(project)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="gap-1 py-0.5 text-xs"
                        >
                          <Users className="h-3 w-3 md:h-2.5 md:w-2.5 project-badge-icon shrink-0" />
                          {formatSpots(getRemainingSpots(project))}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3 project-avatar">
                      <Avatar className="h-7 w-7">
                        <AvatarImage
                          src={getCreatorAvatarUrl(project) || undefined}
                          alt={getProjectCreator(project)}
                        />
                        <AvatarFallback>
                          <NoAvatar
                            fullName={getProjectCreator(project)}
                            className="text-sm"
                          />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex items-center gap-1">
                        {project.organization_id ? (
                          <OrganizationHoverCard
                            organization={{
                              username: project.organization?.username || project.organizations?.username || "",
                              name: getProjectCreator(project),
                              logo_url: getCreatorAvatarUrl(project),
                              verified: isOrganizationVerified(project),
                              type: project.organization?.type || project.organizations?.type,
                            }}
                          >
                            <span className="text-sm font-medium truncate cursor-pointer">
                              {getProjectCreator(project)}
                            </span>
                          </OrganizationHoverCard>
                        ) : (
                          <ProfileHoverCard
                            username={project.profiles?.username || ""}
                            fullName={getProjectCreator(project)}
                            avatarUrl={getCreatorAvatarUrl(project) || undefined}
                            createdAt={project.profiles?.created_at || undefined}
                          >
                            <span className="text-sm font-medium truncate cursor-pointer">
                              {getProjectCreator(project)}
                            </span>
                          </ProfileHoverCard>
                        )}
                        {project.organization_id && isOrganizationVerified(project) && (
                          <BadgeCheck className="h-4 w-4 shrink-0" fill="hsl(var(--primary))" stroke="hsl(var(--popover))" strokeWidth={2.5} />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      } />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setReportingProject(project);
                        }}>
                          <Flag className="mr-2 h-4 w-4" />
                          <span>Report Project</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Table View - Updated for remaining spots and organization name */}
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
                    volunteerSort && "bg-muted/30",
                  )}
                  onClick={handleVolunteerSortToggle}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span className="hidden sm:inline">Spots Left</span>
                    <span className="sm:hidden">Spots</span>
                    {!volunteerSort && <ArrowUpDown className="h-3.5 w-3.5" />}
                    {volunteerSort === "desc" && (
                      <ArrowDown className="h-3.5 w-3.5" />
                    )}
                    {volunteerSort === "asc" && (
                      <ArrowUp className="h-3.5 w-3.5" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProjects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <div className="max-w-[300px] sm:max-w-none">
                      <div className="font-medium line-clamp-1">
                        {project.title}
                      </div>
                      <div className="text-xs text-muted-foreground sm:hidden flex items-center gap-2 mt-1">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{project.location}</span>
                      </div>
                      <div className="text-xs text-muted-foreground sm:hidden flex items-center gap-2 mt-1">
                        <Calendar className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {getEventScheduleSummary(project)}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm">
                        {getEventScheduleSummary(project)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate max-w-[180px]">
                        {project.location}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {project.organization_id ? (
                      <OrganizationHoverCard
                        organization={{
                          username: project.organization?.username || project.organizations?.username || "",
                          name: getProjectCreator(project),
                          logo_url: getCreatorAvatarUrl(project),
                          verified: isOrganizationVerified(project),
                          type: project.organization?.type || project.organizations?.type,
                        }}
                      >
                        <div className="flex items-center gap-2 cursor-pointer">
                          <Avatar className="h-7 w-7">
                            <AvatarImage
                              src={getCreatorAvatarUrl(project) || undefined}
                              alt={getProjectCreator(project)}
                            />
                            <AvatarFallback>
                              <NoAvatar fullName={getProjectCreator(project)} />
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-medium truncate">
                              {getProjectCreator(project)}
                            </span>
                            {isOrganizationVerified(project) && (
                              <BadgeCheck className="h-4 w-4 shrink-0" fill="hsl(var(--primary))" stroke="hsl(var(--popover))" strokeWidth={2.5} />
                            )}
                          </div>
                        </div>
                      </OrganizationHoverCard>
                    ) : (
                      <ProfileHoverCard
                        username={project.profiles?.username || ""}
                        fullName={getProjectCreator(project)}
                        avatarUrl={getCreatorAvatarUrl(project) || undefined}
                        createdAt={project.profiles?.created_at || undefined}
                      >
                        <div className="flex items-center gap-2 cursor-pointer">
                          <Avatar className="h-7 w-7">
                            <AvatarImage
                              src={getCreatorAvatarUrl(project) || undefined}
                              alt={getProjectCreator(project)}
                            />
                            <AvatarFallback>
                              <NoAvatar fullName={getProjectCreator(project)} />
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate">
                            {getProjectCreator(project)}
                          </span>
                        </div>
                      </ProfileHoverCard>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={volunteerSort ? "secondary" : "outline"}
                      className="gap-1"
                    >
                      <Users className="h-3 w-3" />
                      <span className="hidden sm:inline">
                        {formatSpots(getRemainingSpots(project))}
                      </span>
                      <span className="sm:hidden">
                        {getRemainingSpots(project)}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/projects/${project.id}`}>
                      <Button size="sm" className="h-8 px-3">
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {view === "map" && (
        <div className="w-full h-[500px]">
          <ProjectsMapView initialProjects={filteredProjects} />
        </div>
      )}

      {/* Fixed Report Content Dialog - moved outside project mapping to avoid layout/mounting issues */}
      {reportingProject && (
        <ReportContentButton
          contentType="project"
          contentId={reportingProject.id}
          contentTitle={reportingProject.title}
          contentCreator={reportingProject.profiles?.full_name || reportingProject.profiles?.username || undefined}
          contentContext={reportingProject.organization?.name || reportingProject.organizations?.name || undefined}
          open={!!reportingProject}
          onOpenChange={(open) => !open && setReportingProject(null)}
          showTrigger={false}
        />
      )}
    </div>
  );
};
