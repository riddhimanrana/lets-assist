"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Bot, Inbox } from "lucide-react";

import { ArrowRightIcon, useAnimatedIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  parseReportDescription,
  type ReportMetadataKey,
} from "@/lib/moderation/report-description";
import { cn } from "@/lib/utils";

import { AdminPage } from "./AdminPage";
import { humanize, levelTone } from "./admin-status";

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
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

const REPORT_DETAIL_LABELS: Array<{ key: ReportMetadataKey; label: string }> = [
  { key: "contentTitle", label: "Content" },
  { key: "contentCreator", label: "Creator" },
  { key: "contentUrl", label: "Page" },
  { key: "context", label: "Context" },
];

/** The reporter's notes, then the server-composed details as labelled rows. */
function ReportDetails({ description }: { description: string }) {
  const { notes, metadata } = parseReportDescription(description);
  const details = REPORT_DETAIL_LABELS.filter(({ key }) => metadata[key]);

  return (
    <>
      {notes && (
        <p className="text-muted-foreground line-clamp-2 text-sm">{notes}</p>
      )}
      {details.length > 0 && (
        <dl className="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          {details.map(({ key, label }) => (
            <div key={key} className="col-span-2 grid grid-cols-subgrid">
              <dt>{label}</dt>
              <dd className="text-foreground truncate">{metadata[key]}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/** A headline count that also takes you to the screen that clears it. */
function StatLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="hover:text-foreground -my-2.5 inline-block py-2.5 underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

function QueueLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant: "ghost" }), "-my-1.5")}
    >
      {children}
    </Link>
  );
}

export function OverviewTab({
  stats,
  flaggedContent,
  reportPreview,
  reportsStats,
}: OverviewTabProps) {
  const reviewIcon = useAnimatedIcon();
  const data = [
    {
      name: "Feedback",
      total: stats.feedbackCount,
      fill: "var(--color-total)",
    },
    {
      name: "Trusted apps",
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

  const reportsHealth = [
    {
      label: "Total reports",
      helper: `+${reportsStats.recentWeek} this week`,
      value: reportsStats.total,
    },
    {
      label: "High priority",
      helper: "Needs quick triage",
      value: reportsStats.highPriority,
    },
    {
      label: "Pending",
      helper: "Awaiting reviewer",
      value: reportsStats.pending,
    },
    {
      label: "Resolved",
      helper: "Closed this cycle",
      value: reportsStats.resolved,
    },
  ];

  return (
    <AdminPage>
      <PageHeader
        title="Admin overview"
        description="Platform activity and pending actions across feedback, trusted members, and moderation."
        actions={
          <Link
            href="/admin/moderation"
            className={buttonVariants()}
            {...reviewIcon.triggerProps}
          >
            Review moderation queue
            <ArrowRightIcon
              ref={reviewIcon.ref}
              size={16}
              aria-hidden="true"
              data-icon="inline-end"
            />
          </Link>
        }
      />

      <StatStrip
        items={[
          {
            label: (
              <StatLink href="/admin/trusted-members">
                Trusted applications
              </StatLink>
            ),
            value: stats.trustedPendingCount,
            helper: "Pending review",
          },
          {
            label: <StatLink href="/admin/feedback">User feedback</StatLink>,
            value: stats.feedbackCount,
            helper: "Total submissions",
          },
          {
            label: (
              <StatLink href="/admin/moderation">Flagged content</StatLink>
            ),
            value: stats.flaggedPendingCount,
            helper: "AI & system flags",
          },
          {
            label: <StatLink href="/admin/moderation">User reports</StatLink>,
            value: stats.reportsPendingCount,
            helper: "User submitted reports",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Activity overview</CardTitle>
            <CardDescription>
              Current pending items across all categories.
            </CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-56 w-full"
            >
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => value.slice(0, 12)}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="total"
                  fill="var(--color-total)"
                  radius={4}
                  maxBarSize={56}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Reports health</CardTitle>
            <CardDescription>
              Week-over-week activity across the moderation queue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              {reportsHealth.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <dt className="text-sm">{row.label}</dt>
                    <dd className="text-muted-foreground text-xs">
                      {row.helper}
                    </dd>
                  </div>
                  <dd className="text-lg font-semibold tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI flag queue</CardTitle>
            <CardDescription>
              Latest items surfaced by automated scans.
            </CardDescription>
            <CardAction>
              <QueueLink href="/admin/moderation">View all</QueueLink>
            </CardAction>
          </CardHeader>
          <CardContent>
            {topFlags.length === 0 ? (
              <Empty className="p-6">
                <EmptyHeader>
                  <EmptyMedia>
                    <Bot
                      className="text-muted-foreground size-5"
                      aria-hidden="true"
                    />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">All caught up</EmptyTitle>
                  <EmptyDescription>
                    No AI flags awaiting review.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="divide-y">
                {topFlags.map((flag) => (
                  <li
                    key={flag.id}
                    className="grid gap-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <Badge variant={levelTone(flag.severity)}>
                        {humanize(flag.flag_type || flag.severity, "Flag")}
                      </Badge>
                      <span>Confidence {formatConfidence(flag)}%</span>
                      {flag.created_at && (
                        <span className="ml-auto">
                          {formatShortDate(flag.created_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium">
                      {flag.flag_reason ||
                        flag.reason ||
                        "Content requires attention"}
                    </p>
                    {flag.flagged_text_snippet && (
                      <p className="text-muted-foreground line-clamp-2 text-xs">
                        “{flag.flagged_text_snippet}”
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Report inbox</CardTitle>
            <CardDescription>Highest-signal community reports.</CardDescription>
            <CardAction>
              <QueueLink href="/admin/moderation">Go to reports</QueueLink>
            </CardAction>
          </CardHeader>
          <CardContent>
            {topReports.length === 0 ? (
              <Empty className="p-6">
                <EmptyHeader>
                  <EmptyMedia>
                    <Inbox
                      className="text-muted-foreground size-5"
                      aria-hidden="true"
                    />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">No user reports</EmptyTitle>
                  <EmptyDescription>
                    The queue is empty right now.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="divide-y">
                {topReports.map((report) => (
                  <li
                    key={report.id}
                    className="grid gap-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <Badge variant={levelTone(report.priority)}>
                        {formatPriority(report.priority)}
                      </Badge>
                      <span className="text-sm font-medium">
                        {humanize(report.reason, "Report")}
                      </span>
                      {report.created_at && (
                        <span className="text-muted-foreground ml-auto">
                          {formatShortDate(report.created_at)}
                        </span>
                      )}
                    </div>
                    {report.description && (
                      <ReportDetails description={report.description} />
                    )}
                    {report.ai_metadata?.verdict && (
                      <p className="text-muted-foreground text-xs">
                        AI verdict:{" "}
                        <span className="text-foreground font-medium">
                          {report.ai_metadata.verdict}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminPage>
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

function formatShortDate(value?: string) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}
