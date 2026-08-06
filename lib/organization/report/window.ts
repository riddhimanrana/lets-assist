import {
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";

import type { MonthlyHours, ReportDateRange, ReportType } from "./types";

const DEFAULT_REPORT_MONTH_WINDOW = 12;

export type ResolvedReportWindow = {
  queryRange: Required<ReportDateRange>;
  monthStart: Date;
  monthEnd: Date;
};

export function resolveReportWindow(
  range?: ReportDateRange,
): ResolvedReportWindow {
  const now = new Date();
  const fallbackFrom = startOfMonth(
    subMonths(now, DEFAULT_REPORT_MONTH_WINDOW - 1),
  );
  const fallbackTo = endOfMonth(now);

  const parsedFrom = range?.from ? new Date(range.from) : fallbackFrom;
  const parsedTo = range?.to ? new Date(range.to) : fallbackTo;
  const safeFrom = Number.isNaN(parsedFrom.getTime())
    ? fallbackFrom
    : parsedFrom;
  const safeTo = Number.isNaN(parsedTo.getTime()) ? fallbackTo : parsedTo;
  const [from, to] =
    safeFrom <= safeTo ? [safeFrom, safeTo] : [safeTo, safeFrom];

  return {
    queryRange: {
      from: startOfDay(from).toISOString(),
      to: endOfDay(to).toISOString(),
    },
    monthStart: startOfMonth(from),
    monthEnd: startOfMonth(to),
  };
}

export function buildMonthlyHoursSeed(
  monthStart: Date,
  monthEnd: Date,
): MonthlyHours[] {
  return eachMonthOfInterval({ start: monthStart, end: monthEnd }).map(
    (monthDate) => ({
      month: format(monthDate, "MMM yyyy"),
      sortKey: format(monthDate, "yyyy-MM"),
      verified: 0,
      pending: 0,
      total: 0,
    }),
  );
}

export function buildReportFilename(
  reportType: ReportType,
  range?: ReportDateRange,
) {
  const today = format(new Date(), "yyyy-MM-dd");
  if (!range?.from || !range?.to) {
    return `${reportType}-lifetime-${today}.csv`;
  }
  const from = format(new Date(range.from), "yyyy-MM-dd");
  const to = format(new Date(range.to), "yyyy-MM-dd");
  return `${reportType}-${from}-to-${to}.csv`;
}
