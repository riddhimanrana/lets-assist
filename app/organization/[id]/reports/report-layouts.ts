/**
 * Flexible Report Layout Configuration System
 * Allows customization of report orientation, column selection, and ordering
 */

export type ReportOrientation = "horizontal" | "vertical";

// Report data item types
export interface VolunteerItem {
  name: string;
  email: string | null;
  totalHours: number;
  verifiedHours: number;
  pendingHours: number;
  attendanceHours?: number;
  eventsAttended: number;
  lastActivity?: string;
  source: "registered" | "anonymous";
}

export interface ProjectItem {
  title: string;
  status: string | null;
  verifiedHours: number;
  pendingHours: number;
  attendanceHours?: number;
  totalHours: number;
  volunteerCount: number;
}

export interface MonthlyItem {
  month: string;
  verified: number;
  pending: number;
  attendance?: number;
  total: number;
}

export type ColumnKey =
  // Member Hours columns
  | "volunteer_name"
  | "email"
  | "total_hours"
  | "verified_hours"
  | "pending_hours"
  | "attendance_hours"
  | "events_attended"
  | "last_activity"
  | "source"
  // Project Summary columns
  | "project_name"
  | "project_status"
  | "project_verified_hours"
  | "project_pending_hours"
  | "project_attendance_hours"
  | "project_total_hours"
  | "volunteer_count"
  // Monthly Summary columns
  | "month"
  | "monthly_verified_hours"
  | "monthly_pending_hours"
  | "monthly_attendance_hours"
  | "monthly_total_hours";

export interface ColumnConfig {
  key: ColumnKey;
  label: string;
  width?: number; // Optional: for future use in sheet formatting
}

export type ReportType = "member-hours" | "project-summary" | "monthly-summary";

export interface ReportLayoutConfig {
  reportType: ReportType;
  orientation: ReportOrientation;
  columns: ColumnConfig[];
  rowsPerVolunteer?: number; // For vertical layout - how many rows per item
}

// Default column configurations for each report type
export const DEFAULT_COLUMNS: Record<ReportType, ColumnConfig[]> = {
  "member-hours": [
    { key: "volunteer_name", label: "Volunteer Name" },
    { key: "email", label: "Email" },
    { key: "total_hours", label: "Total Hours" },
    { key: "verified_hours", label: "Verified Hours" },
    { key: "pending_hours", label: "Pending Hours" },
    { key: "attendance_hours", label: "Unpublished Attendance Hours" },
    { key: "events_attended", label: "Events Attended" },
    { key: "last_activity", label: "Last Activity" },
    { key: "source", label: "Source" },
  ],
  "project-summary": [
    { key: "project_name", label: "Project" },
    { key: "project_status", label: "Status" },
    { key: "project_verified_hours", label: "Verified Hours" },
    { key: "project_pending_hours", label: "Pending Hours" },
    { key: "project_attendance_hours", label: "Unpublished Attendance Hours" },
    { key: "project_total_hours", label: "Total Hours" },
    { key: "volunteer_count", label: "Volunteer Count" },
  ],
  "monthly-summary": [
    { key: "month", label: "Month" },
    { key: "monthly_verified_hours", label: "Verified Hours" },
    { key: "monthly_pending_hours", label: "Pending Hours" },
    { key: "monthly_attendance_hours", label: "Unpublished Attendance Hours" },
    { key: "monthly_total_hours", label: "Total Hours" },
  ],
};

// Get default layout for a report type
export function getDefaultLayout(reportType: ReportType): ReportLayoutConfig {
  return {
    reportType,
    orientation: "horizontal",
    columns: DEFAULT_COLUMNS[reportType],
  };
}

// Extract data value from volunteer/project/month based on column key
export function extractColumnValue(
  item: VolunteerItem | ProjectItem | MonthlyItem,
  columnKey: ColumnKey
): string {
  // Type guards for stricter typing
  const isVolunteer = (i: unknown): i is VolunteerItem =>
    typeof i === "object" && i !== null && "name" in i && "email" in i;
  const isProject = (i: unknown): i is ProjectItem =>
    typeof i === "object" && i !== null && "title" in i && "volunteerCount" in i;
  const isMonthly = (i: unknown): i is MonthlyItem =>
    typeof i === "object" && i !== null && "month" in i && "verified" in i;

  if (isVolunteer(item)) {
    switch (columnKey) {
      case "volunteer_name":
        return item.name;
      case "email":
        return item.email || "";
      case "total_hours":
        return item.totalHours?.toFixed(1) || "0.0";
      case "verified_hours":
        return item.verifiedHours?.toFixed(1) || "0.0";
      case "pending_hours":
        return item.pendingHours?.toFixed(1) || "0.0";
      case "attendance_hours":
        return item.attendanceHours?.toFixed(1) || "0.0";
      case "events_attended":
        return item.eventsAttended?.toString() || "0";
      case "last_activity":
        if (!item.lastActivity) return "";
        const date = new Date(item.lastActivity);
        return date.toISOString().split("T")[0];
      case "source":
        return item.source === "registered" ? "Registered" : "Anonymous";
      default:
        return "";
    }
  }

  if (isProject(item)) {
    switch (columnKey) {
      case "project_name":
        return item.title;
      case "project_status":
        return item.status || "";
      case "project_verified_hours":
        return item.verifiedHours?.toFixed(1) || "0.0";
      case "project_pending_hours":
        return item.pendingHours?.toFixed(1) || "0.0";
      case "project_attendance_hours":
        return item.attendanceHours?.toFixed(1) || "0.0";
      case "project_total_hours":
        return item.totalHours?.toFixed(1) || "0.0";
      case "volunteer_count":
        return item.volunteerCount?.toString() || "0";
      default:
        return "";
    }
  }

  if (isMonthly(item)) {
    switch (columnKey) {
      case "month":
        return item.month;
      case "monthly_verified_hours":
        return item.verified?.toFixed(1) || "0.0";
      case "monthly_pending_hours":
        return item.pending?.toFixed(1) || "0.0";
      case "monthly_attendance_hours":
        return item.attendance?.toFixed(1) || "0.0";
      case "monthly_total_hours":
        return item.total?.toFixed(1) || "0.0";
      default:
        return "";
    }
  }

  return "";
}

/**
 * Build rows based on layout configuration
 * Supports both horizontal (traditional) and vertical (custom) layouts
 */
export function buildRowsWithLayout(
  reportData: {
    volunteers?: VolunteerItem[];
    projects?: ProjectItem[];
    monthlyHours?: MonthlyItem[];
  },
  layout: ReportLayoutConfig
): string[][] {
  if (layout.orientation === "horizontal") {
    return buildHorizontalLayout(reportData, layout);
  } else {
    return buildVerticalLayout(reportData, layout);
  }
}

function buildHorizontalLayout(
  reportData: {
    volunteers?: VolunteerItem[];
    projects?: ProjectItem[];
    monthlyHours?: MonthlyItem[];
  },
  layout: ReportLayoutConfig
): string[][] {
  const rows: string[][] = [];

  // Header row
  rows.push(layout.columns.map((col) => col.label));

  // Data rows
  if (layout.reportType === "member-hours" && reportData.volunteers) {
    rows.push(
      ...reportData.volunteers.map((volunteer) =>
        layout.columns.map((col) => extractColumnValue(volunteer, col.key))
      )
    );
  } else if (layout.reportType === "project-summary" && reportData.projects) {
    rows.push(
      ...reportData.projects.map((project) =>
        layout.columns.map((col) => extractColumnValue(project, col.key))
      )
    );
  } else if (layout.reportType === "monthly-summary" && reportData.monthlyHours) {
    rows.push(
      ...reportData.monthlyHours.map((month) =>
        layout.columns.map((col) => extractColumnValue(month, col.key))
      )
    );
  }

  return rows;
}

function buildVerticalLayout(
  reportData: {
    volunteers?: VolunteerItem[];
    projects?: ProjectItem[];
    monthlyHours?: MonthlyItem[];
  },
  layout: ReportLayoutConfig
): string[][] {
  const rows: string[][] = [];
  const dataItems =
    layout.reportType === "member-hours"
      ? reportData.volunteers || []
      : layout.reportType === "project-summary"
        ? reportData.projects || []
        : reportData.monthlyHours || [];

  dataItems.forEach((item, index) => {
    // Add separator between items
    if (index > 0) {
      rows.push([]);
    }

    // Add label-value pairs vertically
    layout.columns.forEach((col) => {
      rows.push([col.label, extractColumnValue(item, col.key)]);
    });
  });

  return rows;
}
/**
 * Validate that a layout configuration is valid for the given report type
 */
export function validateLayout(layout: ReportLayoutConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!layout.columns || layout.columns.length === 0) {
    errors.push("Layout must have at least one column");
  }

  const validKeys = DEFAULT_COLUMNS[layout.reportType].map((col) => col.key);
  const invalidColumns = layout.columns.filter(
    (col) => !validKeys.includes(col.key)
  );
  if (invalidColumns.length > 0) {
    errors.push(
      `Invalid columns for ${layout.reportType}: ${invalidColumns.map((c) => c.key).join(", ")}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
