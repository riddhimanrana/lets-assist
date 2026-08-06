"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
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
  ProfileHoverCard,
  OrganizationHoverCard,
} from "@/components/shared/ProfileHoverCard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatDateDisplay,
  formatSpots,
  getCreatorAvatarUrl,
  getEventScheduleSummary,
  getProjectCreator,
  getRemainingSpots,
  isOrganizationVerified,
  isUpcomingProject,
} from "./project-view/project-display";
import {
  PROJECT_VIEW_STORAGE_KEY,
  VALID_PROJECT_VIEWS,
  type ProjectViewToggleProps,
  type ProjectWithExtras,
  type ValidProjectView,
} from "./project-view/types";

export const ProjectViewToggle: React.FC<ProjectViewToggleProps> = ({
  projects,
  onVolunteerSortChange,
  volunteerSort,
  view,
  onViewChangeAction,
}) => {
  const [initialViewLoaded, setInitialViewLoaded] = useState(false);
  const [reportingProject, setReportingProject] =
    useState<ProjectWithExtras | null>(null);

  // Update the effect to properly handle view persistence
  useEffect(() => {
    if (!initialViewLoaded) {
      const savedView = localStorage.getItem(PROJECT_VIEW_STORAGE_KEY);
      if (
        savedView &&
        VALID_PROJECT_VIEWS.includes(savedView as ValidProjectView)
      ) {
        onViewChangeAction(savedView as ValidProjectView);
      }
      setInitialViewLoaded(true);
    } else {
      localStorage.setItem(PROJECT_VIEW_STORAGE_KEY, view);
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(376px,2fr))] gap-6">
          {filteredProjects.map((project) => (
            <div key={project.id} className="relative group">
              <Link href={`/projects/${project.id}`}>
                <Card className="hover:shadow-xl dark:hover:shadow-primary/10 transition-all cursor-pointer h-full flex flex-col group/project-card border-muted/40">
                  <div className="px-4 py-1 flex flex-col h-full">
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
                      <Badge
                        variant="outline"
                        className="gap-1.5 py-1 px-2.5 font-medium border-muted-foreground/20 text-xs"
                      >
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDateDisplay(project)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="gap-1.5 py-1 px-2.5 font-medium border-muted-foreground/20 text-xs"
                      >
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
                                  username:
                                    project.organization?.username ||
                                    project.organizations?.username ||
                                    "",
                                  name: getProjectCreator(project),
                                  logo_url: getCreatorAvatarUrl(project),
                                  verified: isOrganizationVerified(project),
                                  type:
                                    project.organization?.type ||
                                    project.organizations?.type,
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
                                avatarUrl={
                                  getCreatorAvatarUrl(project) || undefined
                                }
                                createdAt={
                                  project.profiles?.created_at || undefined
                                }
                              >
                                <span className="text-sm font-semibold truncate cursor-pointer">
                                  {getProjectCreator(project)}
                                </span>
                              </ProfileHoverCard>
                            )}
                            {project.organization_id &&
                              isOrganizationVerified(project) && (
                                <BadgeCheck className="h-4 w-4 shrink-0 text-success" />
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
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setReportingProject(project)}
                    >
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
                              username:
                                project.organization?.username ||
                                project.organizations?.username ||
                                "",
                              name: getProjectCreator(project),
                              logo_url: getCreatorAvatarUrl(project),
                              verified: isOrganizationVerified(project),
                              type:
                                project.organization?.type ||
                                project.organizations?.type,
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
                            avatarUrl={
                              getCreatorAvatarUrl(project) || undefined
                            }
                            createdAt={
                              project.profiles?.created_at || undefined
                            }
                          >
                            <span className="text-sm font-medium truncate cursor-pointer">
                              {getProjectCreator(project)}
                            </span>
                          </ProfileHoverCard>
                        )}
                        {project.organization_id &&
                          isOrganizationVerified(project) && (
                            <BadgeCheck className="h-4 w-4 shrink-0 text-success" />
                          )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger
                        render={
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
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setReportingProject(project);
                          }}
                        >
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
                <TableHead className="w-25 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProjects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <div className="max-w-75 sm:max-w-none">
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
                      <span className="text-sm truncate max-w-45">
                        {project.location}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {project.organization_id ? (
                      <OrganizationHoverCard
                        organization={{
                          username:
                            project.organization?.username ||
                            project.organizations?.username ||
                            "",
                          name: getProjectCreator(project),
                          logo_url: getCreatorAvatarUrl(project),
                          verified: isOrganizationVerified(project),
                          type:
                            project.organization?.type ||
                            project.organizations?.type,
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
                              <BadgeCheck className="h-4 w-4 shrink-0 text-success" />
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
        <div className="w-full h-125">
          <ProjectsMapView initialProjects={filteredProjects} />
        </div>
      )}

      {/* Fixed Report Content Dialog - moved outside project mapping to avoid layout/mounting issues */}
      {reportingProject && (
        <ReportContentButton
          contentType="project"
          contentId={reportingProject.id}
          contentTitle={reportingProject.title}
          contentCreator={
            reportingProject.profiles?.full_name ||
            reportingProject.profiles?.username ||
            undefined
          }
          contentContext={
            reportingProject.organization?.name ||
            reportingProject.organizations?.name ||
            undefined
          }
          open={!!reportingProject}
          onOpenChange={(open) => !open && setReportingProject(null)}
          showTrigger={false}
        />
      )}
    </div>
  );
};
