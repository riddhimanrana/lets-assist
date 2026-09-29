import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { requirePaperScanAccess } from "../paper-signups/access";
import { getProject } from "../actions";
import { HoursClient, type AttendanceHoursSignup } from "./HoursClient";
import type { Project } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getProject(id);
  return {
    title: result.project
      ? `Volunteer hours: ${result.project.title}`
      : "Volunteer hours",
  };
}

export default async function HoursPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const { user } = await getAuthUser();
  if (!user) redirect(`/login?redirect=/projects/${projectId}/hours`);
  const access = await requirePaperScanAccess(projectId);
  if (!access.ok) notFound();
  const signups: AttendanceHoursSignup[] = [];
  const { data: correctedIds, error: correctionError } = await access.admin.rpc(
    "project_corrected_certificate_ids",
    { p_project_id: projectId, p_actor_id: user.id },
  );
  if (correctionError)
    return (
      <p role="alert" className="p-6">
        Could not load attendance corrections. Refresh to try again.
      </p>
    );
  const corrected = new Set<string>(correctedIds ?? []);
  let cursor: string | null = null;
  for (;;) {
    let query = access.admin
      .from("project_signups")
      .select(
        `
      id, project_id, created_at, check_in_time, check_out_time, schedule_id,
      user_id, anonymous_id, status, attendance_revision,
      profile:profiles!project_signups_user_id_fkey_profiles(id,full_name,username,email,phone),
      anonymous_signup:anonymous_signups!project_signups_anonymous_id_fkey(id,name,email,phone_number),
      project_attendance_intervals(check_in_time,check_out_time),
      certificates(id,credited_minutes,event_start,event_end,attendance_revision,type)
    `,
      )
      .eq("project_id", projectId)
      .in("status", ["attended", "approved"])
      .order("id")
      .limit(200);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error)
      return (
        <p className="p-6" role="alert">
          Could not load attendance. Refresh to try again.
        </p>
      );
    for (const row of data ?? []) {
      const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
      const guest = Array.isArray(row.anonymous_signup)
        ? row.anonymous_signup[0]
        : row.anonymous_signup;
      signups.push({
        ...row,
        profile: profile ?? undefined,
        anonymous_signup: guest ?? undefined,
        certificates: (row.certificates ?? []).map((certificate) => ({
          ...certificate,
          canResendCorrection: corrected.has(certificate.id),
        })),
      } as AttendanceHoursSignup);
    }
    if (!data || data.length < 200) break;
    cursor = data[data.length - 1].id;
  }
  return (
    <HoursClient project={access.project as Project} initialSignups={signups} />
  );
}
