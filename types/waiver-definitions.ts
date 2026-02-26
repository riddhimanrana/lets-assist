/**
 * Type definitions for the Waiver Definitions System
 * Phase 1: Database Schema Types
 * 
 * These types represent the new waiver definitions system that supports
 * multiple signers, field placements, and backward compatibility with
 * the existing waiver system.
 */

// ============================================================================
// Core Enums
// ============================================================================

export type WaiverDefinitionScope = 'project' | 'global';
export type WaiverDefinitionSource = 'project_pdf' | 'global_pdf' | 'rich_text';
export type WaiverFieldType = 'signature' | 'name' | 'date' | 'email' | 'phone' | 'address' | 'text' | 'checkbox' | 'radio' | 'dropdown' | 'initial';
export type WaiverFieldSource = 'pdf_widget' | 'custom_overlay';

// ============================================================================
// Database Table Types
// ============================================================================

/**
 * Waiver Definition
 * Represents a configured waiver template (project-specific or global)
 */
export interface WaiverDefinition {
  id: string;
  scope: WaiverDefinitionScope;
  project_id: string | null;
  title: string;
  version: number;
  active: boolean;
  pdf_storage_path: string | null;
  pdf_public_url: string | null;
  source: WaiverDefinitionSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Waiver Definition Signer
 * Defines signer roles (Volunteer, Student, Parent/Guardian, etc.)
 */
export interface WaiverDefinitionSigner {
  id: string;
  waiver_definition_id: string;
  role_key: string;
  label: string;
  required: boolean;
  order_index: number;
  rules: SignerRules | null;
  created_at: string;
  updated_at: string;
}

/**
 * Signer Rules (stored in JSONB)
 * Optional rules for a signer role
 */
export interface SignerRules {
  minAge?: number;
  maxAge?: number;
  requireRelationship?: boolean;
  relationshipTypes?: string[];
  documentTypes?: string[];
  [key: string]: unknown; // Allow additional properties
}

/**
 * Waiver Definition Field
 * Defines signature placements and form fields within a waiver
 */
export interface WaiverDefinitionField {
  id: string;
  waiver_definition_id: string;
  field_key: string;
  field_type: WaiverFieldType;
  label: string;
  required: boolean;
  source: WaiverFieldSource;
  pdf_field_name: string | null;
  page_index: number;
  rect: FieldRect;
  signer_role_key: string | null;
  meta: FieldMeta | null;
  created_at: string;
  updated_at: string;
}

/**
 * Field Rectangle (stored in JSONB)
 * Coordinates for field placement on PDF page
 */
export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Field Metadata (stored in JSONB)
 * Additional configuration for form fields
 */
export interface FieldMeta {
  // For dropdown/radio fields
  options?: string[];
  defaultValue?: string | boolean | string[];
  
  // For text fields
  placeholder?: string;
  maxLength?: number;
  pattern?: string;
  
  // For date fields
  minDate?: string;
  maxDate?: string;
  
  // For signature fields
  signatureFormat?: 'png' | 'svg';
  signatureWidth?: number;
  signatureHeight?: number;
  
  [key: string]: unknown; // Allow additional properties
}

// ============================================================================
// Extended Table Types (Backward Compatibility)
// ============================================================================

/**
 * Extended Project type with waiver definition reference
 */
export interface ProjectWithWaiverDefinition {
  // ... existing project fields
  waiver_definition_id: string | null; // NEW: Reference to waiver definition
}

/**
 * Extended Waiver Signature with new fields
 */
export interface WaiverSignatureExtended {
  // Existing fields
  id: string;
  waiver_template_id: string;
  waiver_pdf_url: string | null;
  project_id: string;
  signup_id: string;
  user_id: string | null;
  anonymous_id: string | null;
  signer_name: string;
  signer_email: string;
  signature_type: 'draw' | 'typed' | 'upload';
  signature_text: string | null;
  signature_storage_path: string | null;
  upload_storage_path: string | null;
  form_data: Record<string, unknown> | null;
  signed_at: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  
  // NEW fields for multi-signer system
  waiver_definition_id: string | null;
  signature_payload: SignaturePayload | null;
}

/**
 * Signature Payload (stored in JSONB)
 * Contains multi-signer signature data for on-demand PDF generation
 */
export interface SignaturePayload {
  signers: SignerData[];
  fields: Record<string, string | boolean | string[]>;
}

/**
 * Individual Signer Data
 */
export interface SignerData {
  role_key: string;
  method: 'draw' | 'typed' | 'upload';
  data: string; // Base64 encoded signature image or typed text
  timestamp: string;
  signer_name?: string;
  signer_email?: string;
}

// ============================================================================
// API/Form Types
// ============================================================================

/**
 * Input type for creating a waiver definition
 */
export interface CreateWaiverDefinitionInput {
  scope: WaiverDefinitionScope;
  project_id?: string;
  title: string;
  source: WaiverDefinitionSource;
  pdf_file?: File;
  rich_text_content?: string;
}

/**
 * Input type for adding a signer to a waiver definition
 */
export interface AddWaiverSignerInput {
  waiver_definition_id: string;
  role_key: string;
  label: string;
  required?: boolean;
  order_index?: number;
  rules?: SignerRules;
}

/**
 * Input type for adding a field to a waiver definition
 */
export interface AddWaiverFieldInput {
  waiver_definition_id: string;
  field_key: string;
  field_type: WaiverFieldType;
  label: string;
  required?: boolean;
  source: WaiverFieldSource;
  pdf_field_name?: string;
  page_index: number;
  rect: FieldRect;
  signer_role_key?: string;
  meta?: FieldMeta;
}

/**
 * Complete waiver definition with signers and fields
 */
export interface WaiverDefinitionFull extends WaiverDefinition {
  signers: WaiverDefinitionSigner[];
  fields: WaiverDefinitionField[];
}

/**
 * Input for submitting a multi-signer waiver
 */
export interface SubmitWaiverInput {
  waiver_definition_id: string;
  project_id: string;
  signup_id: string;
  signers: {
    role_key: string;
    method: 'draw' | 'typed' | 'upload';
    data: string; // Base64 for draw/upload, text for typed
    signer_name?: string;
    signer_email?: string;
  }[];
  fields: Record<string, string | boolean | string[]>;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Type guard to check if a waiver signature uses the new system
 */
export function isNewWaiverSystem(signature: WaiverSignatureExtended): boolean {
  return signature.waiver_definition_id !== null && signature.signature_payload !== null;
}

// ============================================================================
// Builder/UI Types
// ============================================================================

export interface WaiverBuilderSigner {
  roleKey: string;
  label: string;
  required: boolean;
  orderIndex: number;
}

export interface WaiverBuilderFieldMapping {
  signerRoleKey: string;
  required: boolean;
  fieldKey?: string;
  label?: string;
  fieldType?: WaiverFieldType;
  pageIndex?: number;
  rect?: FieldRect;
  pdfFieldName?: string;
}

export interface WaiverBuilderCustomPlacement {
  id: string;
  label: string;
  fieldType: WaiverFieldType;
  signerRoleKey: string;
  required: boolean;
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface WaiverBuilderDefinition {
  signers: WaiverBuilderSigner[];
  fields: {
    detected: Record<string, WaiverBuilderFieldMapping>;
    custom: WaiverBuilderCustomPlacement[];
  };
}
