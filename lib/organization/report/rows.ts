import { format } from "date-fns";

import type { OrganizationReportData, ReportType } from "./types";

export function buildReportRows(
  report: OrganizationReportData,
  reportType: ReportType,
): string[][] {
  if (reportType === "member-hours") {
    return [
      [
        "Volunteer Name",
        "Email",
        "Total Hours",
        "Verified Hours",
        "Pending Hours",
        "Events Attended",
        "Last Activity",
        "Source",
      ],
      ...report.volunteers.map((volunteer) => [
        volunteer.name,
        volunteer.email || "",
        (volunteer.totalHours ?? 0).toFixed(1),
        (volunteer.verifiedHours ?? 0).toFixed(1),
        (volunteer.pendingHours ?? 0).toFixed(1),
        volunteer.eventsAttended.toString(),
        volunteer.lastActivity
          ? format(new Date(volunteer.lastActivity), "yyyy-MM-dd")
          : "",
        volunteer.source === "registered" ? "Registered" : "Anonymous",
      ]),
    ];
  }

  if (reportType === "project-summary") {
    return [
      [
        "Project",
        "Status",
        "Verified Hours",
        "Pending Hours",
        "Total Hours",
        "Volunteer Count",
      ],
      ...report.projects.map((project) => [
        project.title,
        project.status || "",
        (project.verifiedHours ?? 0).toFixed(1),
        (project.pendingHours ?? 0).toFixed(1),
        (project.totalHours ?? 0).toFixed(1),
        project.volunteerCount.toString(),
      ]),
    ];
  }

  return [
    ["Month", "Verified Hours", "Pending Hours", "Total Hours"],
    ...report.monthlyHours.map((month) => [
      month.month,
      (month.verified ?? 0).toFixed(1),
      (month.pending ?? 0).toFixed(1),
      (month.total ?? 0).toFixed(1),
    ]),
  ];
}
