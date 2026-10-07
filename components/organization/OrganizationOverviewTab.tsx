"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Folders } from "lucide-react";

import { StatStrip } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { TabsContent } from "@/components/ui/tabs";
import { formatOrganizationWebsiteDisplay } from "@/lib/organization/website";
import type {
  Organization,
  Project,
  ResolvedOrganizationPluginSurface,
} from "@/types";
import { getProjectStatus } from "@/utils/project";
import {
  formatOrganizationTypeLabel,
  organizationWebsiteHref,
} from "./organization-type-label";

type Props = {
  organization: Organization & { website?: string | null };
  organizationCreatedLabel: string;
  projects: Project[];
  memberCount: number;
  totalHours: number;
  pluginOverviewExtensions: ResolvedOrganizationPluginSurface[];
  userRole: string | null;
  /** Where "View all" goes. Omitted when the organization has no Projects tab. */
  projectsHref?: string;
  /** Demo-only slot: extra admin controls shown on the landing page mockup. */
  demoAdminToolsContent?: ReactNode;
};

const RECENT_PROJECT_LIMIT = 4;

export function OrganizationOverviewTab({
  organization,
  organizationCreatedLabel,
  projects,
  memberCount,
  totalHours,
  pluginOverviewExtensions,
  userRole,
  projectsHref,
  demoAdminToolsContent,
}: Props) {
  const statusCounts = { upcoming: 0, completed: 0, cancelled: 0 };
  for (const project of projects) {
    const status = getProjectStatus(project);
    if (status in statusCounts) {
      statusCounts[status as keyof typeof statusCounts] += 1;
    }
  }

  const stats = [
    { label: "Members", value: memberCount.toLocaleString() },
    { label: "Total hours", value: `${totalHours.toFixed(1)}h` },
    { label: "Projects", value: projects.length.toLocaleString() },
    { label: "Upcoming", value: statusCounts.upcoming.toLocaleString() },
    { label: "Completed", value: statusCounts.completed.toLocaleString() },
    ...(statusCounts.cancelled > 0
      ? [
          {
            label: "Cancelled",
            value: statusCounts.cancelled.toLocaleString(),
          },
        ]
      : []),
  ];

  const canCreateProjects = userRole === "admin" || userRole === "staff";
  const typeLabel = formatOrganizationTypeLabel(organization.type);
  const recentProjects = projects.slice(0, RECENT_PROJECT_LIMIT);

  return (
    <TabsContent value="overview" className="grid gap-6">
      <StatStrip items={stats} />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent projects</CardTitle>
            {projectsHref && projects.length > 0 ? (
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={projectsHref} scroll={false} />}
                >
                  View all
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {recentProjects.length > 0 ? (
              <ItemGroup className="-mx-2 gap-0">
                {recentProjects.map((project) => (
                  <Item
                    key={project.id}
                    size="sm"
                    className="px-2"
                    render={<Link href={`/projects/${project.id}`} />}
                  >
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full">
                        <span className="truncate">{project.title}</span>
                      </ItemTitle>
                      {project.location ? (
                        <ItemDescription className="line-clamp-1">
                          {project.location}
                        </ItemDescription>
                      ) : null}
                    </ItemContent>
                    <ItemActions>
                      <ProjectStatusBadge status={getProjectStatus(project)} />
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <Empty className="p-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Folders aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No projects yet</EmptyTitle>
                  <EmptyDescription>
                    Projects this organization runs will show up here.
                  </EmptyDescription>
                </EmptyHeader>
                {canCreateProjects ? (
                  <EmptyContent>
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/projects/create?org=${organization.id}`}
                        />
                      }
                    >
                      New project
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="leading-relaxed wrap-break-word">
              {organization.description || "No description provided."}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              {typeLabel ? (
                <>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="min-w-0 truncate">{typeLabel}</dd>
                </>
              ) : null}
              {organization.website ? (
                <>
                  <dt className="text-muted-foreground">Website</dt>
                  <dd className="min-w-0">
                    <a
                      href={organizationWebsiteHref(organization.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary block truncate underline-offset-4 hover:underline"
                    >
                      {formatOrganizationWebsiteDisplay(organization.website)}
                    </a>
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Created</dt>
              <dd className="min-w-0 truncate">{organizationCreatedLabel}</dd>
            </dl>
            {userRole === "admin" && demoAdminToolsContent ? (
              <div className="flex flex-wrap gap-2">
                {demoAdminToolsContent}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {pluginOverviewExtensions.map((surface) => (
        <div key={surface.pluginKey}>{surface.node}</div>
      ))}
    </TabsContent>
  );
}
