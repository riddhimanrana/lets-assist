export type WaiverSignatureType = "draw" | "typed" | "upload";

export interface WaiverTemplate {
  id: string;
  title: string;
  content: string;
  version: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WaiverSignature {
  id: string;
  waiver_template_id: string;
  waiver_pdf_url?: string | null;
  project_id: string;
  signup_id: string;
  user_id?: string | null;
  anonymous_id?: string | null;
  signer_name: string;
  signer_email: string;
  signature_type: WaiverSignatureType;
  signature_text?: string | null;
  signature_storage_path?: string | null;
  upload_storage_path?: string | null;
  form_data?: Record<string, unknown> | null;
  signed_at: string;
  ip_address?: string | null;
  user_agent?: string | null;
  expires_at: string;
  created_at: string;
}

export interface WaiverSignatureInput {
  templateId: string;
  signatureType: WaiverSignatureType;
  signatureText?: string;
  signatureImageDataUrl?: string;
  uploadFileDataUrl?: string;
  uploadFileName?: string;
  uploadFileType?: string;
  signerName?: string;
  signerEmail?: string;
  waiverPdfUrl?: string;
  formData?: Record<string, string | boolean | string[]>;
}

// Project waiver configuration
export interface ProjectWaiverConfig {
  waiverRequired: boolean;
  waiverAllowUpload: boolean;
  waiverPdfUrl?: string | null;
  waiverPdfStoragePath?: string | null;
}

// Waiver PDF validation result
export interface WaiverPdfValidation {
  valid: boolean;
  hasSignatureFields: boolean;
  pageCount: number;
  fileSize: number;
  warnings: string[];
  errors: string[];
}
