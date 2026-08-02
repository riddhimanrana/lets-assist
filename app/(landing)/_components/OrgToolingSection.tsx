"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import type { MouseEvent } from "react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  AlertTriangle,
  BarChart3,
  Check,
  Clock,
  FileSpreadsheet,
  Globe,
  Plug,
  Puzzle,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  TrendingUp,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import OrganizationHeader from "@/components/organization/OrganizationHeader";
import OrganizationTabs from "@/components/organization/OrganizationTabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldLabel, FieldTitle } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OrganizationTabBehavior, Project } from "@/types";
import { getProjectStatus } from "@/utils/project";
import { AnimatedText } from "./AnimatedText";

const orgFeatures = [
  {
    icon: FileSpreadsheet,
    title: "Google Sheets + Calendar syncing",
    desc: "Keep member hours, project summaries, volunteer slots, and shared calendar reminders connected to the tools your team already uses.",
    logos: [
      { src: "/resources/google-sheets-logo-2026.png", alt: "Google Sheets" },
      { src: "/resources/google-calendar-logo-2026.png", alt: "Google Calendar" },
    ],
  },
  {
    icon: Plug,
    title: "Custom plugins",
    desc: "Connect membership rules, school workflows, imports, approvals, paid events, and private operational tools.",
  },
  {
    icon: BarChart3,
    title: "Analytics dashboards",
    desc: "See verified hours, member progress, project turnout, exports, and CSF-ready reporting from one dashboard.",
  },
];

const analyticsBars = [
  { month: "Feb", verified: 42, pending: 10 },
  { month: "Mar", verified: 58, pending: 14 },
  { month: "Apr", verified: 84, pending: 20 },
  { month: "May", verified: 72, pending: 12 },
  { month: "Jun", verified: 96, pending: 18 },
  { month: "Jul", verified: 118, pending: 16 },
];

const organizationChartConfig = {
  verified: {
    label: "Verified hours",
    color: "var(--primary)",
  },
  pending: {
    label: "Open reviews",
    color: "var(--info)",
  },
} satisfies ChartConfig;

const activeVolunteerTrend = [
  { month: "Feb", volunteers: 94 },
  { month: "Mar", volunteers: 101 },
  { month: "Apr", volunteers: 107 },
  { month: "May", volunteers: 112 },
  { month: "Jun", volunteers: 121 },
  { month: "Jul", volunteers: 126 },
];

const activeVolunteerChartConfig = {
  volunteers: {
    label: "Active volunteers",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

const engagementTrend = [
  { month: "Feb", views: 246, signups: 58, checkIns: 41 },
  { month: "Mar", views: 302, signups: 71, checkIns: 55 },
  { month: "Apr", views: 365, signups: 88, checkIns: 67 },
  { month: "May", views: 441, signups: 96, checkIns: 82 },
  { month: "Jun", views: 498, signups: 109, checkIns: 91 },
  { month: "Jul", views: 542, signups: 118, checkIns: 103 },
];

const engagementChartConfig = {
  views: {
    label: "Event views",
    color: "var(--primary)",
  },
  signups: {
    label: "Signups",
    color: "var(--info)",
  },
  checkIns: {
    label: "Check-ins",
    color: "var(--success)",
  },
} satisfies ChartConfig;

const reportMetricCards = [
  { label: "Event views", value: "3.4k", helper: "+22% this month", icon: Globe, color: "text-primary" },
  { label: "Engagement", value: "63%", helper: "Views to signup conversion", icon: TrendingUp, color: "text-info" },
  { label: "Certificates", value: "387", helper: "Issued this season", icon: FileSpreadsheet, color: "text-success" },
];

const topVolunteersThisMonth = [
  { name: "Maya Chen", hours: "42.5h", projects: "8 projects" },
  { name: "Noah Patel", hours: "37.0h", projects: "7 projects" },
  { name: "Priya Shah", hours: "31.5h", projects: "6 projects" },
];

type DemoMemberHours = {
  totalHours: number;
  eventCount: number;
  lastEventDate: string;
};

type DemoMemberEvent = {
  id: string;
  projectTitle: string;
  eventDate: string;
  hours: number;
  isCertified: boolean;
  organizationName: string;
};

function OrganizationAnalyticsDemo() {
  const summary = demoReportSummary;
  const summaryCards = [
    { label: "Verified hours", value: summary.totalHours.toFixed(1), change: "+18% vs last month", icon: Clock },
    { label: "Active volunteers", value: mockMembers.length.toLocaleString(), change: "+14% MoM", icon: Users },
    { label: "Projects in last 6 months", value: summary.totalProjects.toLocaleString(), change: "+11 this quarter", icon: FileSpreadsheet },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((metric) => (
          <Card key={metric.label} className="border-border/60 bg-background/95 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{metric.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.change}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <metric.icon className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <Card className="overflow-hidden border-border/60 bg-background/95 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              Reports overview
            </CardTitle>
            <CardDescription>
              Verified hours, open reviews, and export activity rendered with the app reporting palette.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={organizationChartConfig} className="h-64 w-full">
              <BarChart accessibilityLayer data={analyticsBars} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tick={{ fontSize: 11 }}
                />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="verified" fill="var(--color-verified)" radius={[5, 5, 0, 0]} />
                <Bar dataKey="pending" fill="var(--color-pending)" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/60 bg-background/95 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" />
              Active volunteers
            </CardTitle>
            <CardDescription>
              Month-over-month momentum and the top contributors this month.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-3xl font-semibold tracking-tight">{summaryCards[1].value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{summaryCards[1].change}</p>
              </div>
              <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Activity className="mr-1 inline-block h-3.5 w-3.5" />
                Healthy growth
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground">Top 3 volunteers this month</p>
              {topVolunteersThisMonth.map((volunteer, index) => (
                <div key={volunteer.name} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium">{volunteer.name}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">{volunteer.hours}</p>
                    <p className="text-xs text-muted-foreground">{volunteer.projects}</p>
                  </div>
                </div>
              ))}
            </div>
            <ChartContainer config={activeVolunteerChartConfig} className="h-16 w-full aspect-auto">
              <LineChart accessibilityLayer data={activeVolunteerTrend} margin={{ left: 0, right: 0, top: 5, bottom: 0 }}>
                <XAxis dataKey="month" hide />
                <YAxis hide />
                <Line
                  type="monotone"
                  dataKey="volunteers"
                  stroke="var(--color-volunteers)"
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {reportMetricCards.map((metric) => (
          <Card key={metric.label} className="border-border/60 bg-background/95 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{metric.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{metric.helper}</p>
                </div>
                <metric.icon className={`h-4 w-4 ${metric.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden border-border/60 bg-background/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            Sync destinations
          </CardTitle>
          <CardDescription>
            Live-style destinations for the custom syncing UI.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-background shadow-sm">
                  <Image
                    src="/resources/google-sheets-logo-2026.png"
                    alt="Google Sheets"
                    width={28}
                    height={28}
                    className="size-7 object-contain"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold">Google Sheets</p>
                  <p className="text-xs text-muted-foreground">Member hours + project exports</p>
                </div>
              </div>
              <Badge variant="secondary" className="bg-success/10 text-success">
                Syncing
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-background/70 p-3">
                <p className="text-muted-foreground">Last sync</p>
                <p className="mt-1 font-medium">2 min ago</p>
              </div>
              <div className="rounded-lg bg-background/70 p-3">
                <p className="text-muted-foreground">Rows updated</p>
                <p className="mt-1 font-medium">148</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-background shadow-sm">
                  <Image
                    src="/resources/google-calendar-logo-2026.png"
                    alt="Google Calendar"
                    width={28}
                    height={28}
                    className="size-7 object-contain"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold">Google Calendar</p>
                  <p className="text-xs text-muted-foreground">Volunteer shifts + reminders</p>
                </div>
              </div>
              <Badge variant="secondary" className="bg-info/10 text-info">
                Syncing
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-background/70 p-3">
                <p className="text-muted-foreground">Upcoming events</p>
                <p className="mt-1 font-medium">18 synced</p>
              </div>
              <div className="rounded-lg bg-background/70 p-3">
                <p className="text-muted-foreground">Next refresh</p>
                <p className="mt-1 font-medium">in 9 min</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/60 bg-background/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Engagement analytics
          </CardTitle>
          <CardDescription>
            Pulling event impressions, signups, and check-ins into one view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={engagementChartConfig} className="h-64 w-full">
            <LineChart accessibilityLayer data={engagementTrend} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                tick={{ fontSize: 11 }}
              />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="views" stroke="var(--color-views)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="signups" stroke="var(--color-signups)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="checkIns" stroke="var(--color-checkIns)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}

const mockOrganization = {
  id: "org_sanramon_1",
  name: "San Ramon City Alliance",
  username: "sanramon",
  type: "nonprofit",
  website: "https://sanramon.ca.gov/",
  verified: true,
  logo_url: "/logos/sanramon.jpg",
  description:
    "A community coalition connecting residents, schools, and local nonprofits to improve San Ramon through service and events. Note that this is a mock and is not affiliated with the actual City of San Ramon.",
  created_at: "2025-01-01T00:00:00.000Z",
};

type OrganizationMember = {
  id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
  user_id: string;
  organization_id: string;
  profiles: {
    id: string;
    username: string;
    full_name: string;
    avatar_url: string | null;
  };
};

const memberSeeds = [
  ["Riddhiman", "Rana"],
  ["Maya", "Chen"],
  ["Liam", "O'Connor"],
  ["Avery", "Nguyen"],
  ["Noah", "Patel"],
  ["Sofia", "Martinez"],
  ["Ethan", "Kim"],
  ["Aria", "Singh"],
  ["Mateo", "Garcia"],
  ["Zoe", "Hughes"],
  ["Julian", "Bennett"],
  ["Priya", "Shah"],
  ["Amir", "Hassan"],
  ["Leah", "Carter"],
  ["Caleb", "Wright"],
  ["Nora", "Diaz"],
  ["Owen", "Brooks"],
  ["Mina", "Park"],
  ["Elena", "Flores"],
  ["Jonah", "Baker"],
  ["Iris", "Young"],
  ["Theo", "Ramirez"],
  ["Anika", "Desai"],
  ["Miles", "Foster"],
] as const;

const mockMembers: OrganizationMember[] = Array.from({ length: 147 }, (_, index) => {
  const [firstName, lastName] = memberSeeds[index % memberSeeds.length];
  const sequence = Math.floor(index / memberSeeds.length) + 1;
  const name = sequence === 1 ? `${firstName} ${lastName}` : `${firstName} ${lastName} ${sequence}`;
  const role: OrganizationMember["role"] = index === 0 ? "admin" : index < 8 ? "staff" : "member";
  const month = String((index % 12) + 1).padStart(2, "0");
  const day = String(((index * 3) % 27) + 1).padStart(2, "0");

  return {
    id: `m-${index + 1}`,
    role,
    joined_at: `2025-${month}-${day}T00:00:00.000Z`,
    user_id: `u-${index + 1}`,
    organization_id: "org_sanramon_1",
    profiles: {
      id: `u-${index + 1}`,
      username: name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, ""),
      full_name: name,
      avatar_url: null,
    },
  };
});

function oneTime(dateISO: string, start: string, end: string) {
  const date = dateISO.slice(0, 10);
  return { oneTime: { date, startTime: start, endTime: end, volunteers: 20 } };
}

const mockProfile = {
  full_name: "Riddhiman Rana",
  email: "hello@lets-assist.com",
  avatar_url: null,
  username: "riddhiman",
  created_at: "2025-01-01T00:00:00.000Z",
};

const projectSeeds = [
  {
    id: "#p1",
    title: "Downtown Summer Market Support",
    description: "Volunteer greeters, wayfinding, and vendor support for the city market.",
    location: "San Ramon City Center",
    dateISO: "2026-07-19T00:00:00.000Z",
    status: "upcoming" as const,
    creatorId: "u-1",
    start: "09:00",
    end: "12:00",
  },
  {
    id: "#p2",
    title: "Community Data Cleanup",
    description: "A city records cleanup and intake shift that was paused before launch.",
    location: "City Hall Annex",
    dateISO: "2026-07-11T00:00:00.000Z",
    status: "cancelled" as const,
    creatorId: "u-2",
    start: "11:00",
    end: "13:00",
  },
  {
    id: "#p3",
    title: "Library Homework Help Night",
    description: "Plant trees to expand shaded spaces in the park.",
    location: "San Ramon Library",
    dateISO: "2026-06-28T00:00:00.000Z",
    status: "completed" as const,
    creatorId: "u-3",
    start: "08:00",
    end: "10:00",
  },
  {
    id: "#p4",
    title: "Senior Tech Support Clinic",
    description: "Help residents set up devices, email, and online forms.",
    location: "Community Center Annex",
    dateISO: "2026-06-18T00:00:00.000Z",
    status: "completed" as const,
    creatorId: "u-4",
    start: "16:00",
    end: "18:30",
  },
  {
    id: "#p5",
    title: "Bollinger Canyon Creek Cleanup",
    description: "A community creek cleanup to protect local trails and wildlife.",
    location: "Bollinger Canyon Trailhead",
    dateISO: "2026-05-30T00:00:00.000Z",
    status: "completed" as const,
    creatorId: "u-5",
    start: "10:00",
    end: "12:00",
  },
  {
    id: "#p6",
    title: "City Park Tree Planting",
    description: "Plant trees to expand shaded spaces in the park.",
    location: "San Ramon Central Park",
    dateISO: "2026-07-26T00:00:00.000Z",
    status: "upcoming" as const,
    creatorId: "u-6",
    start: "09:30",
    end: "12:30",
  },
  {
    id: "#p7",
    title: "Food Pantry Sorting Shift",
    description: "Sort canned goods and assemble weekend food boxes.",
    location: "Tri-Valley Food Pantry",
    dateISO: "2026-05-19T00:00:00.000Z",
    status: "completed" as const,
    creatorId: "u-7",
    start: "12:00",
    end: "17:00",
  },
  {
    id: "#p8",
    title: "Neighborhood Cleanup Sprint",
    description: "A quick park and trail cleanup for the summer series.",
    location: "Windemere Trails",
    dateISO: "2026-04-21T00:00:00.000Z",
    status: "cancelled" as const,
    creatorId: "u-8",
    start: "14:00",
    end: "16:30",
  },
  {
    id: "#p9",
    title: "Trail Stewardship Walk",
    description: "Remove litter and document trail wear for the parks team.",
    location: "Las Trampas Trailhead",
    dateISO: "2026-03-23T00:00:00.000Z",
    status: "completed" as const,
    creatorId: "u-9",
    start: "07:30",
    end: "10:00",
  },
  {
    id: "#p10",
    title: "Thanksgiving Meal Packing",
    description: "Pack donated groceries and holiday meal kits.",
    location: "Community Resource Hub",
    dateISO: "2026-07-14T00:00:00.000Z",
    status: "upcoming" as const,
    creatorId: "u-10",
    start: "13:00",
    end: "16:00",
  },
  {
    id: "#p11",
    title: "Youth Mentorship Mixer",
    description: "Welcome students, mentors, and families to the fall kickoff.",
    location: "Bishop Ranch Conference Center",
    dateISO: "2026-06-07T00:00:00.000Z",
    status: "completed" as const,
    creatorId: "u-11",
    start: "18:00",
    end: "20:00",
  },
  {
    id: "#p12",
    title: "River Restoration Survey",
    description: "Map invasive plants and report areas that need cleanup.",
    location: "Bollinger Creek Preserve",
    dateISO: "2026-08-02T00:00:00.000Z",
    status: "upcoming" as const,
    creatorId: "u-12",
    start: "08:00",
    end: "11:00",
  },
] as const;

const mockProjects: Project[] = projectSeeds.map((project, index) => ({
  id: project.id,
  title: project.title,
  description: project.description,
  location: project.location,
  created_at: project.dateISO,
  event_type: "oneTime",
  schedule: oneTime(project.dateISO, project.start, project.end),
  status: project.status,
  visibility: "public",
  creator_id: project.creatorId,
  verification_method: "manual",
  require_login: true,
  pause_signups: false,
  profiles: mockProfile,
  organization_id: "org_sanramon_1",
  created_by_role: index < 2 ? "admin" : "staff",
}));

const nonCancelledProjects = mockProjects.filter((project) => getProjectStatus(project) !== "cancelled");
const projectDates = nonCancelledProjects.map((project) => project.created_at);

const demoMemberHourEntries = mockMembers.map((member, index) => {
  const projectOffset = index % nonCancelledProjects.length;
  const eventCount = 2 + (index % 4);
  const events: DemoMemberEvent[] = Array.from({ length: eventCount }, (_, eventIndex) => {
    const project = nonCancelledProjects[(projectOffset + eventIndex) % nonCancelledProjects.length];
    const projectDate = projectDates[(projectOffset + eventIndex) % projectDates.length];
    const hours = 1 + ((index + eventIndex) % 4) * 0.5;

    return {
      id: `cert-${member.user_id}-${eventIndex + 1}`,
      projectTitle: project.title,
      eventDate: projectDate,
      hours,
      isCertified: eventIndex % 3 !== 0 || project.status === "completed",
      organizationName: "San Ramon City Alliance",
    };
  });

  const totalHours = events.reduce((sum, event) => sum + event.hours, 0);
  const lastEventDate = events[0]?.eventDate ?? "2026-01-01T00:00:00.000Z";

  return [
    member.user_id,
    {
      totalHours,
      eventCount: events.length,
      lastEventDate,
    } satisfies DemoMemberHours,
  ] as const;
});

const demoMemberHours = Object.fromEntries(demoMemberHourEntries) as Record<string, DemoMemberHours>;

const demoMemberDetails = Object.fromEntries(
  demoMemberHourEntries.map(([userId, summary], index) => {
    const projectOffset = index % nonCancelledProjects.length;
    const eventCount = summary.eventCount;
    const events: DemoMemberEvent[] = Array.from({ length: eventCount }, (_, eventIndex) => {
      const project = nonCancelledProjects[(projectOffset + eventIndex) % nonCancelledProjects.length];
      const projectDate = projectDates[(projectOffset + eventIndex) % projectDates.length];
      const hours = 1 + ((index + eventIndex) % 4) * 0.5;

      return {
        id: `cert-${userId}-${eventIndex + 1}`,
        projectTitle: project.title,
        eventDate: projectDate,
        hours,
        isCertified: eventIndex % 3 !== 0 || project.status === "completed",
        organizationName: "San Ramon City Alliance",
      };
    });

    return [
      userId,
      {
        events,
        totalHours: summary.totalHours,
      },
    ] as const;
  }),
) as Record<string, { events: DemoMemberEvent[]; totalHours: number }>;

const demoReportSummary = {
  totalHours: Object.values(demoMemberHours).reduce((sum, entry) => sum + entry.totalHours, 0),
  totalProjects: mockProjects.length,
  upcomingProjects: mockProjects.filter((project) => getProjectStatus(project) === "upcoming").length,
  completedProjects: mockProjects.filter((project) => getProjectStatus(project) === "completed").length,
  cancelledProjects: mockProjects.filter((project) => getProjectStatus(project) === "cancelled").length,
  activeProjects: mockProjects.filter((project) => getProjectStatus(project) === "in-progress").length,
  eventViews: 1842,
  engagementRate: 63,
  certificatesIssued: Object.values(demoMemberDetails).reduce(
    (sum, entry) => sum + entry.events.filter((event) => event.isCertified).length,
    0,
  ),
};

type CitySyncSource =
  | {
      type: "logo";
      logo: string;
      name: string;
      key: string;
      status: string;
      lastRun: string;
      rows: string;
    }
  | {
      type: "icon";
      icon: typeof Globe;
      name: string;
      key: string;
      status: string;
      lastRun: string;
      rows: string;
    };

const citySyncSources: CitySyncSource[] = [
  {
    type: "logo",
    logo: "/resources/google-drive-logo-2026.png",
    name: "Google Drive evidence",
    key: "drive://san-ramon/events",
    status: "Connected",
    lastRun: "2 min ago",
    rows: "146 files",
  },
  {
    type: "logo",
    logo: "/resources/google-sheets-logo-2026.png",
    name: "Volunteer roster sheet",
    key: "sheets://SRCA volunteer ledger",
    status: "Connected",
    lastRun: "4 min ago",
    rows: "1,284 rows",
  },
  {
    type: "logo",
    logo: "/resources/google-calendar-logo-2026.png",
    name: "City operations calendar",
    key: "calendar://parks-public-events",
    status: "Connected",
    lastRun: "9 min ago",
    rows: "38 events",
  },
  {
    type: "icon",
    icon: Globe,
    name: "San Ramon parks permits API",
    key: "api.sanramon.ca.gov/v2/permits",
    status: "Rate limited",
    lastRun: "18 min ago",
    rows: "7 pending",
  },
];

const citySyncRuns = [
  { id: "run_8f41", source: "Google Drive evidence", result: "23 files indexed", duration: "12.4s", status: "Success" },
  { id: "run_8f40", source: "Volunteer roster sheet", result: "91 volunteers reconciled", duration: "7.8s", status: "Success" },
  { id: "run_8f39", source: "Parks permits API", result: "Retry scheduled after 429", duration: "2.1s", status: "Warning" },
  { id: "run_8f38", source: "AI intake classifier", result: "14 draft shifts created", duration: "31.6s", status: "Review" },
];

function CityApiSyncPluginTab() {
  return (
    <Card className="overflow-hidden border-border/60 bg-background/95 shadow-sm">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">Enabled</Badge>
              <Badge variant="outline">city-api-sync</Badge>
              <Badge variant="secondary">v1.8.2</Badge>
              <Badge variant="secondary" className="bg-success/10 text-success">Tenant isolated</Badge>
            </div>
            <CardTitle className="text-2xl tracking-tight">
              City API Sync
            </CardTitle>
            <CardDescription>
              Installed private plugin syncing San Ramon city permits, Drive evidence folders, Sheets rosters, Calendar operations, and AI-normalized intake records into this organization.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline">
              <Settings2 data-icon="inline-start" />
              Configure
            </Button>
            <Button size="sm">
              <Workflow data-icon="inline-start" />
              Run sync now
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Records ingested", "18.4k", "+612 today"],
            ["Queued for review", "43", "AI confidence < 92%"],
            ["Duplicates merged", "412", "last 30 days"],
            ["Approval SLA", "11 min", "median"],
          ].map(([label, value, helper]) => (
            <div key={label} className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-border/70 bg-muted/15">
            <div className="border-b border-border/70 p-4">
              <p className="text-sm font-semibold">Connected sources</p>
              <p className="text-xs text-muted-foreground">Data sources owned by this organization only.</p>
            </div>
            <div className="divide-y divide-border/70">
              {citySyncSources.map((source) => (
                <div key={source.name} className="flex items-center gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs">
                    {source.type === "logo" ? (
                      <Image
                        src={source.logo}
                        alt={source.name}
                        width={24}
                        height={24}
                        className="size-6 object-contain"
                      />
                    ) : (
                      <source.icon className="h-5 w-5 text-primary" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{source.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{source.key}</p>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    <p>{source.rows}</p>
                    <p>{source.lastRun}</p>
                  </div>
                  <Badge
                    variant={source.status === "Connected" ? "secondary" : "outline"}
                    className={source.status === "Connected" ? "bg-success/10 text-success" : "text-info"}
                  >
                    {source.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Plugin workflow</p>
                  <p className="text-xs text-muted-foreground">Private queue, AI review, and scoped writes.</p>
                </div>
                <Workflow className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-4 grid gap-2">
                {[
                  ["Fetch", "API, Drive, Sheets, Calendar"],
                  ["Normalize", "dedupe, map fields, detect conflicts"],
                  ["AI review", "draft shifts, classify waivers, flag risk"],
                  ["Publish", "organization-scoped projects and reports"],
                ].map(([label, body]) => (
                  <div key={label} className="flex items-center gap-3 rounded-lg border bg-background/70 p-3">
                    <Check className="h-4 w-4 text-success" />
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-success" />
                Runtime boundary
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Reads and writes use organization-scoped plugin tables, explicit service routes, and audit logs. No other organization can query this plugin dataset.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/15">
          <div className="border-b border-border/70 p-4">
            <p className="text-sm font-semibold">Recent sync runs</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border/70 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Run</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Result</th>
                  <th className="px-4 py-3 text-left font-medium">Duration</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {citySyncRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3 font-mono text-xs">{run.id}</td>
                    <td className="px-4 py-3">{run.source}</td>
                    <td className="px-4 py-3 text-muted-foreground">{run.result}</td>
                    <td className="px-4 py-3 text-muted-foreground">{run.duration}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={run.status === "Success" ? "secondary" : "outline"}
                        className={run.status === "Success" ? "bg-success/10 text-success" : "text-info"}
                      >
                        {run.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const demoPluginTabs: OrganizationTabBehavior[] = [
  {
    value: "san-ramon-api",
    label: "City API Sync",
    icon: <Plug className="h-4 w-4" />,
    content: <CityApiSyncPluginTab />,
  },
];

type DemoMarketplaceFilter = "all" | "installed" | "available" | "updates";

const demoMarketplacePlugins = [
  {
    key: "city-api-sync",
    name: "City API Sync",
    navLabel: "City API Sync",
    ownerName: "Lets Assist",
    ownerType: "Platform official",
    description: "Sync city permit APIs, Drive folders, Sheets rosters, Calendar events, and AI intake review queues.",
    installed: true,
    enabled: true,
    latestVersion: "1.8.2",
    installedVersion: "1.8.2",
    updatedAt: "2 minutes ago",
    visibility: "private",
    requiredScopes: ["projects:write", "reports:write", "plugin_data:read"],
    isForced: true,
    updateAvailable: false,
  },
  {
    key: "google-workspace-sync",
    name: "Google Workspace Sync",
    navLabel: "Integrations",
    ownerName: "Lets Assist",
    ownerType: "Platform official",
    description: "Push approved projects, volunteer slots, attendance ledgers, and certificates to Google Sheets, Calendar, and Drive.",
    installed: true,
    enabled: true,
    latestVersion: "2.4.0",
    installedVersion: "2.3.1",
    updatedAt: "3 days ago",
    visibility: "global",
    requiredScopes: ["calendar:write", "sheets:write", "drive:write"],
    isForced: false,
    updateAvailable: true,
  },
  {
    key: "ai-intake-review",
    name: "AI Intake Review",
    navLabel: "Review",
    ownerName: "Lets Assist Labs",
    ownerType: "Platform official",
    description: "Classifies imported forms, detects duplicate service requests, and drafts volunteer shifts for admin approval.",
    installed: false,
    enabled: false,
    latestVersion: "0.9.4",
    installedVersion: null,
    updatedAt: "1 week ago",
    visibility: "private",
    requiredScopes: ["ai:plugin", "projects:draft", "plugin_data:write"],
    isForced: false,
    updateAvailable: false,
  },
  {
    key: "certificate-batch-export",
    name: "Certificate Batch Export",
    navLabel: "Certificates",
    ownerName: "Lets Assist",
    ownerType: "Platform official",
    description: "Batch-generate verified service certificates and export signed PDFs for district or nonprofit records.",
    installed: false,
    enabled: false,
    latestVersion: "1.2.6",
    installedVersion: null,
    updatedAt: "5 days ago",
    visibility: "global",
    requiredScopes: ["certificates:write", "reports:read"],
    isForced: false,
    updateAvailable: false,
  },
];

function DemoPluginCard({
  plugin,
  mode,
}: {
  plugin: (typeof demoMarketplacePlugins)[number];
  mode: "installed" | "available";
}) {
  const isPrivate = plugin.visibility === "private";

  return (
    <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{plugin.name}</p>
            <Badge variant="outline">{plugin.navLabel}</Badge>
            {mode === "installed" ? (
              <Badge variant={plugin.enabled ? "default" : "secondary"}>
                {plugin.enabled ? "Enabled" : "Disabled"}
              </Badge>
            ) : (
              <Badge variant="secondary">Available</Badge>
            )}
            {isPrivate ? <Badge variant="destructive">Private</Badge> : null}
            {plugin.isForced ? (
              <Badge variant="default" className="bg-amber-600 hover:bg-amber-600">Forced</Badge>
            ) : null}
            {plugin.updateAvailable ? <Badge variant="outline">Update</Badge> : null}
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground">{plugin.description}</p>
          <p className="text-xs text-muted-foreground">
            {plugin.ownerName} · {plugin.ownerType} ·{" "}
            {mode === "installed"
              ? `Installed ${plugin.installedVersion} · Updated ${plugin.updatedAt}`
              : `v${plugin.latestVersion} · ${plugin.requiredScopes.length} permissions`}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          {mode === "installed" ? (
            <>
              <Button size="sm" variant="outline" disabled={isPrivate}>
                <Settings2 data-icon="inline-start" />
                Settings
              </Button>
              {plugin.updateAvailable ? (
                <Button size="sm" variant="secondary">
                  <Wrench data-icon="inline-start" />
                  Update
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={plugin.isForced}>
                {plugin.enabled ? "Disable" : "Enable"}
              </Button>
            </>
          ) : (
            <Button size="sm">
              <Store data-icon="inline-start" />
              Install
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DemoPluginMarketplace() {
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] = useState<DemoMarketplaceFilter>("all");

  const filteredPlugins = useMemo(() => {
    const term = marketplaceSearch.trim().toLowerCase();
    return demoMarketplacePlugins.filter((plugin) => {
      const matchesFilter =
        marketplaceFilter === "all" ||
        (marketplaceFilter === "installed" && plugin.installed) ||
        (marketplaceFilter === "available" && !plugin.installed) ||
        (marketplaceFilter === "updates" && plugin.updateAvailable);

      if (!matchesFilter) return false;
      if (!term) return true;

      return [
        plugin.name,
        plugin.key,
        plugin.navLabel,
        plugin.ownerName,
        plugin.description,
      ].join(" ").toLowerCase().includes(term);
    });
  }, [marketplaceFilter, marketplaceSearch]);

  const availablePlugins = filteredPlugins.filter((plugin) => !plugin.installed);
  const installedPlugins = filteredPlugins.filter((plugin) => plugin.installed);
  const installedCount = demoMarketplacePlugins.filter((plugin) => plugin.installed).length;
  const enabledCount = demoMarketplacePlugins.filter((plugin) => plugin.enabled).length;
  const updateCount = demoMarketplacePlugins.filter((plugin) => plugin.updateAvailable).length;

  const marketplaceSections = (
    <>
      {(marketplaceFilter === "all" || marketplaceFilter === "available") ? (
        <section className="flex flex-col gap-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Available to install</p>
              <p className="text-xs text-muted-foreground">New plugins your organization can activate.</p>
            </div>
            <Badge variant="secondary">{availablePlugins.length}</Badge>
          </div>
          {availablePlugins.length === 0 ? (
            <Empty className="rounded-xl border bg-muted/20 py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Store />
                </EmptyMedia>
                <EmptyTitle>No available plugins in this view</EmptyTitle>
                <EmptyDescription>Try switching filters or clearing the search query.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3">
              {availablePlugins.map((plugin) => (
                <DemoPluginCard key={plugin.key} plugin={plugin} mode="available" />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {(marketplaceFilter === "all" || marketplaceFilter === "installed" || marketplaceFilter === "updates") ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Installed plugins</p>
              <p className="text-xs text-muted-foreground">Manage active plugins and update settings.</p>
            </div>
            <Badge variant="secondary">{installedPlugins.length}</Badge>
          </div>
          {installedPlugins.length === 0 ? (
            <Empty className="rounded-xl border bg-muted/20 py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Puzzle />
                </EmptyMedia>
                <EmptyTitle>No installed plugins in this view</EmptyTitle>
                <EmptyDescription>Install a plugin to configure and manage it here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3">
              {installedPlugins.map((plugin) => (
                <DemoPluginCard key={plugin.key} plugin={plugin} mode="installed" />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {filteredPlugins.length === 0 ? (
        <Empty className="py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>No matching plugins</EmptyTitle>
            <EmptyDescription>Try a different search term or filter.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </>
  );

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" className="w-full sm:w-auto cursor-pointer hover:bg-muted">
            <Store data-icon="inline-start" />
            Open plugin marketplace
          </Button>
        }
      />
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Store className="size-5" />
            Plugin marketplace
          </DialogTitle>
          <DialogDescription>
            Search and manage plugins for San Ramon City Alliance.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/25 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Organization plugins</p>
              <p className="text-sm text-muted-foreground">
                Install, update, and configure plugins scoped to this organization.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{demoMarketplacePlugins.length} available</Badge>
                <Badge variant="secondary">{installedCount} installed</Badge>
                <Badge variant="secondary">{enabledCount} enabled</Badge>
                <Badge variant="secondary">{updateCount} update pending</Badge>
              </div>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
              Runtime: private plugin catalog
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="w-full lg:flex-1">
              <FieldLabel htmlFor="demo-organization-plugin-search">Search plugins</FieldLabel>
              <InputGroup className="mt-2">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  id="demo-organization-plugin-search"
                  placeholder="Search by name, key, owner, or description"
                  value={marketplaceSearch}
                  onChange={(event) => setMarketplaceSearch(event.target.value)}
                />
              </InputGroup>
            </div>

            <div className="flex flex-col gap-2 lg:min-w-80">
              <FieldTitle>Filter</FieldTitle>
              <ToggleGroup
                value={[marketplaceFilter]}
                onValueChange={(value) => {
                  const nextValue = value[0];
                  if (
                    nextValue === "all" ||
                    nextValue === "installed" ||
                    nextValue === "available" ||
                    nextValue === "updates"
                  ) {
                    setMarketplaceFilter(nextValue);
                  }
                }}
                spacing={2}
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="installed">Installed</ToggleGroupItem>
                <ToggleGroupItem value="available">Available</ToggleGroupItem>
                <ToggleGroupItem value="updates">Needs update</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          <ScrollArea className="max-h-120 rounded-2xl border">
            <div className="flex flex-col gap-6 p-4">{marketplaceSections}</div>
          </ScrollArea>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-md border bg-muted p-1.5">
                <AlertTriangle className="size-4 text-muted-foreground" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold">Private plugin installs are scoped</p>
                <p className="text-sm text-muted-foreground">
                  Plugin settings, data tables, AI usage, and sync jobs stay attached to this organization and its installed plugin version.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function OrgToolingSection() {
  const handleMockOrganizationClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const projectLink = target.closest('a[href^="/projects"]');

    if (!projectLink) {
      return;
    }

    event.preventDefault();
    toast.info("This is just a mockup.", {
      description: "Real organizations open the live project from here.",
    });
  };

  return (
    <section id="org-tooling" className="py-16 sm:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-3xl"
        >
          <Badge variant="outline" className="mb-3 border-primary/40 bg-primary/10 text-primary">
            For organizations
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <AnimatedText text="The workspace SignUpGenius never built" mode="words" />
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Run your volunteer program from one simple dashboard - no spreadsheets, no guesswork. Manage members and roles, verify hours with QR check-ins, auto-issue certificates, and export compliance-ready reports in seconds. Built for schools and nonprofits that need reliable, auditable volunteer records.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="relative mx-auto mt-12 w-full max-w-6xl"
        >
          <div className="pointer-events-none absolute -inset-x-8 -inset-y-6 rounded-3xl bg-[radial-gradient(40%_30%_at_30%_20%,--theme(--color-emerald-400/18%),transparent_70%),radial-gradient(30%_25%_at_70%_10%,--theme(--color-primary/16%),transparent_70%)] blur-2xl" />
          <div className="relative rounded-2xl border border-primary/20 bg-card/90 shadow-2xl backdrop-blur-xs">
            <div className="p-4 sm:p-6" onClickCapture={handleMockOrganizationClick}>
              <OrganizationHeader
                organization={mockOrganization}
                userRole="admin"
                memberCount={mockMembers.length}
              />
              <div className="mt-6">
                <OrganizationTabs
                  organization={mockOrganization}
                  members={mockMembers}
                  projects={mockProjects}
                  userRole="admin"
                  currentUserId="u1"
                  reportSummary={demoReportSummary}
                  organizationCreatedLabel="January 1, 2025"
                  demoReportsContent={<OrganizationAnalyticsDemo />}
                  demoAdminToolsContent={<DemoPluginMarketplace />}
                  pluginTabs={demoPluginTabs}
                demoMemberHours={demoMemberHours}
                demoMemberDetails={demoMemberDetails}
              />
              </div>
            </div>
          </div>
        </motion.div>

        <div className="mt-12 space-y-10">
          <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
            {orgFeatures.map((feat) => (
                <Card key={feat.title} className="h-full border-border/60 bg-background/90 shadow-xs">
                  <CardContent className="p-4">
                  {feat.logos ? (
                    <div className="mb-2 flex items-center gap-2">
                      {feat.logos.map((logo) => (
                        <span key={logo.src} className="flex size-9 items-center justify-center rounded-lg border bg-background shadow-xs">
                          <Image
                            src={logo.src}
                            alt={logo.alt}
                            width={22}
                            height={22}
                            className="size-5 object-contain"
                          />
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mb-2 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                      <feat.icon className="h-4 w-4" />
                    </div>
                  )}
                  <p className="text-sm font-semibold text-foreground">{feat.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
            <Link
              href="/contact"
              className={cn(buttonVariants({ size: "lg", className: "gap-2" }))}
            >
              Contact us for integrations
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/organization"
              className={cn(buttonVariants({ size: "lg", variant: "outline", className: "gap-2" }))}
            >
              Explore connected organizations
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
