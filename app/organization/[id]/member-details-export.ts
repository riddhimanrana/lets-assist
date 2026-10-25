import { format } from "date-fns";

import { escapeCsvCell } from "@/lib/organization/report-output-safety";

import { formatHours, type MemberHoursPeriod } from "./members-shared";

export interface MemberEventDetail {
  id: string;
  projectTitle: string;
  eventDate: string;
  hours: number;
  isCertified: boolean;
  organizationName: string;
}

/** Downloads one member's event history as a CSV file. */
export function downloadMemberDetailsCsv({
  memberName,
  username,
  role,
  joinedAt,
  events,
  totalHours,
  dateRange,
}: {
  memberName: string;
  username: string;
  role: string;
  joinedAt: string;
  events: MemberEventDetail[];
  totalHours: number;
  dateRange: MemberHoursPeriod;
}) {
  const headers = [
    "Member Name",
    "Username",
    "Role",
    "Joined Date",
    "Event Title",
    "Event Date",
    "Hours",
    "Status",
    "Certificate ID",
    "Certificate Link",
  ];
  const csvRows = [headers.join(",")];
  const joined = format(new Date(joinedAt), "MMM d, yyyy");

  events.forEach((event) => {
    csvRows.push(
      [
        memberName,
        username,
        role,
        joined,
        event.projectTitle,
        format(new Date(event.eventDate), "MMM d, yyyy"),
        formatHours(event.hours),
        event.isCertified ? "Certified" : "Completed",
        event.id,
        event.isCertified
          ? `${window.location.origin}/certificates/${event.id}`
          : "N/A",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  });

  const summaryRows: Array<[string, string | number]> = [
    ["Total Hours", formatHours(totalHours)],
    ["Total Events", events.length],
    ["Certified Events", events.filter((e) => e.isCertified).length],
    ["Member Since", joined],
  ];
  for (const row of summaryRows) {
    csvRows.push(row.map(escapeCsvCell).join(","));
  }

  const blob = new Blob([csvRows.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const today = new Date().toISOString().split("T")[0];
  const cleanName = memberName.replace(/\s+/g, "-").toLowerCase();
  let filename = `${cleanName}-volunteer-data-lifetime-${today}`;
  if (dateRange?.from && dateRange?.to) {
    const fromDate = format(dateRange.from, "yyyy-MM-dd");
    const toDate = format(
      new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000),
      "yyyy-MM-dd",
    );
    filename = `${cleanName}-volunteer-data-${fromDate}-to-${toDate}`;
  }
  a.download = `${filename}.csv`;

  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
