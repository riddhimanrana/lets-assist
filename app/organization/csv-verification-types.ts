export interface VerificationResult {
  valid: boolean;
  exists: boolean;
  certificate?: {
    id: string;
    certified: boolean;
    issuedAt: string;
    type?: string; // 'platform' or 'self-reported'
    recipient: {
      name: string;
      email: string;
    };
  };
  event?: {
    startDate: string;
    creditedMinutes?: number | null;
    endDate: string;
  };
  project?: {
    id: string;
    title: string;
    location: string;
  };
  organization?: {
    name: string;
  };
  organizer?: {
    id: string;
    name: string;
  };
  verification?: {
    timestamp: string;
    matches?: {
      certificateId: boolean;
      title: boolean;
      organizer: boolean;
      hours: boolean;
      status: boolean;
      type: boolean;
    };
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
  verificationStatus?: "pending" | "verified" | "failed";
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
