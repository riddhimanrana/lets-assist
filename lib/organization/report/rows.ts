import { format } from "date-fns";

import type {
  MonthlyHours,
  OrganizationReportData,
  ProjectSummary,
  ReportType,
  VolunteerSummary,
} from "./types";

/**
 * A cell bound for a spreadsheet. Hours and counts are numbers so the sheet
 * can sum them. Everything else is text, including text that looks numeric.
 */
export type ReportSheetCell = string | number;

/**
 * What a column means. The kind decides the cell type, never the value, so a
 * volunteer named "2024" or an id-like email stays text.
 */
type ReportColumn<Item> =
  | { label: string; kind: "text"; read: (item: Item) => string }
  | { label: string; kind: "hours" | "count"; read: (item: Item) => number };

const MEMBER_HOURS_COLUMNS: ReportColumn<VolunteerSummary>[] = [
  { label: "Volunteer Name", kind: "text", read: (item) => item.name },
  { label: "Email", kind: "text", read: (item) => item.email || "" },
  { label: "Total Hours", kind: "hours", read: (item) => item.totalHours },
  {
    label: "Verified Hours",
    kind: "hours",
    read: (item) => item.verifiedHours,
  },
  { label: "Pending Hours", kind: "hours", read: (item) => item.pendingHours },
  {
    label: "Events Attended",
    kind: "count",
    read: (item) => item.eventsAttended,
  },
  {
    label: "Last Activity",
    kind: "text",
    read: (item) =>
      item.lastActivity
        ? format(new Date(item.lastActivity), "yyyy-MM-dd")
        : "",
  },
  {
    label: "Source",
    kind: "text",
    read: (item) => (item.source === "registered" ? "Registered" : "Anonymous"),
  },
];

const PROJECT_SUMMARY_COLUMNS: ReportColumn<ProjectSummary>[] = [
  { label: "Project", kind: "text", read: (item) => item.title },
  { label: "Status", kind: "text", read: (item) => item.status || "" },
  {
    label: "Verified Hours",
    kind: "hours",
    read: (item) => item.verifiedHours,
  },
  { label: "Pending Hours", kind: "hours", read: (item) => item.pendingHours },
  { label: "Total Hours", kind: "hours", read: (item) => item.totalHours },
  {
    label: "Volunteer Count",
    kind: "count",
    read: (item) => item.volunteerCount,
  },
];

const MONTHLY_SUMMARY_COLUMNS: ReportColumn<MonthlyHours>[] = [
  { label: "Month", kind: "text", read: (item) => item.month },
  { label: "Verified Hours", kind: "hours", read: (item) => item.verified },
  { label: "Pending Hours", kind: "hours", read: (item) => item.pending },
  { label: "Total Hours", kind: "hours", read: (item) => item.total },
];

const finite = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function textCell<Item>(column: ReportColumn<Item>, item: Item): string {
  if (column.kind === "text") return column.read(item);
  const value = finite(column.read(item));
  return column.kind === "hours" ? value.toFixed(1) : value.toString();
}

function sheetCell<Item>(
  column: ReportColumn<Item>,
  item: Item,
): ReportSheetCell {
  if (column.kind === "text") return column.read(item);
  const value = finite(column.read(item));
  return column.kind === "hours" ? Math.round(value * 10) / 10 : value;
}

function buildRows<Item, Cell>(
  columns: ReportColumn<Item>[],
  items: Item[],
  toCell: (column: ReportColumn<Item>, item: Item) => Cell,
): Array<Array<Cell | string>> {
  return [
    columns.map((column) => column.label),
    ...items.map((item) => columns.map((column) => toCell(column, item))),
  ];
}

function buildWith<Cell>(
  report: OrganizationReportData,
  reportType: ReportType,
  toCell: <Item>(column: ReportColumn<Item>, item: Item) => Cell,
): Array<Array<Cell | string>> {
  if (reportType === "member-hours") {
    return buildRows(MEMBER_HOURS_COLUMNS, report.volunteers, toCell);
  }
  if (reportType === "project-summary") {
    return buildRows(PROJECT_SUMMARY_COLUMNS, report.projects, toCell);
  }
  return buildRows(MONTHLY_SUMMARY_COLUMNS, report.monthlyHours, toCell);
}

/** Text rows, for CSV export and the on-screen preview. */
export function buildReportRows(
  report: OrganizationReportData,
  reportType: ReportType,
): string[][] {
  return buildWith(report, reportType, textCell);
}

/** Typed rows, for writing to a spreadsheet. */
export function buildReportSheetRows(
  report: OrganizationReportData,
  reportType: ReportType,
): ReportSheetCell[][] {
  return buildWith(report, reportType, sheetCell);
}
