"use client";

import { ChartColumn } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface ActivityChartProps {
  data: { month: string; hours: number }[];
}

const chartConfig = {
  hours: {
    label: "Hours",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export function ActivityChart({ data }: ActivityChartProps) {
  const hasHours = data.some((month) => month.hours > 0);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Activity chart</CardTitle>
        <CardDescription>
          Your volunteering hours over the past 6 months.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasHours ? (
          <ChartContainer config={chartConfig} className="h-72 w-full">
            <BarChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                tickFormatter={(value) => value.slice(0, 3)}
              />
              <YAxis
                width={48}
                tickFormatter={(value) => `${value}`}
                tickLine={false}
                tickMargin={10}
                axisLine={false}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <Bar dataKey="hours" fill="var(--color-hours)" radius={8} />
            </BarChart>
          </ChartContainer>
        ) : (
          <Empty className="p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartColumn aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No hours yet</EmptyTitle>
              <EmptyDescription>
                Your hours will show here month by month once you start
                volunteering.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
