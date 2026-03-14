import type { SignaturePayload } from '@/types/waiver-definitions';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

interface WaiverDefinitionForValidation {
  id: string;
  signers?: Array<{
    role_key: string;
    label: string;
    required: boolean;
  }>;
  fields?: Array<{
    field_key: string;
    field_type: string;
    label: string;
    required: boolean;
  }>;
}

/**
 * Validates a signature payload against a waiver definition.
 * Ensures all required signers have completed signatures.
 * 
 * Phase 1 Fix Issue 2: Added strictFieldValidation parameter
 * When false (default), only validates signature requirements.
 * When true, also validates required non-signature fields.
 * This allows Phase 1-3 signups to work before Phase 4 UI implements field collection.
 * 
 * @param payload - The signature payload to validate
 * @param definition - The waiver definition with requirements
 * @param strictFieldValidation - Whether to enforce required non-signature fields (default: false)
 */
export function validateWaiverPayload(
  payload: SignaturePayload,
  definition: WaiverDefinitionForValidation,
  strictFieldValidation: boolean = false
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check 1: All required signers have signatures
  const requiredSigners = definition.signers?.filter(s => s.required) || [];
  const providedRoleKeys = new Set(payload.signers.map(s => s.role_key));

  for (const requiredSigner of requiredSigners) {
    if (!providedRoleKeys.has(requiredSigner.role_key)) {
      errors.push(`Required signature missing for: ${requiredSigner.label}`);
    }
  }

  // Check 2: Each signature has valid data
  for (const signer of payload.signers) {
    if (!signer.method || !['draw', 'typed', 'upload'].includes(signer.method)) {
      errors.push(`Invalid signature method for ${signer.role_key}`);
    }
    if (!signer.data || signer.data.length === 0) {
      errors.push(`Empty signature data for ${signer.role_key}`);
    }
    if (!signer.timestamp) {
      warnings.push(`Missing timestamp for ${signer.role_key}`);
    }
  }

  // Check 3: Required non-signature fields (only if strictFieldValidation is true)
  // Phase 1-3: Skip this check since UI doesn't collect these fields yet
  // Phase 4: Enable this when UI implements field collection
  if (strictFieldValidation) {
    const requiredFields = definition.fields?.filter(f => f.required && f.field_type !== 'signature') || [];
    for (const field of requiredFields) {
      if (!payload.fields || !payload.fields[field.field_key]) {
        errors.push(`Required field missing: ${field.label}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

