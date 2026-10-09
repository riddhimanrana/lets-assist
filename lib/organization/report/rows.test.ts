import { describe, expect, test } from "bun:test";

import {
  buildSheetRowsWithLayout,
  buildRowsWithLayout,
  type ReportLayoutConfig,
} from "@/app/organization/[id]/reports/report-layouts";

import { buildReportRows, buildReportSheetRows } from "./rows";
import type { OrganizationReportData } from "./types";

// Names, emails and titles that look like numbers on purpose.
const report: OrganizationReportData = {
  metrics: {
    totalVolunteers: 1,
    registeredVolunteers: 1,
    anonymousVolunteers: 0,
    verifiedHours: 10,
    pendingHours: 2.5,
    totalHours: 12.5,
    totalProjects: 1,
  },
  volunteers: [
    {
      key: "user:1",
      userId: "1",
      name: "2024",
      email: "5550100",
      source: "registered",
      totalHours: 12.5,
      verifiedHours: 10,
      pendingHours: 2.5,
      eventsAttended: 3,
      lastActivity: "2026-01-02T12:00:00.000Z",
    },
  ],
  monthlyHours: [
    {
      month: "Jan 2026",
      sortKey: "2026-01",
      verified: 10,
      pending: 2.5,
      total: 12.5,
    },
  ],
  projects: [
    {
      id: "p1",
      title: "007",
      status: "100",
      verifiedHours: 10,
      pendingHours: 2.5,
      totalHours: 12.5,
      volunteerCount: 1,
    },
  ],
  updatedAt: "2026-01-03T00:00:00.000Z",
};

describe("report cells for a spreadsheet", () => {
  test("hours and counts are numbers, and numeric-looking text stays text", () => {
    const [header, row] = buildReportSheetRows(report, "member-hours");
    expect(header.every((cell) => typeof cell === "string")).toBe(true);
    expect(row).toEqual([
      "2024",
      "5550100",
      12.5,
      10,
      2.5,
      3,
      "2026-01-02",
      "Registered",
    ]);

    expect(buildReportSheetRows(report, "project-summary")[1]).toEqual([
      "007",
      "100",
      10,
      2.5,
      12.5,
      1,
    ]);
    expect(buildReportSheetRows(report, "monthly-summary")[1]).toEqual([
      "Jan 2026",
      10,
      2.5,
      12.5,
    ]);
  });

  test("the text rows used for CSV and preview are unchanged", () => {
    expect(buildReportRows(report, "member-hours")[1]).toEqual([
      "2024",
      "5550100",
      "12.5",
      "10.0",
      "2.5",
      "3",
      "2026-01-02",
      "Registered",
    ]);
    expect(buildReportRows(report, "project-summary")[0]).toEqual([
      "Project",
      "Status",
      "Verified Hours",
      "Pending Hours",
      "Total Hours",
      "Volunteer Count",
    ]);
  });

  test("a saved layout types cells by column, in both orientations", () => {
    const layout: ReportLayoutConfig = {
      reportType: "member-hours",
      orientation: "horizontal",
      columns: [
        { key: "total_hours", label: "42" },
        { key: "volunteer_name", label: "Who" },
        { key: "email", label: "Contact" },
        { key: "events_attended", label: "Events" },
      ],
    };

    expect(buildSheetRowsWithLayout(report, layout)).toEqual([
      ["42", "Who", "Contact", "Events"],
      [12.5, "2024", "5550100", 3],
    ]);
    expect(buildRowsWithLayout(report, layout)[1]).toEqual([
      "12.5",
      "2024",
      "5550100",
      "3",
    ]);

    expect(
      buildSheetRowsWithLayout(report, { ...layout, orientation: "vertical" }),
    ).toEqual([
      ["42", 12.5],
      ["Who", "2024"],
      ["Contact", "5550100"],
      ["Events", 3],
    ]);
  });
});
