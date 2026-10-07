import Link from "next/link";
import { format } from "date-fns";
import { tz } from "@date-fns/tz";
import { Award, ChevronRight } from "lucide-react";

import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { EmptyStateIcon } from "@/components/organization/EmptyStateIcon";
import { PluginDashboardCard } from "@/components/plugins/PluginDashboardCard";
import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Card,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PlatformDashboardCard } from "@/types";
import { ActivityChart } from "./ActivityChart";
import { AddVolunteerHoursModal } from "./AddVolunteerHoursModal";
import { AllHoursSection } from "./AllHoursSection";
import {
  formatTotalDuration,
  type VolunteerDashboardData,
} from "./dashboard-data";
import { ExportSection } from "./ExportSection";
import { ProgressCircle } from "./ProgressCircle";
import { VolunteerGoals } from "./VolunteerGoals";

/** Page-level line tabs, sized like the organization profile's tab row. */
const PAGE_TAB_CLASS =
  "h-10 flex-none rounded-none px-3 group-data-[orientation=horizontal]/tabs:after:bottom-0";

export function VolunteerDashboardView({
  statistics,
  selfReportedHours,
  upcomingSessions,
  user,
  uiCertificates,
  pluginCards = [],
}: VolunteerDashboardData & { pluginCards?: PlatformDashboardCard[] }) {
  const stats = [
    {
      label: "Verified hours",
      value: formatTotalDuration(statistics.totalHours),
      helper: "Let's Assist verified",
    },
    {
      label: "Self-reported",
      value: `${selfReportedHours}h`,
      helper: "Unverified hours",
    },
    {
      label: "Projects",
      value: statistics.totalProjects,
      helper: "Completed",
    },
    {
      label: "Upcoming",
      value: upcomingSessions.length,
      helper: (
        <Link
          href="/projects"
          aria-label="See all upcoming projects"
          className="hover:text-foreground -my-2.5 inline-flex min-h-9 items-center gap-0.5 transition-colors"
        >
          Sessions
          <ChevronRight className="size-3" aria-hidden="true" />
        </Link>
      ),
    },
  ];

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Volunteer dashboard"
        description="Track your volunteering progress and achievements"
        actions={<AddVolunteerHoursModal />}
      />

      <Tabs defaultValue="overview" className="gap-6">
        <TabsList
          variant="line"
          className="gap-0 border-b p-0 group-data-horizontal/tabs:h-10"
        >
          <TabsTrigger value="overview" className={PAGE_TAB_CLASS}>
            Overview
          </TabsTrigger>
          <TabsTrigger value="hours" className={PAGE_TAB_CLASS}>
            All hours
          </TabsTrigger>
          <TabsTrigger value="export" className={PAGE_TAB_CLASS}>
            Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-6">
          {/* Plugin-contributed organization cards: one full-width strip so a
              single card leaves no dead grid cells and several tile as rows. */}
          {pluginCards.length > 0 && (
            <Card className="gap-0 divide-y py-0">
              {pluginCards.map((card) => (
                <PluginDashboardCard
                  key={`${card.href}-${card.title}`}
                  card={card}
                />
              ))}
            </Card>
          )}

          <div data-tour-id="dashboard-stats">
            <StatStrip items={stats} />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="grid min-w-0 gap-6 lg:col-span-2">
              <ActivityChart data={statistics.recentActivity} />

              <Card>
                <CardHeader>
                  <CardTitle>Organizations</CardTitle>
                  <CardDescription>
                    Formal organizations you&apos;ve volunteered with
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statistics.organizations.length > 0 ? (
                    <ul className="divide-y">
                      {statistics.organizations.map((org, index) => (
                        <li
                          key={index}
                          className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{org.name}</p>
                            <p className="text-muted-foreground text-sm">
                              {org.projects}{" "}
                              {org.projects === 1 ? "project" : "projects"} •{" "}
                              {org.hours.toFixed(1)} hours
                            </p>
                          </div>
                          <ProgressCircle
                            value={(org.hours / statistics.totalHours) * 100}
                            size={40}
                            strokeWidth={4}
                            showLabel={false}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty className="p-6">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <EmptyStateIcon name="users" />
                        </EmptyMedia>
                        <EmptyTitle>No organizations yet</EmptyTitle>
                        <EmptyDescription>
                          When you volunteer with formal organizations,
                          they&apos;ll appear here.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid min-w-0 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Volunteering goals</CardTitle>
                  <CardDescription>
                    Set and track your volunteering targets
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <VolunteerGoals
                    userId={user.id}
                    totalHours={statistics.totalHours}
                    totalEvents={statistics.totalProjects}
                  />
                </CardContent>
              </Card>

              <Card data-tour-id="dashboard-upcoming">
                <CardHeader>
                  <CardTitle>Upcoming sessions</CardTitle>
                  <CardDescription>
                    Your scheduled volunteer commitments
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {upcomingSessions.length > 0 ? (
                    <TooltipProvider>
                      <ul className="-mr-2 max-h-80 divide-y overflow-y-auto pr-2">
                        {upcomingSessions.map((session) => (
                          <li
                            key={session.signupId}
                            className="grid gap-1 py-3 first:pt-0 last:pb-0"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <Link
                                href={`/projects/${session.projectId}`}
                                className="hover:text-primary min-w-0 font-medium transition-colors"
                              >
                                {session.projectTitle}
                              </Link>
                              <Badge
                                variant={
                                  session.status === "approved"
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {session.status === "approved"
                                  ? "Confirmed"
                                  : "Pending"}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground text-sm">
                              Session: {session.sessionDisplayName}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-muted-foreground text-sm">
                                Starts:{" "}
                                {format(
                                  session.sessionStartTime,
                                  "MMM d, yyyy 'at' h:mm a",
                                  { in: tz(session.project_timezone) },
                                )}
                              </p>
                              <Tooltip>
                                <TooltipTrigger className="cursor-default">
                                  <TimezoneBadge
                                    timezone={session.project_timezone}
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">
                                    Times shown in this project&apos;s timezone.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </TooltipProvider>
                  ) : (
                    <Empty className="p-6">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <EmptyStateIcon name="calendar-days" />
                        </EmptyMedia>
                        <EmptyTitle>No upcoming sessions</EmptyTitle>
                        <EmptyDescription>
                          You don&apos;t have any upcoming volunteer commitments
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Link
                          href="/home"
                          className={buttonVariants({ variant: "outline" })}
                        >
                          Browse opportunities
                        </Link>
                      </EmptyContent>
                    </Empty>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="hours" className="grid gap-6">
          <SectionHeader
            title="All volunteer hours"
            description="Both verified and self-reported volunteer hours"
            actions={
              <Badge variant="outline">
                <Award aria-hidden="true" />
                {uiCertificates.length} total certificates
              </Badge>
            }
          />

          <AllHoursSection certificates={uiCertificates} />
        </TabsContent>

        <TabsContent value="export" className="grid gap-6">
          {user.email && (
            <ExportSection
              userEmail={user.email}
              // For the export UI, use uiCertificates where 'platform' == previously 'verified'
              verifiedCount={
                uiCertificates.filter((cert) => cert.type === "platform").length
              }
              unverifiedCount={
                uiCertificates.filter((cert) => cert.type === "self-reported")
                  .length
              }
              totalCertificates={uiCertificates.length}
              certificatesData={uiCertificates}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
