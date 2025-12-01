"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  Clock,
  TrendingUp,
  Zap,
  ArrowRight,
  Award,
  BarChart3,
  FolderKanban,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, Cell, PieChart, Pie, Label } from "recharts";
import { Badge } from "@/components/ui/badge";

interface AdminDashboardClientProps {
  organizationId: string;
  organizationName: string;
  metrics: {
    totalVolunteers: number;
    totalHours: number;
    activeProjects: number;
    pendingVerificationHours: number;
  };
  topVolunteers: Array<{
    id: string;
    name: string;
    avatar: string | null;
    email: string;
    totalHours: number;
    verifiedHours: number;
    eventsAttended: number;
    certificatesEarned: number;
    lastEventDate: Date | null;
  }>;
  projects: Array<{
    id: string;
    title: string;
    status: string;
    visibility: string;
    verificationMethod: string;
    eventType: string;
    location: string | null;
    createdAt: string;
    totalSignups: number;
    approvedSignups: number;
    participationRate: number;
    totalHours: number;
    hoursVerified: number;
    hoursPending: number;
  }>;
}

const hoursChartConfig = {
  verified: {
    label: "Verified",
    color: "hsl(var(--chart-1))",
  },
  pending: {
    label: "Pending",
    color: "hsl(var(--chart-3))",
  },
} satisfies ChartConfig;

const projectStatusChartConfig = {
  upcoming: {
    label: "Upcoming",
    color: "hsl(var(--chart-1))",
  },
  "in-progress": {
    label: "In Progress",
    color: "hsl(var(--chart-2))",
  },
  completed: {
    label: "Completed",
    color: "hsl(var(--chart-3))",
  },
  cancelled: {
    label: "Cancelled",
    color: "hsl(var(--chart-4))",
  },
} satisfies ChartConfig;

export default function AdminDashboardClient({
  organizationId: _organizationId,
  metrics,
  topVolunteers,
  projects,
}: AdminDashboardClientProps) {
  
  // Filter projects with pending hours
  const projectsWithPending = projects
    .filter(p => p.hoursPending > 0)
    .sort((a, b) => b.hoursPending - a.hoursPending);

  // Prepare chart data for hours breakdown
  const hoursData = useMemo(() => [
    { type: "verified", hours: metrics.totalHours, fill: "var(--color-verified)" },
    { type: "pending", hours: metrics.pendingVerificationHours, fill: "var(--color-pending)" },
  ], [metrics.totalHours, metrics.pendingVerificationHours]);

  // Prepare project status distribution
  const projectStatusData = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    projects.forEach(p => {
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
    });
    return Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
      fill: `var(--color-${status})`,
    }));
  }, [projects]);

  // Top projects by hours
  const topProjectsByHours = useMemo(() => {
    return [...projects]
      .sort((a, b) => b.totalHours - a.totalHours)
      .slice(0, 5)
      .map(p => ({
        name: p.title.length > 20 ? p.title.substring(0, 20) + "..." : p.title,
        hours: p.totalHours,
        verified: p.hoursVerified,
        pending: p.hoursPending,
      }));
  }, [projects]);

  const totalAllHours = metrics.totalHours + metrics.pendingVerificationHours;

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard 
          title="Total Volunteers" 
          value={metrics.totalVolunteers} 
          icon={Users} 
          description="Unique volunteers"
          color="text-blue-500"
          bgColor="bg-blue-500/10"
        />
        <MetricCard 
          title="Verified Hours" 
          value={metrics.totalHours.toFixed(1)} 
          icon={Clock} 
          description="Approved hours"
          color="text-green-500"
          bgColor="bg-green-500/10"
        />
        <MetricCard 
          title="Active Projects" 
          value={metrics.activeProjects} 
          icon={TrendingUp} 
          description="In progress"
          color="text-purple-500"
          bgColor="bg-purple-500/10"
        />
        <MetricCard 
          title="Pending Hours" 
          value={metrics.pendingVerificationHours.toFixed(1)} 
          icon={Zap} 
          description="Needs review"
          color="text-orange-500"
          bgColor="bg-orange-500/10"
          highlight={metrics.pendingVerificationHours > 0}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hours Breakdown Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Hours Breakdown
            </CardTitle>
            <CardDescription>Verified vs pending hours</CardDescription>
          </CardHeader>
          <CardContent>
            {totalAllHours === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                No hours recorded yet
              </div>
            ) : (
              <ChartContainer config={hoursChartConfig} className="mx-auto aspect-square h-[200px]">
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={hoursData}
                    dataKey="hours"
                    nameKey="type"
                    innerRadius={50}
                    strokeWidth={5}
                  >
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          return (
                            <text
                              x={viewBox.cx}
                              y={viewBox.cy}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              <tspan
                                x={viewBox.cx}
                                y={viewBox.cy}
                                className="fill-foreground text-2xl font-bold"
                              >
                                {totalAllHours.toFixed(0)}
                              </tspan>
                              <tspan
                                x={viewBox.cx}
                                y={(viewBox.cy || 0) + 20}
                                className="fill-muted-foreground text-xs"
                              >
                                Total Hours
                              </tspan>
                            </text>
                          );
                        }
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
            <div className="flex justify-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[hsl(var(--chart-1))]" />
                <span className="text-xs text-muted-foreground">Verified ({metrics.totalHours.toFixed(1)}h)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[hsl(var(--chart-3))]" />
                <span className="text-xs text-muted-foreground">Pending ({metrics.pendingVerificationHours.toFixed(1)}h)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Project Status Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              Project Status
            </CardTitle>
            <CardDescription>{projects.length} total projects</CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                No projects yet
              </div>
            ) : (
              <>
                <ChartContainer config={projectStatusChartConfig} className="h-[200px]">
                  <BarChart data={projectStatusData} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <YAxis
                      dataKey="status"
                      type="category"
                      tickLine={false}
                      tickMargin={10}
                      axisLine={false}
                      width={80}
                      tickFormatter={(value) => {
                        const label = projectStatusChartConfig[value as keyof typeof projectStatusChartConfig]?.label;
                        return label || value;
                      }}
                    />
                    <XAxis type="number" hide />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent hideLabel />}
                    />
                    <Bar dataKey="count" radius={4}>
                      {projectStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Projects by Hours Bar Chart */}
      {topProjectsByHours.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Projects by Hours</CardTitle>
            <CardDescription>Projects with the most volunteer hours</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={hoursChartConfig} className="h-[200px] w-full">
              <BarChart data={topProjectsByHours} margin={{ left: 0, right: 16 }}>
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis hide />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent />}
                />
                <Bar dataKey="verified" stackId="a" fill="var(--color-verified)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="pending" stackId="a" fill="var(--color-pending)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Volunteers Column */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-4 w-4 text-yellow-500" />
                Top Volunteers
              </CardTitle>
              <CardDescription>Most active volunteers by hours</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topVolunteers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No volunteer activity yet.
                  </div>
                ) : (
                  topVolunteers.slice(0, 5).map((volunteer, idx) => (
                    <div
                      key={volunteer.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex items-center justify-center w-7 h-7 rounded-full font-bold text-xs",
                          idx === 0 && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
                          idx === 1 && "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
                          idx === 2 && "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
                          idx > 2 && "bg-muted text-muted-foreground"
                        )}>
                          {idx + 1}
                        </div>
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={volunteer.avatar || undefined} />
                          <AvatarFallback className="text-xs">
                            {volunteer.name?.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{volunteer.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {volunteer.eventsAttended} events · {volunteer.certificatesEarned} certs
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm">{volunteer.totalHours.toFixed(1)}</p>
                        <p className="text-xs text-muted-foreground">hours</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Items Column */}
        <div>
          <Card className={cn(projectsWithPending.length > 0 && "border-orange-200 dark:border-orange-800")}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-500" />
                Needs Action
                {projectsWithPending.length > 0 && (
                  <Badge variant="secondary" className="ml-auto bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                    {projectsWithPending.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>Projects with hours to verify</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {projectsWithPending.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    All hours verified! 🎉
                  </div>
                ) : (
                  projectsWithPending.slice(0, 5).map(project => (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div className="group flex items-center justify-between p-2.5 rounded-lg border hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-all cursor-pointer">
                        <div className="overflow-hidden flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{project.title}</p>
                          <p className="text-xs text-orange-600 dark:text-orange-400">
                            {project.hoursPending.toFixed(1)}h pending
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-orange-500 transition-colors flex-shrink-0 ml-2" />
                      </div>
                    </Link>
                  ))
                )}
                {projectsWithPending.length > 5 && (
                  <Button variant="ghost" className="w-full text-xs mt-2" size="sm">
                    View all {projectsWithPending.length} projects
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, description, color, bgColor, highlight }: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description: string;
  color: string;
  bgColor: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(
      "overflow-hidden transition-all",
      highlight && "ring-2 ring-orange-500/50 shadow-sm"
    )}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <div className="text-xl sm:text-2xl font-bold">{value}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{description}</p>
          </div>
          <div className={cn("p-2 rounded-lg", bgColor)}>
            <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", color)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
