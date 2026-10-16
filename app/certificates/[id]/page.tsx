import { certificateHours } from "@/lib/projects/certificate-duration";
import { safeConsole } from "@/lib/safe-console";
import { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { differenceInMinutes, parseISO, isValid } from "date-fns";
import { certificateTimezone } from "@/lib/certificates/project-dates";

import { PageHeader } from "@/components/layout/PageHeader";
import { ReadLoadError } from "@/components/projects/ReadLoadError";
import { CertificateDocument } from "./_components/CertificateDocument";
import {
  PrintCertificate,
  type PrintCertificateData,
} from "./_components/PrintCertificate";

// Define the expected shape of the fetched data based on the 'certificates' table
interface CertificateData {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "verified" | "self-reported" | null; // Optional for backward compatibility
  event_start: string; // Assuming ISO string format from Supabase
  event_end: string;
  event_timezone?: string | null;
  project_timezone?: string | null;
  credited_minutes?: number | null;
  check_in_method: string;
  organization_name: string | null;
  project_id: string | null;
  issued_at: string; // Assuming ISO string format from Supabase
  volunteer_name: string | null;
  project_location: string | null;
  description: string | null; // For self-reported description
  creator_username: string | null;
}

// Helper function to calculate and format duration
function formatDuration(
  startISO: string,
  endISO: string,
  creditedMinutes?: number | null,
): string {
  try {
    const start = parseISO(startISO);
    const end = parseISO(endISO);
    if (!isValid(start) || !isValid(end)) {
      return "N/A";
    }
    const diffMins = Math.round(
      certificateHours(
        { credited_minutes: creditedMinutes },
        () => differenceInMinutes(end, start) / 60,
      ) * 60,
    );
    if (diffMins < 0) return "Invalid";
    const hours = Math.floor(diffMins / 60);
    const minutes = diffMins % 60;
    return `${hours} hour${hours !== 1 ? "s" : ""}${minutes > 0 ? ` ${minutes} min${minutes !== 1 ? "s" : ""}` : ""}`;
  } catch {
    return "Error";
  }
}

// Query errors that mean "no record for this reader", not a failed read: a
// denied read (42501) and an id that is not a UUID (22P02). Both stay a 404.
const ABSENT_RECORD_ERROR_CODES = new Set(["42501", "22P02"]);

// Define the page props interface
interface CertificatePageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params,
}: CertificatePageProps): Promise<Metadata> {
  const supabase = getAdminClient();
  const { id } = await params;
  const { data: record } = await supabase
    .from("certificate_verification_read_model")
    .select("project_title")
    .eq("id", id)
    .single();

  return {
    title: record?.project_title
      ? `${record.project_title} Volunteer Certificate`
      : "Volunteer Certificate",
    description: "Official volunteer certificate from Let's Assist",
  };
}

export default async function VolunteerRecordPage({
  params,
}: CertificatePageProps): Promise<React.ReactElement> {
  const supabase = getAdminClient();
  const { id: recordId } = await params;

  // Fetch certificate data through the narrow verification read model.
  const { data: record, error } = await supabase
    .from("certificate_verification_read_model")
    .select(
      `
      id,
      project_title,
      creator_name,
      is_certified,
      type,
      event_start,
      event_end,
      event_timezone,
      project_timezone,
      credited_minutes,
      check_in_method,
      organization_name,
      project_id,
      issued_at,
      volunteer_name,
      project_location,
      description,
      creator_username
    `,
    )
    .eq("id", recordId)
    .maybeSingle();

  if (error && !ABSENT_RECORD_ERROR_CODES.has(error.code)) {
    // The read itself failed, so whether a record exists is unknown. Say only
    // that the page did not load: the same copy for every id, real or not.
    safeConsole.error("Error fetching volunteer record:", error);
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Volunteer certificate"
          description="Official record of volunteer activity"
        />
        <ReadLoadError title="We couldn't load this certificate" />
      </div>
    );
  }

  if (error || !record) {
    notFound(); // No such record, or one this reader may not see
  }

  // Type assertion after checking for null and converting to unknown first
  const data = record as unknown as CertificateData;

  // Determine if this is a self-reported certificate (default to verified for backward compatibility)
  const isSelfReported = data.type === "self-reported";
  const timeZone = certificateTimezone(
    data.project_timezone || data.event_timezone,
  );

  // Calculate duration (this doesn't need timezone conversion)
  const durationText = formatDuration(
    data.event_start,
    data.event_end,
    data.credited_minutes,
  );

  const certificateData: PrintCertificateData = {
    id: data.id,
    project_title: data.project_title,
    creator_name: data.creator_name,
    is_certified: data.is_certified,
    event_start: data.event_start,
    timeZone,
    organization_name: data.organization_name,
    issued_at: data.issued_at,
    volunteer_name: data.volunteer_name,
    project_location: data.project_location,
    durationText,
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:px-6">
      <PageHeader
        title={
          isSelfReported ? "Self-reported certificate" : "Volunteer certificate"
        }
        description={
          isSelfReported
            ? "Self-reported volunteer activity record"
            : "Official record of volunteer activity"
        }
        actions={<PrintCertificate data={certificateData} />}
      />

      <CertificateDocument
        data={{
          id: data.id,
          project_title: data.project_title,
          creator_name: data.creator_name,
          creator_username: data.creator_username,
          organization_name: data.organization_name,
          volunteer_name: data.volunteer_name,
          project_location: data.project_location,
          project_id: data.project_id,
          event_start: data.event_start,
          event_end: data.event_end,
          timeZone,
          issued_at: data.issued_at,
          is_certified: data.is_certified,
          check_in_method: data.check_in_method,
          description: data.description,
        }}
        durationText={durationText}
        isSelfReported={isSelfReported}
      />
    </div>
  );
}
