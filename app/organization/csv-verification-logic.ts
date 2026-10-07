import { safeConsole } from "@/lib/safe-console";

import type {
  CertificateRow,
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

export const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
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

  // Duration validation
  if (duration && isNaN(parseFloat(duration))) {
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

export const verifyCertificateId = async (
  certificateId: string,
  row: CertificateRow,
): Promise<CertificateRow | null> => {
  if (!certificateId) return null;

  try {
    // First do a basic verification to check if certificate exists
    const response = await fetch(
      `/api/certificates/verify/${encodeURIComponent(certificateId)}`,
    );
    const result: VerificationResult = await response.json();

    if (response.ok && result.valid && result.exists) {
      // Calculate hours from event duration
      let calculatedHours = 0;
      if (result.event?.startDate && result.event?.endDate) {
        const start = new Date(result.event.startDate);
        const end = new Date(result.event.endDate);
        calculatedHours =
          Math.round(
            ((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 10,
          ) / 10; // Round to 1 decimal
      }

      // Compare with CSV data
      const csvHours = row.duration ? parseFloat(row.duration) : 0;
      const hoursMatch = Math.abs(calculatedHours - csvHours) <= 0.1; // Allow 0.1h difference

      const titleMatch =
        result.project?.title?.toLowerCase() ===
        row.projectTitle?.toLowerCase();
      const organizerMatch =
        result.organizer?.name?.toLowerCase() ===
        row.organizerName?.toLowerCase();
      const statusMatch =
        result.certificate?.certified ===
        (row.certificationStatus === "Certified");
      // Handle backward compatibility: treat "verified" as equivalent to "platform"
      const resultType =
        (result.certificate?.type || "platform") === "verified"
          ? "platform"
          : result.certificate?.type || "platform";
      const csvType =
        (row.certificateType || "platform") === "verified"
          ? "platform"
          : row.certificateType || "platform";
      const typeMatch = resultType === csvType;

      // Update the row with verification result
      const updatedRow: CertificateRow = {
        ...row,
        verificationStatus: "verified",
        verificationResult: {
          ...result,
          verification: {
            timestamp: new Date().toISOString(),
            matches: {
              certificateId: true,
              title: titleMatch,
              organizer: organizerMatch,
              hours: hoursMatch,
              status: statusMatch,
              type: typeMatch,
            },
          },
        },
        isVerified:
          titleMatch &&
          organizerMatch &&
          hoursMatch &&
          statusMatch &&
          typeMatch,
      };

      return updatedRow;
    } else {
      return {
        ...row,
        verificationStatus: "failed",
        verificationResult: {
          valid: false,
          exists: false,
          error: result.error || "Certificate not found",
        },
        isVerified: false,
      };
    }
  } catch (error) {
    safeConsole.error("Error verifying certificate:", error);
    return {
      ...row,
      verificationStatus: "failed",
      verificationResult: {
        valid: false,
        exists: false,
        error: "Network error during verification",
      },
      isVerified: false,
    };
  }
};
