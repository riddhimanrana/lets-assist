import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
import { createClient } from "@/lib/supabase/server";
import { Metadata } from "next";
import { AttendanceClient } from "./AttendanceClient";
import { getProject } from "../actions";
import type { Project } from "@/types";
import { getProjectAttendanceAvailability } from "./attendance-availability";

async function checkAttendanceAvailability(projectId: string) {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(PROJECT_CLIENT_SELECT)
    .eq("id", projectId)
    .single();

  if (!project) return { isActive: false };

  return {
    ...getProjectAttendanceAvailability(project as Project),
    project,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { project } = await getProject(id);
  const title = project ? `Attendance — ${project.title}` : "Attendance";

  return {
    title,
    description: project
      ? `Review attendance for ${project.title}.`
      : "Review attendance for this project.",
  };
}

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const availability = await checkAttendanceAvailability(projectId);

  return (
    <AttendanceClient
      projectId={projectId}
      initialAvailability={availability}
    />
  );
}
