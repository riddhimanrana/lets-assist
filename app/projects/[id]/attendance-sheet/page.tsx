import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  attendancePrintSessions,
  requireAttendancePrintAccess,
} from "@/lib/attendance/print-manifest";
import { AttendanceSheetClient } from "./AttendanceSheetClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Print attendance sheets",
  robots: { index: false, follow: false },
};

export default async function AttendanceSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await requireAttendancePrintAccess(id);
  if (!access) notFound();
  return (
    <AttendanceSheetClient
      projectId={id}
      projectTitle={access.project.title}
      timezone={access.project.project_timezone || "America/Los_Angeles"}
      sessions={attendancePrintSessions(access.project)}
    />
  );
}
