import { certificateHours } from "@/lib/projects/certificate-duration";
import { certificateExportType } from "./csv";
import { formatCertificateDate, formatCertificateTime } from "./project-dates";

export type CertificateRecord = {
  id: string;
  project_title?: string | null;
  title?: string | null;
  organization_name?: string | null;
  creator_name?: string | null;
  volunteer_name?: string | null;
  volunteer_email?: string | null;
  event_start?: string | null;
  event_end?: string | null;
  event_timezone?: string | null;
  credited_minutes?: number | null;
  hours?: number | string | null;
  project_location?: string | null;
  is_certified?: boolean | null;
  check_in_method?: string | null;
  issued_at?: string | null;
  type?: string | null;
  projects?: { project_timezone?: string | null } | null;
};

export interface ExportData {
  id: string;
  projectTitle: string;
  organizationName: string;
  volunteerName: string;
  volunteerEmail: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  duration: string;
  location: string;
  supervisorContact: string;
  isVerified: boolean;
  type: string;
  certificationStatus: string;
  checkInMethod: string;
  issuedDate: string;
}

export function certificateToDashboardExport(
  cert: CertificateRecord,
  userEmail: string,
): ExportData {
  const isVerified = certificateExportType(cert.type) === "platform";
  const timeZone = cert.projects?.project_timezone || cert.event_timezone;
  return {
    id: cert.id,
    projectTitle: cert.project_title || cert.title || "Unknown Project",
    organizationName:
      cert.organization_name || cert.creator_name || "Unknown Organization",
    volunteerName: cert.volunteer_name || "Unknown Volunteer",
    volunteerEmail: cert.volunteer_email || userEmail,
    date: formatCertificateDate(cert.event_start, timeZone),
    startTime: formatCertificateTime(cert.event_start, timeZone),
    endDate: formatCertificateDate(cert.event_end, timeZone),
    endTime: formatCertificateTime(cert.event_end, timeZone),
    duration: certificateHours(cert, () => Number(cert.hours || 0)).toString(),
    location: cert.project_location || "Unknown Location",
    supervisorContact: cert.creator_name || "Unknown Supervisor",
    isVerified: isVerified,
    type: isVerified ? "platform" : "self-reported", // Use lowercase to match DB values
    certificationStatus: cert.is_certified ? "Certified" : "Participated",
    checkInMethod: cert.check_in_method || "Unknown",
    issuedDate: formatCertificateDate(cert.issued_at, timeZone),
  };
}
