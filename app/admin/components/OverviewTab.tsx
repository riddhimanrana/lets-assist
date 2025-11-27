"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Users, MessageSquare, ShieldAlert, Activity, Bot, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface OverviewTabProps {
  stats: {
    feedbackCount: number;
    trustedPendingCount: number;
    flaggedPendingCount: number;
    reportsPendingCount: number;
  };
  flaggedContent: FlaggedContent[];
  reportPreview: ModerationReport[];
  reportsStats: ReportsStats;
}

type FlaggedContent = {
  id: string;
  flag_type?: string;
  severity?: string;
  confidence_score?: number;
  ai_confidence_score?: number;
  flag_reason?: string;
  reason?: string;
  flagged_text_snippet?: string;
  created_at?: string;
};

type ModerationReport = {
  id: string;
  reason: string;
  priority?: string | null;
  status?: string | null;
  description?: string | null;
  created_at?: string;
  ai_metadata?: {
    verdict?: string;
    priority?: string;
    suggestedStatus?: string;
    triagedAt?: string;
  } | null;
};

type ReportsStats = {
  total: number;
  pending: number;
  resolved: number;
  highPriority: number;
  recentWeek: number;
};

const chartConfig = {
  total: {
    label: "Total",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

export function OverviewTab({ stats, flaggedContent, reportPreview, reportsStats }: OverviewTabProps) {
  const data = [
    {
      name: "Feedback",
      total: stats.feedbackCount,
      fill: "var(--color-total)",
    },
    {
      name: "Trusted Apps",
      total: stats.trustedPendingCount,
      fill: "var(--color-total)",
    },
    {
      name: "Flagged",
      total: stats.flaggedPendingCount,
      fill: "var(--color-total)",
    },
    {
      name: "Reports",
      total: stats.reportsPendingCount,
      fill: "var(--color-total)",
    },
  ];

  const topFlags = flaggedContent.slice(0, 3);
  const topReports = reportPreview.slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/trusted-members">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Trusted Applications</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.trustedPendingCount}</div>
              <p className="text-xs text-muted-foreground">Pending review</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/feedback">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">User Feedback</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.feedbackCount}</div>
              <p className="text-xs text-muted-foreground">Total submissions</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/moderation">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Flagged Content</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.flaggedPendingCount}</div>
              <p className="text-xs text-muted-foreground">AI & System flags</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/moderation">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">User Reports</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.reportsPendingCount}</div>
              <p className="text-xs text-muted-foreground">User submitted reports</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Activity Overview</CardTitle>
            <CardDescription>
              Current pending items across all categories.
            </CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => value.slice(0, 10)}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Reports Health</CardTitle>
            <p className="text-sm text-muted-foreground">
              Week-over-week activity across the moderation queue.
            </p>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Total reports</dt>
                <dd className="text-2xl font-semibold">{reportsStats.total}</dd>
                <p className="text-xs text-muted-foreground">+{reportsStats.recentWeek} this week</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">High priority</dt>
                <dd className="text-2xl font-semibold">{reportsStats.highPriority}</dd>
                <p className="text-xs text-muted-foreground">Needs quick triage</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Pending</dt>
                <dd className="text-2xl font-semibold">{reportsStats.pending}</dd>
                <p className="text-xs text-muted-foreground">Awaiting reviewer</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Resolved</dt>
                <dd className="text-2xl font-semibold">{reportsStats.resolved}</dd>
                <p className="text-xs text-muted-foreground">Closed this cycle</p>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-full">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>AI Flag Queue</CardTitle>
              <CardDescription>Latest items surfaced by automated scans.</CardDescription>
            </div>
            <Badge variant="outline" className="gap-1 text-xs">
              <Bot className="h-3 w-3" />
              Auto
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {topFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">All caught up—no AI flags awaiting review.</p>
            ) : (
              topFlags.map((flag) => (
                <div key={flag.id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Badge variant={getSeverityVariant(flag.severity)} className="uppercase">
                        {flag.flag_type || flag.severity || "Flag"}
                      </Badge>
                      <span>Confidence {formatConfidence(flag)}%</span>
                    </div>
                    {flag.created_at && (
                      <span>{formatShortDate(flag.created_at)}</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium">
                    {flag.flag_reason || flag.reason || "Content requires attention"}
                  </p>
                  {flag.flagged_text_snippet && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      “{flag.flagged_text_snippet}”
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
          <CardFooter>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link href="/admin/moderation">
                Review flags
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardFooter>
        </Card>

        <Card className="h-full">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Report Inbox</CardTitle>
              <CardDescription>Highest-signal community reports.</CardDescription>
            </div>
            <Badge variant="secondary" className="gap-1 text-xs">
              <AlertTriangle className="h-3 w-3" />
              Queue
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {topReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No user reports in the queue right now.</p>
            ) : (
              topReports.map((report) => (
                <div key={report.id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={getPriorityVariant(report.priority)}>
                      {formatPriority(report.priority)}
                    </Badge>
                    <span className="text-muted-foreground">{report.reason}</span>
                    {report.created_at && (
                      <span className="ml-auto text-muted-foreground">{formatShortDate(report.created_at)}</span>
                    )}
                  </div>
                  {report.description && (
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                      {report.description}
                    </p>
                  )}
                  {report.ai_metadata?.verdict && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      AI verdict: <span className="font-medium text-foreground">{report.ai_metadata.verdict}</span>
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
          <CardFooter>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link href="/admin/moderation">
                Go to reports
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function formatConfidence(flag: FlaggedContent) {
  const value = flag.ai_confidence_score ?? flag.confidence_score ?? 0;
  const normalized = value > 1 ? value : value * 100;
  return Math.round(Math.min(Math.max(normalized, 0), 100));
}

function formatPriority(priority?: string | null) {
  if (!priority) return "Normal";
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function getPriorityVariant(priority?: string | null): "destructive" | "secondary" | "outline" {
  if (priority === "high" || priority === "critical") return "destructive";
  if (priority === "low") return "outline";
  return "secondary";
}

function getSeverityVariant(severity?: string): "destructive" | "secondary" | "outline" {
  if (!severity) return "outline";
  if (severity === "critical" || severity === "high") return "destructive";
  return "secondary";
}

function formatShortDate(value?: string) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
  } catch {
    return "";
  }
}
