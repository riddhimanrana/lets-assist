"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, Award, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface MonthlyData {
  month: string;
  hours: number;
}

interface HoursBreakdown {
  selfReported: number;
  reported: number;
  verified: number;
  unverified: number;
}

interface MiniDashboardProps {
  totalHours: number;
  totalProjects: number;
  progressPercentage: number;
  monthlyData?: MonthlyData[];
  breakdown?: HoursBreakdown;
}

const MOCK_MONTHLY_DATA: MonthlyData[] = [
  { month: "Mar", hours: 24 },
  { month: "Apr", hours: 18 },
  { month: "May", hours: 32 },
  { month: "Jun", hours: 22 },
  { month: "Jul", hours: 28 },
  { month: "Aug", hours: 16 },
];

export function MiniDashboard({
  totalHours,
  totalProjects,
  progressPercentage,
  monthlyData,
  breakdown,
}: MiniDashboardProps) {
  const months = monthlyData ?? MOCK_MONTHLY_DATA;
  const maxHours = Math.max(...months.map((m) => m.hours), 1);
  const chartBarColor = "hsl(var(--chart-3))";

  const defaultBreakdown: HoursBreakdown = breakdown ?? {
    selfReported: Math.round(totalHours * 0.35),
    reported: Math.round(totalHours * 0.65),
    verified: Math.round(totalHours * 0.6),
    unverified: Math.round(totalHours * 0.4),
  };

  const breakdownRows = [
    {
      label: "Platform verified hours",
      badge: "Verified",
      variant: "default" as const,
      hours: defaultBreakdown.verified,
    },
  ];

  return (
    <div className="space-y-3 p-2 md:p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/30">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground">Total Hours</p>
                <p className="text-xl font-semibold">{totalHours}h</p>
              </div>
              <div className="p-1.5 rounded-md bg-primary/20">
                <Clock className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-chart-3/10 to-chart-3/5 border border-chart-3/30">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground">Projects</p>
                <p className="text-xl font-semibold">{totalProjects}</p>
              </div>
              <div className="p-1.5 rounded-md bg-chart-3/20">
                <Award className="h-4 w-4 text-chart-3" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-chart-4/10 to-chart-4/5 border border-chart-4/30">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground">Progress</p>
                <p className="text-lg font-semibold">{progressPercentage}%</p>
              </div>
              <div className="p-1.5 rounded-md bg-chart-4/20">
                <TrendingUp className="h-4 w-4 text-chart-4" />
              </div>
            </div>
            <div className="h-2 rounded-full bg-black">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercentage}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className="h-full rounded-full bg-primary"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Semester trend</h3>
            <p className="text-xs text-muted-foreground">hours per month</p>
          </div>
          <div className="flex items-end gap-3 h-32">
            {months.map((m) => {
              const heightPct = Math.round((m.hours / maxHours) * 100);
              return (
                <div key={m.month} className="flex h-full flex-1 flex-col items-center gap-1">
                  <div className="flex h-full w-full flex-col justify-end overflow-hidden rounded-t-md bg-background">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${heightPct}%` }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                      className="w-full rounded-t-md"
                      style={{ backgroundColor: chartBarColor, minHeight: 6 }}
                      title={`${m.hours}h`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{m.month}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Export-style breakdown</h4>
            <p className="text-xs text-muted-foreground">Aligned with the certificates export view</p>
          </div>
          <div className="space-y-3">
            {breakdownRows.map((row) => (
              <div
                key={row.badge}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={row.variant}>{row.badge}</Badge>
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                </div>
                <p className="text-sm font-semibold">{row.hours}h</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
