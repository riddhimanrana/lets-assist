"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"; // YAxis is from recharts
import {
  Card,
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

interface ActivityChartProps {
  data: { month: string; hours: number }[];
}



const chartConfig = {
  hours: {
    label: "Hours",
    color: "hsl(var(--chart-3))",
  },
} satisfies ChartConfig;

export function ActivityChart({ data }: ActivityChartProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Activity Chart</CardTitle>
        <CardDescription>Your volunteering hours over the past 6 months.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 3)}
            />
            <YAxis width={48} tickFormatter={(value) => `${value}`} tickLine={false} tickMargin={10} axisLine={false} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar dataKey="hours" fill="var(--color-hours)" radius={8} />
          </BarChart>
        </ChartContainer>
      </CardContent>
      {/* <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="leading-none text-muted-foreground">
          Showing total hours contributed for the last 6 months.
        </div>
      </CardFooter> */}
    </Card>
  );
}
