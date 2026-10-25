import { format } from "date-fns";

import { escapeCsvCell } from "@/lib/organization/report-output-safety";

import {
  formatHours,
  getMemberProfile,
  type MemberHoursMap,
  type MemberHoursPeriod,
  type OrganizationMember,
} from "./members-shared";

/** Downloads the hours CSV for the members currently shown in the table. */
export function downloadMemberHoursCsv({
  members,
  memberHours,
  dateRange,
}: {
  members: OrganizationMember[];
  memberHours: MemberHoursMap;
  dateRange: MemberHoursPeriod;
}) {
  const headers = [
    "Member Name",
    "Username",
    "Role",
    "Joined Date",
    "Total Hours",
    "Events Attended",
  ];
  const csvRows = [headers.join(",")];

  for (const member of members) {
    const profile = getMemberProfile(member);
    const totalHours = memberHours[member.user_id]?.totalHours || 0;
    const eventCount = memberHours[member.user_id]?.eventCount || 0;

    csvRows.push(
      [
        profile?.full_name || "Unknown User",
        profile?.username || "",
        member.role,
        format(new Date(member.joined_at), "MMM d, yyyy"),
        formatHours(totalHours),
        eventCount,
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const today = new Date().toISOString().split("T")[0];
  let filename = `member-hours-lifetime-${today}`;
  if (dateRange?.from && dateRange?.to) {
    const fromDate = format(dateRange.from, "yyyy-MM-dd");
    const toDate = format(
      new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000),
      "yyyy-MM-dd",
    );
    filename = `member-hours-${fromDate}-to-${toDate}`;
  }
  a.download = `${filename}.csv`;

  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
