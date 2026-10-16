import { encodeCsvField, parseCsv } from "@/lib/certificates/csv";
import { safeConsole } from "@/lib/safe-console";

import type {
  CertificateRow,
  VerificationMatches,
  VerificationResult,
} from "./csv-verification-types";

// Helper function to format hours from decimal to "Xh Ym" format
export const formatHours = (decimalHours: number): string => {
  if (decimalHours === 0) return "0h";

  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);

  if (hours === 0) {
    return `${minutes}m`;
  } else if (minutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${minutes}m`;
  }
};

const EXPECTED_HEADERS = [
  "certificate id",
  "project title",
  "organization name",
  "project organizer name",
  "certification status",
  "certificate type",
  "event start date",
  "event end date",
  "duration",
  "location",
  "check in method",
  "volunteer name",
  "volunteer email",
  "issued date",
];

const DECIMAL_HOURS = /^\d+(?:\.\d+)?$/u;

/**
 * Reads a duration cell as plain decimal hours. The whole cell has to be the
 * number: "1garbage", "1e3", "-1", "Infinity", and a blank cell are all
 * refused rather than read as far as they parse.
 */
export const parseStrictHours = (
  value: string | null | undefined,
): number | null => {
  const text = value?.trim() ?? "";
  if (!DECIMAL_HOURS.test(text)) return null;

  const hours = Number(text);
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
};

export const validateCertificateRow = (
  row: string[],
  _headers: string[],
): CertificateRow => {
  const issues: string[] = [];
  const certificateId = row[0]?.trim() || "";
  const projectTitle = row[1]?.trim() || "";
  const organizationName = row[2]?.trim() || "";
  const organizerName = row[3]?.trim() || "";
  const certificationStatus = row[4]?.trim() || "";
  const certificateType = row[5]?.trim() || ""; // New: 'platform' or 'self-reported'
  const eventStartDate = row[6]?.trim() || "";
  const eventEndDate = row[7]?.trim() || "";
  const duration = row[8]?.trim() || "";
  const location = row[9]?.trim() || "";
  const checkInMethod = row[10]?.trim() || "";
  const volunteerName = row[11]?.trim() || "";
  const volunteerEmail = row[12]?.trim() || "";
  const issuedDate = row[13]?.trim() || "";

  // Validation rules
  if (!certificateId) issues.push("Missing certificate ID");
  if (!projectTitle) issues.push("Missing project title");
  if (!organizerName) issues.push("Missing organizer name");
  if (!certificationStatus) issues.push("Missing certification status");

  // Check for valid ID format (UUID or similar)
  if (certificateId && !/^[A-Za-z0-9\-_]+$/.test(certificateId)) {
    issues.push("Invalid certificate ID format");
  }

  // Check for minimum title length
  if (projectTitle && projectTitle.length < 3) {
    issues.push("Project title too short");
  }

  // Check for valid organizer name
  if (organizerName && organizerName.length < 2) {
    issues.push("Invalid organizer name");
  }

  // Check certification status
  if (
    certificationStatus &&
    !["Certified", "Participated"].includes(certificationStatus)
  ) {
    issues.push(
      'Invalid certification status (must be "Certified" or "Participated")',
    );
  }

  // Check certificate type (allow both old and new terminology for backward compatibility)
  if (
    certificateType &&
    !["platform", "verified", "self-reported"].includes(certificateType)
  ) {
    issues.push(
      'Invalid certificate type (must be "platform", "verified", or "self-reported")',
    );
  }

  // Date validation if provided
  if (eventStartDate) {
    const date = new Date(eventStartDate);
    if (isNaN(date.getTime())) {
      issues.push("Invalid event start date format");
    }
  }

  if (eventEndDate) {
    const date = new Date(eventEndDate);
    if (isNaN(date.getTime())) {
      issues.push("Invalid event end date format");
    }
  }

  if (issuedDate) {
    const date = new Date(issuedDate);
    if (isNaN(date.getTime())) {
      issues.push("Invalid issued date format");
    }
  }

  // Duration validation. Every exported row carries its hours, so a row
  // without them cannot be compared.
  if (!duration) {
    issues.push("Missing duration");
  } else if (parseStrictHours(duration) === null) {
    issues.push("Invalid duration format");
  }

  return {
    certificateId,
    projectTitle,
    organizationName,
    organizerName,
    certificationStatus,
    certificateType,
    eventStartDate,
    eventEndDate,
    duration,
    location,
    checkInMethod,
    volunteerName,
    volunteerEmail,
    issuedDate,
    valid: issues.length === 0,
    issues,
  };
};

const SUMMARY_MARKERS = ["=== SUMMARY ===", "===SUMMARY==="];

/**
 * The reserved record that starts a summary section: the marker alone in the
 * first cell and nothing else. A certificate whose title, name, or location
 * merely contains the marker text is an ordinary row.
 */
const isSummaryMarker = (record: string[]): boolean =>
  SUMMARY_MARKERS.includes(record[0]?.trim() ?? "") &&
  record.slice(1).every((cell) => cell.trim() === "");

/**
 * Reads an uploaded export into rows. Records are split by the shared CSV
 * parser, so a line break inside a quoted field stays inside its row. Reading
 * stops at the summary section some exports end with.
 */
export const parseCertificateCsv = (
  text: string,
): { rows: CertificateRow[] } | { error: string } => {
  const records = parseCsv(text).filter((record) =>
    record.some((cell) => cell.trim()),
  );

  if (records.length < 2) {
    return {
      error: "CSV file must contain at least a header row and one data row",
    };
  }

  const headers = records[0];

  // Check if required headers are present (case insensitive)
  const hasRequiredHeaders = EXPECTED_HEADERS.every((expected) =>
    headers.some((header) => header.toLowerCase().includes(expected)),
  );

  if (!hasRequiredHeaders) {
    return {
      error:
        "CSV must contain the expected certificate columns: Certificate ID, Project Title, Organization Name, Project Organizer Name, Certification Status, Certificate Type, Event Start Date, Event End Date, Duration, Location, Check In Method, Volunteer Name, Volunteer Email, Issued Date",
    };
  }

  const rows: CertificateRow[] = [];
  for (const record of records.slice(1)) {
    // Stop processing when we hit the summary section
    if (isSummaryMarker(record)) break;
    rows.push(validateCertificateRow(record, headers));
  }

  return { rows };
};

// What the dashboard export (app/dashboard/_components/ExportSection.tsx)
// writes when the certificate record leaves a field empty.
const UNKNOWN_PROJECT = "Unknown Project";
const UNKNOWN_ORGANIZATION = "Unknown Organization";
const UNKNOWN_SUPERVISOR = "Unknown Supervisor";
const UNKNOWN_VOLUNTEER = "Unknown Volunteer";
const UNKNOWN_LOCATION = "Unknown Location";

/** Spreadsheets round a long decimal to 15 digits; nothing larger is allowed. */
const HOURS_EPSILON = 1e-9;

/**
 * The cell the export writes for a recorded value, as the checker reads it:
 * encoded for spreadsheet safety first, then trimmed like every uploaded cell.
 */
const exportedCell = (recorded: string): string =>
  encodeCsvField(recorded).trim();

/**
 * Names, titles, and places are compared exactly with the exported cell: case,
 * punctuation, quotes, inner whitespace, and the protective apostrophe all
 * count. Only surrounding whitespace is ignored.
 */
const sameText = (
  recorded: string,
  supplied: string | null | undefined,
): boolean => exportedCell(recorded) === (supplied ?? "").trim();

/** Email addresses and certificate IDs are compared without regard to case. */
const caseless = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

/** "verified" is the old name for "platform". */
const canonicalType = (type: string | null | undefined): string => {
  const value = (type ?? "").trim() || "platform";
  return value === "verified" ? "platform" : value;
};

/** The certificate's hours as the lookup reports them, or null if unusable. */
export const authoritativeHours = (
  result: VerificationResult | undefined,
): number | null => {
  const duration = result?.event?.duration;
  return typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration >= 0
    ? duration
    : null;
};

/** Compares each identifying field of a row with the certificate record. */
export const compareCertificateRow = (
  row: CertificateRow,
  result: VerificationResult,
): VerificationMatches => {
  const recordedHours = authoritativeHours(result);
  const suppliedHours = parseStrictHours(row.duration);
  const organizerName = result.organizer?.name;
  const storedEmail = result.certificate?.recipient?.email ?? "";
  const recordedEmail =
    storedEmail.trim() === "" ? "" : exportedCell(storedEmail).toLowerCase();

  return {
    certificateId:
      caseless(result.certificate?.id) === caseless(row.certificateId),
    title: sameText(result.project?.title || UNKNOWN_PROJECT, row.projectTitle),
    organization: sameText(
      result.organization?.name || organizerName || UNKNOWN_ORGANIZATION,
      row.organizationName,
    ),
    organizer: sameText(organizerName || UNKNOWN_SUPERVISOR, row.organizerName),
    recipientName: sameText(
      result.certificate?.recipient?.name || UNKNOWN_VOLUNTEER,
      row.volunteerName,
    ),
    // A record with no email cannot confirm any address, so the row's email
    // is reported as unmatched rather than accepted unseen. The export fills
    // that cell from the signed-in account, which this lookup never sees.
    recipientEmail:
      recordedEmail !== "" && recordedEmail === caseless(row.volunteerEmail),
    hours:
      recordedHours !== null &&
      suppliedHours !== null &&
      Math.abs(recordedHours - suppliedHours) <= HOURS_EPSILON,
    status:
      Boolean(result.certificate?.certified) ===
      (row.certificationStatus === "Certified"),
    type:
      canonicalType(result.certificate?.type) ===
      canonicalType(row.certificateType),
    location: sameText(
      result.project?.location || UNKNOWN_LOCATION,
      row.location,
    ),
  };
};

const unavailableRow = (
  row: CertificateRow,
  error: string,
): CertificateRow => ({
  ...row,
  verificationStatus: "unavailable",
  verificationResult: { valid: false, retryable: true, error },
  isVerified: false,
});

const UNAVAILABLE_MESSAGE =
  "Verification is temporarily unavailable. This certificate was not checked; try again.";

export const verifyCertificateId = async (
  certificateId: string,
  row: CertificateRow,
): Promise<CertificateRow | null> => {
  if (!certificateId) return null;

  let response: Response;
  try {
    response = await fetch(
      `/api/certificates/verify/${encodeURIComponent(certificateId)}`,
    );
  } catch (error) {
    safeConsole.error("Error verifying certificate:", error);
    return unavailableRow(row, UNAVAILABLE_MESSAGE);
  }

  let result: VerificationResult | null = null;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") result = body as VerificationResult;
  } catch {
    result = null;
  }

  // Only an explicit answer says a certificate does not exist. A server
  // failure, a rate limit, or an unreadable body says nothing about it.
  if (
    !result ||
    response.status >= 500 ||
    response.status === 429 ||
    (!response.ok && result.retryable === true)
  ) {
    return unavailableRow(row, UNAVAILABLE_MESSAGE);
  }

  if (!response.ok || !result.valid || result.exists === false) {
    const notFound = result.exists === false;
    return {
      ...row,
      verificationStatus: "failed",
      verificationResult: {
        valid: false,
        ...(notFound ? { exists: false } : {}),
        error:
          result.error ||
          (notFound
            ? "Certificate not found"
            : "This certificate could not be checked"),
      },
      isVerified: false,
    };
  }

  const matches = compareCertificateRow(row, result);

  return {
    ...row,
    verificationStatus: "verified",
    verificationResult: {
      ...result,
      verification: {
        timestamp: new Date().toISOString(),
        matches,
      },
    },
    isVerified: Object.values(matches).every(Boolean),
  };
};

export type VerifiedHoursSummary = {
  certifiedHours: number;
  verifiedHours: number;
  selfReportedHours: number;
  totalHours: number;
};

/**
 * Totals the hours of fully verified rows from the certificate records, never
 * from the uploaded cells.
 */
export const summarizeVerifiedHours = (
  rows: CertificateRow[],
): VerifiedHoursSummary => {
  const summary: VerifiedHoursSummary = {
    certifiedHours: 0, // Let's Assist OFFICIAL (from verified orgs)
    verifiedHours: 0, // Let's Assist PLATFORM (from Let's Assist projects)
    selfReportedHours: 0, // Self-Reported
    totalHours: 0,
  };

  for (const row of rows) {
    if (!row.isVerified) continue;
    const hours = authoritativeHours(row.verificationResult);
    if (hours === null) continue;

    const type = canonicalType(row.verificationResult?.certificate?.type);
    if (type === "platform" && row.verificationResult?.certificate?.certified) {
      summary.certifiedHours += hours;
    } else if (type === "platform") {
      summary.verifiedHours += hours;
    } else if (type === "self-reported") {
      summary.selfReportedHours += hours;
    }
    summary.totalHours += hours;
  }

  return summary;
};
