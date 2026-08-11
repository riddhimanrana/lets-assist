import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VolunteerGoals } from "./VolunteerGoals";
import { Badge } from "@/components/ui/badge";
import { ProgressCircle } from "./ProgressCircle";
import { format } from "date-fns";
import { tz } from "@date-fns/tz";
import {
  Award,
  Calendar,
  Users,
  Target,
  ChevronRight,
  Download,
  CalendarDays,
  BarChart3,
  CircleCheck,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ActivityChart } from "./ActivityChart";
import { ExportSection } from "./ExportSection";
import { AllHoursSection } from "./AllHoursSection";
import { AddVolunteerHoursModal } from "./AddVolunteerHoursModal";
import { TimezoneBadge } from "@/components/shared/TimezoneBadge";
import { PluginDashboardCard } from "@/components/plugins/PluginDashboardCard";
import type { PlatformDashboardCard } from "@/types";
import {
  formatTotalDuration,
  type VolunteerDashboardData,
} from "./dashboard-data";

export function VolunteerDashboardView({
  statistics,
  selfReportedHours,
  upcomingSessions,
  user,
  uiCertificates,
  pluginCards = [],
}: VolunteerDashboardData & { pluginCards?: PlatformDashboardCard[] }) {
  return (
    <div className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Volunteer Dashboard
          </h1>
          <p className="text-muted-foreground">
            Track your volunteering progress and achievements
          </p>
        </div>

        <div className="flex items-center gap-3">
          <AddVolunteerHoursModal />
        </div>
      </div>

      {/* Mobile-First Responsive Tabs Layout */}
      <Tabs defaultValue="overview" className="space-y-6">
        {/* Mobile Tab Navigation with Icons */}
        <TabsList className="grid grid-cols-3 w-full sm:flex sm:w-auto h-auto">
          <TabsTrigger value="overview" className="flex items-center ">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs sm:text-sm">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="hours" className="flex items-center">
            <CalendarDays className="h-4 w-4" />
            <span className="text-xs sm:text-sm">All Hours</span>
          </TabsTrigger>
          <TabsTrigger value="export" className="flex items-center ">
            <Download className="h-4 w-4" />
            <span className="text-xs sm:text-sm">Export</span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Plugin-contributed organization cards: one full-width strip so a
              single card leaves no dead grid cells and several tile as rows. */}
          {pluginCards.length > 0 && (
            <div className="divide-y rounded-xl border bg-card">
              {pluginCards.map((card) => (
                <PluginDashboardCard
                  key={`${card.href}-${card.title}`}
                  card={card}
                />
              ))}
            </div>
          )}

          {/* Stats Grid - 2 cols mobile, 4 cols desktop */}
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4"
            data-tour-id="dashboard-stats"
          >
            {/* Total Verified Hours */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-primary/10 w-fit">
                    <CircleCheck className="h-4 w-4 sm:h-6 sm:w-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">
                      Verified Hours
                    </p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">
                      {formatTotalDuration(statistics.totalHours)}
                    </h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      Let&apos;s Assist verified
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Self-Reported Hours */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-warning/10 dark:bg-warning/10 w-fit">
                    <UserCheck className="h-4 w-4 sm:h-6 sm:w-6 text-warning dark:text-warning" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">
                      Self-Reported
                    </p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">
                      {selfReportedHours}h
                    </h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      Unverified hours
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Projects */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-info/10 w-fit">
                    <Users className="h-4 w-4 sm:h-6 sm:w-6 text-info" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">
                      Projects
                    </p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">
                      {statistics.totalProjects}
                    </h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      Completed
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Upcoming Sessions */}
            <Card className="col-span-1">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                  <div className="p-2 sm:p-3 rounded-full bg-success/10 w-fit">
                    <Calendar className="h-4 w-4 sm:h-6 sm:w-6 text-success" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">
                      Upcoming
                    </p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">
                      {upcomingSessions.length}
                    </h2>
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      Sessions
                    </p>
                  </div>
                  <Link
                    href="/projects"
                    aria-label="See all upcoming projects"
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "ml-auto hidden lg:flex",
                    )}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            {/* Left Column - Activity and Organizations */}
            <div className="col-span-1 lg:col-span-2 space-y-6 lg:space-y-8">
              <ActivityChart data={statistics.recentActivity} />

              {/* Organizations */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Organizations</CardTitle>
                  <CardDescription>
                    Formal organizations you&apos;ve volunteered with
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statistics.organizations.length > 0 ? (
                    <div className="space-y-4 sm:space-y-6">
                      {statistics.organizations.map((org, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between gap-4"
                        >
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{org.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {org.projects}{" "}
                              {org.projects === 1 ? "project" : "projects"} •{" "}
                              {org.hours.toFixed(1)} hours
                            </p>
                          </div>
                          <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0">
                            <ProgressCircle
                              value={(org.hours / statistics.totalHours) * 100}
                              size={48}
                              strokeWidth={4}
                              showLabel={false}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center">
                      <Users className="h-8 w-8 sm:h-12 sm:w-12 text-muted-foreground mb-3 sm:mb-4" />
                      <h3 className="font-medium text-base sm:text-lg">
                        No Organizations Yet
                      </h3>
                      <p className="text-muted-foreground max-w-md mt-1 text-sm sm:text-base">
                        When you volunteer with formal organizations,
                        they&apos;ll appear here.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Goals and Upcoming */}
            <div className="space-y-6 lg:space-y-8">
              {/* Enhanced Goals with Date Range */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" /> Volunteering Goals
                  </CardTitle>
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

              {/* Upcoming Sessions */}
              <Card data-tour-id="dashboard-upcoming">
                <CardHeader className="pb-2">
                  <CardTitle>Upcoming Sessions</CardTitle>
                  <CardDescription>
                    Your scheduled volunteer commitments
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {upcomingSessions.length > 0 ? (
                    <TooltipProvider>
                      <div className="space-y-3 sm:space-y-4">
                        <div className="max-h-[300px] sm:max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                          <div className="space-y-3 sm:space-y-4">
                            {upcomingSessions.map((session) => (
                              <div
                                key={session.signupId}
                                className="border rounded-lg p-3 sm:p-4 space-y-2"
                              >
                                <Link
                                  href={`/projects/${session.projectId}`}
                                  className="font-medium hover:text-primary transition-colors block text-sm sm:text-base"
                                >
                                  {session.projectTitle}
                                </Link>
                                <p className="text-xs sm:text-sm text-muted-foreground">
                                  Session: {session.sessionDisplayName}
                                </p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-xs sm:text-sm text-muted-foreground">
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
                                        Times shown in this project&apos;s
                                        timezone.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
                                  Status:{" "}
                                  <Badge
                                    variant={
                                      session.status === "approved"
                                        ? "default"
                                        : "outline"
                                    }
                                  >
                                    {session.status === "approved"
                                      ? "Confirmed"
                                      : "Pending"}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </TooltipProvider>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 sm:py-8 text-center">
                      <Calendar className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground/30 mb-3" />
                      <h3 className="font-medium text-sm sm:text-base">
                        No Upcoming Sessions
                      </h3>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-xs">
                        You don&apos;t have any upcoming volunteer commitments
                      </p>
                      <Link
                        href="/home"
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "mt-3 sm:mt-4",
                        )}
                      >
                        Browse Opportunities
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Unified Hours Tab - Shows both verified and unverified */}
        <TabsContent value="hours" className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">
                All Volunteer Hours
              </h2>
              <p className="text-muted-foreground text-sm sm:text-base">
                Both verified and self-reported volunteer hours
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-2">
                <Award className="h-4 w-4" />
                {uiCertificates.length} Total Certificates
              </Badge>
            </div>
          </div>

          {/* Unified Hours Display */}
          <AllHoursSection certificates={uiCertificates} />
        </TabsContent>

        {/* Export & Reports Tab */}
        <TabsContent value="export" className="space-y-6">
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
