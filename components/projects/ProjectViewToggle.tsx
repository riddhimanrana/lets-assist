"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  ChevronRight,
  MapPin,
  Users,
} from "lucide-react";

import { ReportContentButton } from "@/components/feedback/ReportContentButton";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { ProjectsMapView } from "./ProjectsMapView";
import { ProjectHost } from "./project-view/ProjectHost";
import { ProjectReportMenu } from "./project-view/ProjectReportMenu";
import {
  formatDateDisplay,
  formatSpots,
  getEventScheduleSummary,
  getRemainingSpots,
  isUpcomingProject,
} from "./project-view/project-display";
import {
  PROJECT_VIEW_STORAGE_KEY,
  VALID_PROJECT_VIEWS,
  type ProjectViewToggleProps,
  type ProjectWithExtras,
  type ValidProjectView,
} from "./project-view/types";

/** Date, place, spots left: always these three, always in this order. */
function ProjectFacts({ project }: { project: ProjectWithExtras }) {
  return (
    <dl className="grid gap-1.5 text-sm">
      <div className="flex items-center gap-2">
        <dt className="shrink-0">
          <Calendar
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
          <span className="sr-only">Date</span>
        </dt>
        <dd className="truncate">{formatDateDisplay(project)}</dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="shrink-0">
          <MapPin className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="sr-only">Location</span>
        </dt>
        <dd className="truncate">{project.location}</dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="shrink-0">
          <Users className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="sr-only">Availability</span>
        </dt>
        <dd className="truncate tabular-nums">
          {formatSpots(getRemainingSpots(project))}
        </dd>
      </div>
    </dl>
  );
}

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

  const SortIcon =
    volunteerSort === "desc"
      ? ArrowDown
      : volunteerSort === "asc"
        ? ArrowUp
        : ArrowUpDown;

  return (
    <div>
      {filteredProjects.length === 0 && view !== "map" && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No projects found</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}

      {view === "card" && filteredProjects.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4">
          {filteredProjects.map((project) => (
            <div key={project.id} className="relative">
              <Link
                href={`/projects/${project.id}`}
                className="group/project-card focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-[3px]"
              >
                <Card className="group-hover/project-card:ring-foreground/25 h-full gap-3 transition-shadow">
                  <div className="grid gap-1.5 pr-12 pl-4">
                    <h3 className="line-clamp-2 min-h-11 text-base leading-snug font-semibold">
                      {project.title}
                    </h3>
                    <ProjectHost project={project} />
                  </div>
                  <div className="mt-auto border-t px-4 pt-3">
                    <ProjectFacts project={project} />
                  </div>
                </Card>
              </Link>
              <ProjectReportMenu
                className="absolute top-2 right-2"
                onReport={() => setReportingProject(project)}
              />
            </div>
          ))}
        </div>
      )}

      {view === "list" && filteredProjects.length > 0 && (
        <ul className="divide-y border-y">
          {filteredProjects.map((project) => (
            <li key={project.id} className="relative flex items-center gap-2">
              <Link
                href={`/projects/${project.id}`}
                className="group/project-row hover:bg-muted focus-visible:ring-ring/50 -mx-2 flex min-w-0 flex-1 items-center gap-4 rounded-md px-2 py-3 outline-none focus-visible:ring-[3px]"
              >
                <div className="grid min-w-0 flex-1 gap-1">
                  <h3 className="truncate text-base font-medium">
                    {project.title}
                  </h3>
                  <ProjectHost project={project} />
                  <p className="text-muted-foreground truncate text-sm sm:hidden">
                    {formatDateDisplay(project)} · {project.location}
                  </p>
                  <p className="text-sm tabular-nums sm:hidden">
                    {formatSpots(getRemainingSpots(project))}
                  </p>
                </div>
                <p className="text-muted-foreground hidden w-48 shrink-0 truncate text-sm lg:block">
                  {project.location}
                </p>
                <div className="hidden w-32 shrink-0 text-right text-sm sm:block">
                  <p className="font-medium">{formatDateDisplay(project)}</p>
                  <p className="text-muted-foreground tabular-nums">
                    {formatSpots(getRemainingSpots(project))}
                  </p>
                </div>
                <ChevronRight
                  className="text-muted-foreground hidden size-4 shrink-0 sm:block"
                  aria-hidden="true"
                />
              </Link>
              <ProjectReportMenu
                className="shrink-0"
                onReport={() => setReportingProject(project)}
              />
            </li>
          ))}
        </ul>
      )}

      {view === "table" && filteredProjects.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="hidden sm:table-cell">Schedule</TableHead>
                <TableHead className="hidden sm:table-cell">Location</TableHead>
                <TableHead className="hidden sm:table-cell">Creator</TableHead>
                <TableHead
                  className="text-right"
                  aria-sort={
                    volunteerSort === "desc"
                      ? "descending"
                      : volunteerSort === "asc"
                        ? "ascending"
                        : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={handleVolunteerSortToggle}
                    className={cn(
                      "hover:text-foreground focus-visible:ring-ring/50 -mr-2 inline-flex h-9 items-center gap-1 rounded-md px-2 outline-none focus-visible:ring-[3px]",
                      volunteerSort && "text-foreground",
                    )}
                  >
                    <span className="hidden sm:inline">Spots left</span>
                    <span className="sm:hidden">Spots</span>
                    <SortIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </TableHead>
                <TableHead className="w-20">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProjects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <div className="max-w-48 sm:max-w-xs">
                      <div className="truncate font-medium">
                        {project.title}
                      </div>
                      <div className="text-muted-foreground mt-0.5 truncate text-xs sm:hidden">
                        {getEventScheduleSummary(project)}
                      </div>
                      <div className="text-muted-foreground truncate text-xs sm:hidden">
                        {project.location}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {getEventScheduleSummary(project)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="block max-w-44 truncate">
                      {project.location}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <ProjectHost
                      project={project}
                      className="text-foreground max-w-48"
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {getRemainingSpots(project)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/projects/${project.id}`}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                      )}
                    >
                      View
                      <span className="sr-only">: {project.title}</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {view === "map" && (
        <div className="h-125 w-full">
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
