import { attendanceExportResponse } from "@/lib/projects/attendance-export-service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return attendanceExportResponse(request, "project", id);
}
