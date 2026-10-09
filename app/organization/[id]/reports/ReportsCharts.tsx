"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";

import type { OrganizationReportData } from "./actions";

/** Hours month by month, next to the registered and anonymous volunteer mix. */
export function ReportsCharts({
  reportData,
  loading,
}: {
  reportData: OrganizationReportData | null;
  loading: boolean;
}) {
  const chartConfig = useMemo(
    () =>
      ({
        total: {
          label: "Hours",
          color: "var(--primary)",
        },
        verified: {
          label: "Verified",
          color: "var(--chart-1)",
        },
        pending: {
          label: "Pending",
          color: "var(--chart-4)",
        },
        volunteers: {
          label: "Volunteers",
          color: "var(--chart-2)",
        },
      }) satisfies ChartConfig,
    [],
  );

  const monthlyData = reportData?.monthlyHours || [];
  const registeredVolunteerCount =
    reportData?.metrics?.registeredVolunteers ?? 0;
  const anonymousVolunteerCount = reportData?.metrics?.anonymousVolunteers ?? 0;
  const volunteerMixData = [
    {
      type: "Registered",
      volunteers: registeredVolunteerCount,
      fill: "var(--color-volunteers)",
    },
    {
      type: "Anonymous",
      volunteers: anonymousVolunteerCount,
      fill: "var(--color-pending)",
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Monthly hours</CardTitle>
          <CardDescription>
            Verified and pending hours month by month for the selected range
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <ChartContainer config={chartConfig} className="h-60 w-full">
              <AreaChart
                accessibilityLayer
                data={monthlyData}
                margin={{ left: 8, right: 12, top: 10, bottom: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tick={{ fontSize: 12 }}
                />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="verified"
                  type="natural"
                  fill="var(--color-verified)"
                  fillOpacity={0.25}
                  stroke="var(--color-verified)"
                  stackId="a"
                />
                <Area
                  dataKey="pending"
                  type="natural"
                  fill="var(--color-pending)"
                  fillOpacity={0.2}
                  stroke="var(--color-pending)"
                  stackId="a"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Volunteer mix</CardTitle>
          <CardDescription>
            Registered and anonymous participation
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <ChartContainer config={chartConfig} className="h-60 w-full">
              <RechartsBarChart
                accessibilityLayer
                data={volunteerMixData}
                layout="vertical"
                margin={{ left: 0, right: 12, top: 10, bottom: 0 }}
              >
                <CartesianGrid horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="type"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  width={80}
                />
                <ChartTooltip
                  content={<ChartTooltipContent nameKey="type" />}
                />
                <Bar dataKey="volunteers" radius={[0, 5, 5, 0]} />
              </RechartsBarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
