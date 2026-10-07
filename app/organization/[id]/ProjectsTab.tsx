"use client";

import { AttendanceExport } from "@/components/projects/AttendanceExport";
import { canManageProjectAccess } from "@/lib/projects/management-access";
import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Plus, Search } from "lucide-react";

import { PlusIcon, useAnimatedIcon } from "@/components/icons/animated";
import { EmptyStateIcon } from "@/components/organization/EmptyStateIcon";
import { SectionHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { stripHtml } from "@/lib/utils";
import type { Project, ProjectStatus } from "@/types";
import { getProjectEventDate, getProjectStatus } from "@/utils/project";

interface ProjectsTabProps {
  projects: Project[];
  userRole: string | null;
  organizationId: string;
  currentUserId?: string;
  /**
   * Show "New project" in this tab's header. Off by default because the
   * organization header already carries it; on when a plugin hides it there.
   */
  showCreateAction?: boolean;
}

type StatusFilter = ProjectStatus | "all";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "in-progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const EMPTY_COPY: Record<StatusFilter, { title: string; description: string }> =
  {
    all: {
      title: "No projects yet",
      description: "Projects this organization runs will show up here.",
    },
    upcoming: {
      title: "No upcoming projects",
      description: "Nothing is scheduled right now.",
    },
    "in-progress": {
      title: "Nothing in progress",
      description: "No projects are running right now.",
    },
    completed: {
      title: "No completed projects",
      description: "Finished projects will show up here.",
    },
    cancelled: {
      title: "No cancelled projects",
      description: "Cancelled projects will show up here.",
    },
  };

function isStatusFilter(value: unknown): value is StatusFilter {
  return STATUS_FILTERS.some((filter) => filter.value === value);
}

/** The event date, or null when a project's schedule is missing or malformed. */
function formatProjectEventDate(project: Project): string | null {
  try {
    const date = getProjectEventDate(project);
    return Number.isNaN(date.getTime()) ? null : format(date, "MMM d, yyyy");
  } catch {
    return null;
  }
}

export default function ProjectsTab({
  projects,
  userRole,
  organizationId,
  showCreateAction = false,
  currentUserId,
}: ProjectsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const createIcon = useAnimatedIcon();

  const projectsWithStatus = useMemo(
    () =>
      projects.map((project) => ({
        project,
        status: getProjectStatus(project),
      })),
    [projects],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: projectsWithStatus.length };
    for (const { status } of projectsWithStatus) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }, [projectsWithStatus]);

  const trimmedSearch = searchTerm.trim().toLowerCase();
  const filteredProjects = projectsWithStatus.filter(({ project, status }) => {
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (!trimmedSearch) return true;
    return [project.title, project.description || "", project.location || ""]
      .join("\n")
      .toLowerCase()
      .includes(trimmedSearch);
  });

  const canCreateProjects = userRole === "admin" || userRole === "staff";
  const createHref = `/projects/create?org=${organizationId}`;
  const emptyCopy = EMPTY_COPY[statusFilter];

  return (
    <div className="grid gap-4">
      <SectionHeader
        title="Projects"
        description={`${projects.length.toLocaleString()} ${
          projects.length === 1 ? "project" : "projects"
        }`}
        actions={
          canCreateProjects && showCreateAction ? (
            <Button
              nativeButton={false}
              render={<Link href={createHref} />}
              {...createIcon.triggerProps}
            >
              <PlusIcon
                ref={createIcon.ref}
                size={16}
                data-icon="inline-start"
                aria-hidden="true"
              />
              New project
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <InputGroup className="lg:max-w-xs">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </InputGroup>

        <NativeSelect
          aria-label="Filter projects by status"
          className="w-full sm:hidden [&_select]:h-9"
          value={statusFilter}
          onChange={(event) => {
            if (isStatusFilter(event.target.value)) {
              setStatusFilter(event.target.value);
            }
          }}
        >
          {STATUS_FILTERS.map((filter) => (
            <NativeSelectOption key={filter.value} value={filter.value}>
              {filter.label} ({statusCounts[filter.value] ?? 0})
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <ToggleGroup
          aria-label="Filter projects by status"
          variant="outline"
          className="hidden sm:flex"
          value={[statusFilter]}
          onValueChange={(value) => {
            const nextValue = value[0];
            if (isStatusFilter(nextValue)) setStatusFilter(nextValue);
          }}
        >
          {STATUS_FILTERS.map((filter) => (
            <ToggleGroupItem
              key={filter.value}
              value={filter.value}
              className="gap-1.5 px-3"
            >
              {filter.label}
              <span className="text-muted-foreground tabular-nums">
                {statusCounts[filter.value] ?? 0}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {userRole === "admin" && (
        <AttendanceExport
          scope="organization"
          scopeId={organizationId}
          projects={projects}
        />
      )}

      {filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map(({ project, status }) => (
            <div key={project.id} className="grid content-start gap-2">
              <ProjectCard project={project} status={status} />
              {currentUserId &&
                canManageProjectAccess({
                  creatorId: project.creator_id,
                  userId: currentUserId,
                  organizationRole: userRole,
                  canBeManagedByStaff: project.can_be_managed_by_staff,
                }) && (
                  <Button
                    variant="outline"
                    render={<Link href={`/projects/${project.id}/hours`} />}
                  >
                    Volunteer hours
                  </Button>
                )}
            </div>
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {trimmedSearch ? (
                <Search aria-hidden="true" />
              ) : (
                <EmptyStateIcon name="folders" />
              )}
            </EmptyMedia>
            <EmptyTitle>
              {trimmedSearch ? "No projects found" : emptyCopy.title}
            </EmptyTitle>
            <EmptyDescription>
              {trimmedSearch
                ? `Nothing matches "${searchTerm.trim()}". Try a different search.`
                : emptyCopy.description}
            </EmptyDescription>
          </EmptyHeader>
          {canCreateProjects &&
          statusFilter !== "cancelled" &&
          !trimmedSearch ? (
            <EmptyContent>
              <Button nativeButton={false} render={<Link href={createHref} />}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                New project
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  status,
}: {
  project: Project;
  status: ProjectStatus;
}) {
  const eventDate = formatProjectEventDate(project);
  const meta = [project.location, eventDate].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-[3px]"
    >
      <Card className="group-hover:ring-foreground/25 h-full transition-colors">
        <CardHeader>
          <CardTitle className="truncate">{project.title}</CardTitle>
          <CardAction>
            <ProjectStatusBadge status={status} />
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3">
          <CardDescription className="line-clamp-2">
            {project.description
              ? stripHtml(project.description)
              : "No description provided."}
          </CardDescription>
          {meta ? (
            <p className="text-muted-foreground truncate text-sm">{meta}</p>
          ) : null}
          {project.organization ? (
            <p className="text-muted-foreground truncate text-sm">
              Organized by {project.profiles?.full_name || "Anonymous"}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
