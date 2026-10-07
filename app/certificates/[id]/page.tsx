import { safeConsole } from "@/lib/safe-console";
import { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { differenceInMinutes, parseISO, isValid } from "date-fns";

import { PageHeader } from "@/components/layout/PageHeader";
import { CertificateDocument } from "./_components/CertificateDocument";
import { PrintCertificate } from "./_components/PrintCertificate";

// Define the expected shape of the fetched data based on the 'certificates' table
interface CertificateData {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "verified" | "self-reported"; // Optional for backward compatibility
  event_start: string; // Assuming ISO string format from Supabase
  event_end: string; // Assuming ISO string format from Supabase
  user_id: string | null;
  check_in_method: string;
  created_at: string | null; // Keep for potential use, though issued_at is primary
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string; // Assuming ISO string format from Supabase
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  description: string | null; // For self-reported description
  creator_username: string | null;
}

// Helper function to calculate and format duration
function formatDuration(startISO: string, endISO: string): string {
  try {
    const start = parseISO(startISO);
    const end = parseISO(endISO);
    if (!isValid(start) || !isValid(end)) {
      return "N/A";
    }
    const diffMins = differenceInMinutes(end, start);
    if (diffMins < 0) return "Invalid";
    const hours = Math.floor(diffMins / 60);
    const minutes = diffMins % 60;
    return `${hours} hour${hours !== 1 ? "s" : ""}${minutes > 0 ? ` ${minutes} min${minutes !== 1 ? "s" : ""}` : ""}`;
  } catch {
    return "Error";
  }
}

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
      user_id,
      check_in_method,
      created_at,
      organization_name,
      project_id,
      schedule_id,
      issued_at,
      signup_id,
      volunteer_name,
      project_location,
      description,
      creator_username
    `,
    )
    .eq("id", recordId)
    .single();

  if (error || !record) {
    safeConsole.error("Error fetching volunteer record:", error);
    notFound(); // Show 404 if record not found or error occurs
  }

  // Type assertion after checking for null and converting to unknown first
  const data = record as unknown as CertificateData;

  // Determine if this is a self-reported certificate (default to verified for backward compatibility)
  const isSelfReported = data.type === "self-reported";

  // Calculate duration (this doesn't need timezone conversion)
  const durationText = formatDuration(data.event_start, data.event_end);

  // Prepare the certificate data for the print component
  const certificateData = {
    ...data,
    volunteer_email: null,
    durationText,
    creator_username: data.creator_username || null,
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
        data={data}
        durationText={durationText}
        isSelfReported={isSelfReported}
      />
    </div>
  );
}
