/** Every field of a row that is compared with the certificate record. */
export interface VerificationMatches {
  certificateId: boolean;
  title: boolean;
  organization: boolean;
  organizer: boolean;
  recipientName: boolean;
  recipientEmail: boolean;
  hours: boolean;
  status: boolean;
  type: boolean;
  location: boolean;
}

export interface VerificationResult {
  valid: boolean;
  /** False only when the lookup itself reported that no certificate exists. */
  exists?: boolean;
  /** True when the lookup failed and a later attempt may succeed. */
  retryable?: boolean;
  certificate?: {
    id: string;
    certified: boolean | null;
    issuedAt?: string | null;
    type?: string; // 'platform' or 'self-reported'
    recipient: {
      name: string | null;
      email: string | null;
    };
  };
  event?: {
    startDate: string;
    creditedMinutes?: number | null;
    endDate: string;
    /** Canonical hours for the certificate, as the dashboard exports them. */
    duration?: number | null;
  };
  project?: {
    id?: string | null;
    title: string;
    location: string | null;
  };
  organization?: {
    name: string | null;
  };
  organizer?: {
    id?: string | null;
    name: string | null;
  };
  verification?: {
    timestamp: string;
    matches?: VerificationMatches;
  };
  error?: string;
}

export interface CertificateRow {
  certificateId: string;
  projectTitle: string;
  organizationName: string;
  organizerName: string;
  certificationStatus: string;
  certificateType?: string; // 'platform' or 'self-reported'
  eventStartDate?: string;
  eventEndDate?: string;
  duration?: string;
  location?: string;
  issuedDate?: string;
  checkInMethod?: string;
  volunteerName?: string;
  volunteerEmail?: string;
  valid: boolean;
  issues: string[];
  /**
   * "verified" means the certificate was found and compared. "failed" means
   * the lookup answered without a usable certificate. "unavailable" means the
   * lookup could not answer, so nothing is known about the certificate.
   */
  verificationStatus?: "pending" | "verified" | "failed" | "unavailable";
  verificationResult?: VerificationResult;
  isVerified?: boolean;
}

export interface CsvVerificationSummary {
  total: number;
  certifiedHours: number; // Let's Assist OFFICIAL (from verified orgs)
  verifiedHours: number; // Let's Assist PLATFORM (from Let's Assist projects)
  selfReportedHours: number; // Self-Reported
  totalHours: number; // Total verified hours
  invalidFormat: number;
}

export type CsvVerificationStep = "upload" | "verify" | "results";
