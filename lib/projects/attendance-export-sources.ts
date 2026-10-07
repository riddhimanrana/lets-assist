import type {
  ExportCertificate,
  ExportInterval,
  ExportProject,
  ExportSignup,
} from "./attendance-export";
import type {
  ExportReviewRow,
  ExportRosterEntry,
} from "./attendance-export-unpublished";
import {
  readValidatedExportSnapshot,
  type ExportReadBudget,
} from "./attendance-export-pagination";

export type AttendanceExportSources = {
  project: ExportProject;
  signups: ExportSignup[];
  certificates: ExportCertificate[];
  intervals: ExportInterval[];
  roster: ExportRosterEntry[];
  review: ExportReviewRow[];
};

export type AttendanceExportReaders = {
  projects: (budget: ExportReadBudget) => Promise<ExportProject[]>;
  rows: <T extends { id: string }>(
    table: string,
    columns: string,
    projectId: string,
    budget: ExportReadBudget,
  ) => Promise<T[]>;
};

export function loadAttendanceExportSources(
  readers: AttendanceExportReaders,
  includeUnpublished: boolean,
  maxRows?: number,
) {
  return readValidatedExportSnapshot(async (budget) => {
    const projects = await readers.projects(budget);
    const sources: AttendanceExportSources[] = [];
    for (const project of projects) {
      const [signups, certificates, intervals, roster, review] =
        await Promise.all([
          readers.rows<ExportSignup>(
            "project_signups",
            "id,schedule_id,user_id,anonymous_id,check_in_time,check_out_time,status,attendance_revision,profile:profiles!project_signups_user_id_fkey_profiles(full_name,email),guest:anonymous_signups!project_signups_anonymous_id_fkey(name,email)",
            project.id,
            budget,
          ),
          readers.rows<ExportCertificate>(
            "certificates",
            "id,signup_id,schedule_id,user_id,volunteer_name,volunteer_email,event_start,event_end,credited_minutes,attendance_revision,type",
            project.id,
            budget,
          ),
          readers.rows<ExportInterval>(
            "project_attendance_intervals",
            "id,signup_id,check_in_time,check_out_time",
            project.id,
            budget,
          ),
          includeUnpublished
            ? readers.rows<ExportRosterEntry>(
                "project_paper_roster_entries",
                "id,scan_row_id,schedule_id,name,check_in_time,check_out_time,attendance_intervals",
                project.id,
                budget,
              )
            : [],
          includeUnpublished
            ? readers.rows<ExportReviewRow>(
                "project_paper_scan_rows",
                "id,name,email,check_in_time,check_out_time,attendance_intervals,review_revision,review_acknowledged,identity_confirmed,decision,outcome,committed_signup_id,batch:project_paper_scan_batches!batch_id(schedule_id,status)",
                project.id,
                budget,
              )
            : [],
        ]);
      sources.push({
        project,
        signups,
        certificates,
        intervals,
        roster,
        review,
      });
    }
    return sources;
  }, maxRows);
}
