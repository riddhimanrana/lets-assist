import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { notFound } from "next/navigation";
import { format, differenceInMinutes, parseISO, isValid } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  Clock,
  MapPin,
  Building2,
  User,
  ExternalLink,
  Award,
  QrCode,
  UserCheck,
  Clipboard,
  BadgeCheck,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CardContainer, CardBody, CardItem } from "@/components/ui/3d-card";
import { CertificateCardButton } from "./CertificateCardButton";
import Image from "next/image";
import { PrintCertificate } from "./PrintCertificate";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TimezoneDateDisplay,
  TimezoneEventDateRange,
} from "./TimezoneDateDisplay";
import { TimezoneDebugInfo } from "@/components/TimezoneDebugInfo";

// Define the expected shape of the fetched data based on the 'certificates' table
interface CertificateData {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "verified" | "self-reported"; // Optional for backward compatibility
  event_start: string; // Assuming ISO string format from Supabase
  event_end: string; // Assuming ISO string format from Supabase
  volunteer_email: string | null;
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
  creator_profile: { username: string | null } | null; // Updated to single object or null
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
  const supabase = await createClient();
  const { id } = await params;
  const { data: record } = await supabase
    .from("certificates")
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
  const supabase = await createClient();
  const { id: recordId } = await params;

  // Fetch certificate data directly from the 'certificates' table
  const { data: record, error } = await supabase
    .from("certificates")
    .select(
      `
      id,
      project_title,
      creator_name,
      is_certified,
      type,
      event_start,
      event_end,
      volunteer_email,
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
      creator_profile:profiles!certificates_creator_id_fkey (username) // Specified foreign key and alias
    `,
    )
    .eq("id", recordId)
    .single();

  if (error || !record) {
    console.error("Error fetching volunteer record:", error);
    notFound(); // Show 404 if record not found or error occurs
  }

  // Type assertion after checking for null and converting to unknown first
  const data = record as unknown as CertificateData;
  
  // Determine if this is a self-reported certificate (default to verified for backward compatibility)
  const isSelfReported = data.type === "self-reported";

  // Calculate duration (this doesn't need timezone conversion)
  const durationText = formatDuration(data.event_start, data.event_end);

  // Format ID for display
  const shortId = data.id.substring(0, 8);

  // Prepare the certificate data for the print component
  const certificateData = {
    ...data,
    durationText,
    creator_username: data.creator_profile?.username || null, // Adjusted to access single profile object
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isSelfReported ? "Self-Reported" : "Volunteer"} Certificate
          </h1>
          <p className="text-muted-foreground">
            {isSelfReported 
              ? "Self-reported volunteer activity record" 
              : "Official record of volunteer activity"
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSelfReported && (
            <Badge variant="secondary" className="px-3 py-1 bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              Self-Reported
            </Badge>
          )}
          <Badge variant="outline" className="px-3 py-1">
            ID: {shortId}
          </Badge>
        </div>
      </div>

      {/* Timezone Debug Info - Remove this after debugging */}
      {/* <TimezoneDebugInfo show={true} className="mb-6" /> */}

      <CardContainer className="py-8" containerClassName="w-full">
        <CardBody className={`relative h-auto w-full max-w-3xl rounded-xl border border-border/40 shadow-2xl ${
          isSelfReported 
            ? "bg-gradient-to-br from-gray-50 via-gray-100/50 to-gray-200/30 dark:from-gray-800/20 dark:via-gray-700/10 dark:to-gray-600/20" 
            : "bg-gradient-to-br from-background via-background to-muted"
        }`}>
          {/* Certificate Header with Glow Effect */}
          <CardItem
            translateZ={20}
            className={`w-full rounded-t-xl p-6 ${
              isSelfReported 
                ? "bg-gradient-to-r from-gray-200/40 via-gray-100/30 to-gray-50/20 dark:from-gray-700/30 dark:via-gray-600/20 dark:to-gray-500/10" 
                : "bg-gradient-to-r from-primary/10 via-primary/5 to-background"
            }`}
          >
            <div className="relative z-10">
              <div className="flex justify-between items-start">
                <div>
                  <CardItem translateZ={50} as="div">
                    <h2 className="text-2xl font-bold tracking-tight">
                      {data.project_title}
                    </h2>
                  </CardItem>
                  {data.organization_name && (
                    <CardItem
                      translateZ={40}
                      as="div"
                      className="flex items-center gap-1.5 mt-2 text-muted-foreground"
                    >
                      <Building2 className="h-4 w-4" />
                      <span className="text-sm">{data.organization_name}</span>
                    </CardItem>
                  )}
                  {data.creator_name && (
                    <CardItem
                      translateZ={40}
                      as="div"
                      className="flex items-center gap-2 mt-2 text-muted-foreground"
                      aria-label={`${isSelfReported ? "Supervised by" : "Issued by"} ${data.creator_name}`}
                    >
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
                        {isSelfReported ? "Supervised by" : "Issued by"}
                      </span>
                      <User
                        className={`h-4 w-4 ${isSelfReported ? "text-gray-600 dark:text-gray-400" : "text-primary"}`}
                        aria-hidden="true"
                      />
                      {isSelfReported ? (
                        <span className="text-sm font-semibold text-foreground">
                          {data.creator_name}
                        </span>
                      ) : (
                        <Link
                          href={`/profile/${certificateData.creator_username}`}
                          className="text-sm font-semibold text-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/60 rounded"
                          aria-label={`View profile of ${data.creator_name}`}
                        >
                          {data.creator_name}
                        </Link>
                      )}
                    </CardItem>
                  )}
                </div>
                {data.is_certified && (
                  <CardItem translateZ={60} as="div">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="secondary"
                            className="ml-auto backdrop-blur-sm bg-primary/10 border border-primary/20 text-chart-5"
                            tabIndex={0}
                            aria-label="Verified badge"
                          >
                            <BadgeCheck className="h-3.5 w-3.5 mr-1" /> Verified
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="max-w-xs"
                          aria-label="Verified badge explanation"
                        >
                          Verified badges mean this certificate comes from a
                          verified organization.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </CardItem>
                )}
              </div>
            </div>
          </CardItem>

          {/* Certificate Content */}
          <CardItem translateZ={30} className="px-6 py-8 space-y-8">
            {/* Volunteer Info Card */}
            <CardItem translateZ={60} className="w-full group">
              <div
                className="p-6 bg-gradient-to-r from-secondary/40 via-secondary/20 to-secondary/40
                backdrop-blur-sm rounded-lg border border-primary/10 shadow-sm
                group-hover:shadow-[0_0_25px_rgba(var(--primary)/0.15)] transition-all duration-300"
              >
                <CardItem
                  translateZ={60}
                  className="flex items-center gap-4 mb-4"
                >
                  <div
                    className="h-14 w-14 rounded-full bg-gradient-to-br from-primary/30 to-primary/10
                    flex items-center justify-center shadow-sm border border-primary/10"
                  >
                    <User className="h-7 w-7 text-primary/80" />
                  </div>
                  <div>
                    <p className="text-base font-semibold bg-gradient-to-r from-foreground to-foreground/90 bg-clip-text">
                      {data.volunteer_name || "Unnamed Volunteer"}
                    </p>
                    {data.volunteer_email && (
                      <p className="text-sm text-muted-foreground">
                        {data.volunteer_email}
                      </p>
                    )}
                  </div>
                </CardItem>

                <Separator className="my-4 opacity-30 bg-primary/10" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <CardItem
                    translateZ={50}
                    className="flex items-start gap-3 group/item"
                  >
                    <div
                      className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5
                      flex items-center justify-center shadow-sm border border-primary/10
                      group-hover/item:shadow-[0_0_15px_rgba(var(--primary)/0.2)] transition-all duration-300"
                    >
                      <Clock className="h-5 w-5 text-primary/80" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Duration
                      </p>
                      <p className="text-base font-semibold mt-0.5">
                        {durationText}
                      </p>
                    </div>
                  </CardItem>

                  <CardItem
                    translateZ={50}
                    className="flex items-start gap-3 group/item"
                  >
                    <div
                      className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5
                      flex items-center justify-center shadow-sm border border-primary/10
                      group-hover/item:shadow-[0_0_15px_rgba(var(--primary)/0.2)] transition-all duration-300"
                    >
                      <Calendar className="h-5 w-5 text-primary/80" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Date
                      </p>
                      <TimezoneEventDateRange
                        startDate={data.event_start}
                        endDate={data.event_end}
                      />
                    </div>
                  </CardItem>
                </div>

                {data.project_location && (
                  <CardItem
                    translateZ={50}
                    className="flex items-start gap-3 mt-6 group/item"
                  >
                    <div
                      className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5
                      flex items-center justify-center shadow-sm border border-primary/10
                      group-hover/item:shadow-[0_0_15px_rgba(var(--primary)/0.2)] transition-all duration-300"
                    >
                      <MapPin className="h-5 w-5 text-primary/80" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Location
                      </p>
                      <p className="text-base font-semibold mt-0.5">
                        {data.project_location}
                      </p>
                    </div>
                  </CardItem>
                )}

                {/* Description for self-reported certificates */}
                {isSelfReported && data.description && (
                  <CardItem
                    translateZ={50}
                    className="flex items-start gap-3 mt-6 group/item"
                  >
                    <div
                      className="h-10 w-10 rounded-lg bg-gradient-to-br from-gray-200/60 to-gray-100/30 dark:from-gray-600/40 dark:to-gray-700/20
                      flex items-center justify-center shadow-sm border border-gray-200/50 dark:border-gray-600/30
                      group-hover/item:shadow-[0_0_15px_rgba(156,163,175,0.2)] transition-all duration-300 flex-shrink-0"
                    >
                      <Clipboard className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Description
                      </p>
                      <p className="text-base font-semibold mt-0.5 leading-relaxed">
                        {data.description}
                      </p>
                    </div>
                  </CardItem>
                )}
              </div>
            </CardItem>

            {/* Certificate Footer */}
            <CardItem translateZ={20} className="w-full">
              <div
                className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2
                bg-gradient-to-r from-transparent via-secondary/10 to-transparent p-4 rounded-lg"
              >
                <div className="text-sm text-muted-foreground">
                  <p>
                    Record created:{" "}
                    <TimezoneDateDisplay
                      dateString={data.issued_at}
                      format="MMM d, yyyy"
                      className="text-foreground font-medium"
                      fallbackText="Loading..."
                    />
                  </p>
                  {!isSelfReported && (
                    <p className="mt-1 flex items-center">
                      Check-in method:{" "}
                      {data.check_in_method?.toLowerCase() === "qr-code" ? (
                        <QrCode className="mx-1 h-4 w-4 text-primary" />
                      ) : data.check_in_method?.toLowerCase() === "auto" ? (
                        <Clock className="mx-1 h-4 w-4 text-primary" />
                      ) : data.check_in_method?.toLowerCase() ===
                        "signup-only" ? (
                        <Clipboard className="mx-1 h-4 w-4 text-primary" />
                      ) : (
                        <UserCheck className="mx-1 h-4 w-4 text-primary" />
                      )}
                      <span className="text-foreground font-medium ml-1">
                        {data.check_in_method
                          ? data.check_in_method.toLowerCase() === "qr-code"
                            ? "QR Code"
                            : data.check_in_method.toLowerCase() === "auto"
                              ? "Automatic Check-in"
                              : data.check_in_method.toLowerCase() ===
                                    "signup only" ||
                                  data.check_in_method.toLowerCase() ===
                                    "signup-only"
                                ? "Signup Only"
                                : data.check_in_method
                          : "Manual"}
                      </span>
                    </p>
                  )}
                </div>

                {!isSelfReported && data.project_id && (
                  <CertificateCardButton projectId={data.project_id} />
                )}
              </div>
            </CardItem>
          </CardItem>

          {/* Subtle decorative elements */}
          <div className="absolute -top-2 -left-2 h-24 w-24 bg-primary/5 rounded-full blur-xl pointer-events-none"></div>
          <div className="flex justify-center items-center pb-6">
            <Image
              src="/logo.png"
              alt="Let's Assist Logo"
              width={26}
              height={26}
              className="mr-2"
            />
            <span className="text-base font-bold text-foreground">
              Let's Assist
            </span>
          </div>
        </CardBody>
      </CardContainer>

      <div className="mt-8 text-center">
        <p className="text-sm text-muted-foreground mb-1">
          {isSelfReported 
            ? "This is a self-reported record of volunteer hours logged by the user."
            : "This is an official record of volunteer hours from Let's Assist."
          }
        </p>
        <p className="text-xs text-muted-foreground">
          {isSelfReported ? "Record" : "Verification"} ID:{" "}
          <span className={`font-medium transition-colors ${
            isSelfReported 
              ? "text-muted-foreground/80 hover:text-muted-foreground" 
              : "text-primary/80 hover:text-primary"
          }`}>
            {data.id}
          </span>
        </p>
      </div>

      {/* Print Certificate Component */}
      <PrintCertificate data={certificateData} />
    </div>
  );
}
