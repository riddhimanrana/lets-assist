export type ContactImportRole = "staff" | "member";

export type ContactImportFileType = "csv" | "xlsx" | "xls";

export type ContactImportJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type ContactImportRowStatus = "pending" | "invited" | "skipped" | "failed";
export type ContactImportMode = "job" | "direct";

export interface ContactImportParsedRow {
  rowNumber: number;
  email: string;
  fullName: string | null;
  profileData: Record<string, string>;
}

export interface ContactImportInvalidRow {
  rowNumber: number;
  email: string | null;
  reason: string;
}

export interface ContactImportParseSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  skippedEmptyRows: number;
}

export interface OrganizationContactImportJob {
  id: string;
  organization_id: string;
  created_by: string | null;
  source_file_name: string;
  source_file_type: ContactImportFileType;
  role: ContactImportRole;
  status: ContactImportJobStatus;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  processed_rows: number;
  successful_invites: number;
  failed_invites: number;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationContactImportRow {
  id: string;
  job_id: string;
  organization_id: string;
  row_number: number;
  email: string;
  full_name: string | null;
  profile_data: Record<string, string> | null;
  status: ContactImportRowStatus;
  error: string | null;
  invitation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactImportCreateResponse {
  success: boolean;
  mode?: ContactImportMode;
  job?: OrganizationContactImportJob;
  parseSummary?: ContactImportParseSummary;
  invalidRowsPreview?: ContactImportInvalidRow[];
  directResult?: {
    total: number;
    successful: number;
    failed: number;
    results: Array<{
      email: string;
      success: boolean;
      error?: string;
      invitationId?: string;
    }>;
  };
  message?: string;
  error?: string;
}

export interface ContactImportProcessResponse {
  success: boolean;
  job?: OrganizationContactImportJob;
  batch?: {
    processed: number;
    invited: number;
    skipped: number;
    failed: number;
  };
  failedRowsPreview?: Array<Pick<OrganizationContactImportRow, "row_number" | "email" | "error" | "status">>;
  error?: string;
}
