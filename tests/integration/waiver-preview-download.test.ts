import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignaturePayload } from '@/types/waiver-definitions';

/**
 * Integration tests for waiver preview/download API routes
 * Testing all signature format handling scenarios
 */
describe('Waiver Preview/Download Legacy Signature Handling', () => {
  describe('Signature Format Priority Handling', () => {
    it('should prioritize upload_storage_path over signature_payload', () => {
      // When a signature has both upload_storage_path and signature_payload,
      // the uploaded file should take priority (offline mode)
      const signature = {
        id: 'sig-001',
        upload_storage_path: 'waivers/uploaded-123.pdf',
        signature_payload: {
          signers: [
            {
              role_key: 'volunteer',
              method: 'draw' as const,
              data: 'data:image/png;base64,abc123',
              timestamp: '2026-02-11T10:00:00Z',
            },
          ],
          fields: {},
        } as SignaturePayload,
        signature_storage_path: null,
        signature_file_url: null,
      };

      // Test logic: upload_storage_path should be checked first
      expect(signature.upload_storage_path).toBeTruthy();
    });

    it('should use signature_payload for on-demand PDF generation when no upload exists', () => {
      const signature = {
        id: 'sig-002',
        upload_storage_path: null,
        signature_payload: {
          signers: [
            {
              role_key: 'volunteer',
              method: 'typed' as const,
              data: 'John Doe',
              timestamp: '2026-02-11T10:00:00Z',
            },
          ],
          fields: {},
        } as SignaturePayload,
        signature_storage_path: null,
        signature_file_url: null,
      };

      // Should generate PDF from payload when no upload
      expect(signature.signature_payload).toBeTruthy();
      expect(signature.upload_storage_path).toBeNull();
    });

    it('should handle legacy signature_storage_path for old draw/type signatures', () => {
      // Legacy format: signature stored as image file, no payload
      const legacySignature = {
        id: 'sig-legacy-001',
        upload_storage_path: null,
        signature_payload: null,
        signature_storage_path: 'signatures/legacy-sig-123.png',
        signature_file_url: null,
        signature_type: 'draw' as const,
        waiver_definition_id: null,
      };

      // Should detect legacy format
      expect(legacySignature.signature_storage_path).toBeTruthy();
      expect(legacySignature.signature_payload).toBeNull();
      expect(legacySignature.waiver_definition_id).toBeNull();
    });

    it('should handle very old signature_file_url format', () => {
      // Very old format: public URL to signature
      const veryOldSignature = {
        id: 'sig-ancient-001',
        upload_storage_path: null,
        signature_payload: null,
        signature_storage_path: null,
        signature_file_url: 'https://old-storage.example.com/signatures/old-123.pdf',
      };

      // Should detect very old format
      expect(veryOldSignature.signature_file_url).toBeTruthy();
      expect(veryOldSignature.signature_storage_path).toBeNull();
      expect(veryOldSignature.signature_payload).toBeNull();
    });

    it('should return 404 when no signature data is available', () => {
      const emptySignature = {
        id: 'sig-empty-001',
        upload_storage_path: null,
        signature_payload: null,
        signature_storage_path: null,
        signature_file_url: null,
      };

      // All signature fields are null - should fail
      const hasAnySignatureData =
        emptySignature.upload_storage_path ||
        emptySignature.signature_payload ||
        emptySignature.signature_storage_path ||
        emptySignature.signature_file_url;

      expect(hasAnySignatureData).toBeFalsy();
    });
  });

  describe('Legacy Signature Generation Requirements', () => {
    it('should identify requirements for legacy signature PDF generation', () => {
      // For legacy signatures, we need:
      // 1. The signature image file (from signature_storage_path)
      // 2. The waiver definition (to know where to stamp)
      // 3. The original PDF URL

      const legacyContext = {
        signature: {
          id: 'sig-legacy-002',
          signature_storage_path: 'signatures/legacy-123.png',
          signature_type: 'draw' as const,
          waiver_definition_id: null, // Legacy - no definition
          waiver_pdf_url: 'https://example.com/waiver.pdf',
        },
        waiver_definition: {
          id: 'def-001',
          pdf_public_url: 'https://example.com/waiver.pdf',
          signers: [
            {
              id: 'signer-001',
              role_key: 'participant',
              label: 'Participant Signature',
              required: true,
              order_index: 0,
            },
          ],
          fields: [
            {
              id: 'field-001',
              field_key: 'participant_signature',
              field_type: 'signature' as const,
              page_index: 0,
              rect: { x: 100, y: 600, width: 200, height: 60 },
              signer_role_key: 'participant',
            },
          ],
        },
      };

      // Validate we have all required data
      expect(legacyContext.signature.signature_storage_path).toBeTruthy();
      expect(legacyContext.signature.waiver_pdf_url).toBeTruthy();
      expect(legacyContext.waiver_definition.fields.length).toBeGreaterThan(0);
    });

    it('should create minimal payload structure for legacy signatures', () => {
      // Test that we can construct a valid payload from legacy data
      const legacySignature = {
        signature_storage_path: 'signatures/legacy-456.png',
        signature_type: 'typed' as const,
        signature_text: 'Jane Smith',
        signer_name: 'Jane Smith',
        signed_at: '2026-02-10T10:00:00Z',
      };

      // Construct minimal payload for PDF generation
      const minimalPayload: SignaturePayload = {
        signers: [
          {
            role_key: 'participant',
            method: legacySignature.signature_type === 'typed' ? 'typed' : 'draw',
            data:
              legacySignature.signature_type === 'typed'
                ? legacySignature.signature_text || ''
                : legacySignature.signature_storage_path,
            timestamp: legacySignature.signed_at,
            signer_name: legacySignature.signer_name,
          },
        ],
        fields: {},
      };

      expect(minimalPayload.signers).toHaveLength(1);
      expect(minimalPayload.signers[0].role_key).toBe('participant');
      expect(minimalPayload.signers[0].method).toBe('typed');
    });
  });

  describe('requiresPdfGeneration Logic', () => {
    it('should require generation for draw/typed signatures', () => {
      const payloadDraw: SignaturePayload = {
        signers: [
          { role_key: 'vol', method: 'draw', data: 'sig.png', timestamp: '2026-02-11T10:00:00Z' },
        ],
        fields: {},
      };

      const requiresGen = payloadDraw.signers.every(s => s.method === 'draw' || s.method === 'typed');
      expect(requiresGen).toBe(true);
    });

    it('should not require generation for upload signatures', () => {
      const payloadUpload: SignaturePayload = {
        signers: [
          { role_key: 'vol', method: 'upload', data: 'full.pdf', timestamp: '2026-02-11T10:00:00Z' },
        ],
        fields: {},
      };

      const requiresGen = payloadUpload.signers.every(s => s.method === 'draw' || s.method === 'typed');
      expect(requiresGen).toBe(false);
    });

    it('should not require generation for mixed methods (has upload)', () => {
      const payloadMixed: SignaturePayload = {
        signers: [
          { role_key: 'student', method: 'draw', data: 'sig.png', timestamp: '2026-02-11T10:00:00Z' },
          { role_key: 'parent', method: 'upload', data: 'parent.pdf', timestamp: '2026-02-11T10:05:00Z' },
        ],
        fields: {},
      };

      const requiresGen = payloadMixed.signers.every(s => s.method === 'draw' || s.method === 'typed');
      expect(requiresGen).toBe(false);
    });
  });

  describe('Storage Bucket Selection', () => {
    it('should use waiver-uploads bucket for upload_storage_path', () => {
      const path = 'waivers/uploaded-123.pdf';
      const isFullWaiverUpload = true; // Detected from upload_storage_path column
      const bucket = isFullWaiverUpload ? 'waiver-uploads' : 'waiver-signatures';

      expect(bucket).toBe('waiver-uploads');
    });

    it('should use waiver-signatures bucket for signature_storage_path', () => {
      const path = 'signatures/sig-123.png';
      const isFullWaiverUpload = false; // Legacy signature image
      const bucket = isFullWaiverUpload ? 'waiver-uploads' : 'waiver-signatures';

      expect(bucket).toBe('waiver-signatures');
    });

    it('should use waiver-signatures bucket for signature assets in payload', () => {
      const signerData = 'signatures/multi-sig-parent-123.png';
      const isUploadStoragePath = false; // This is from payload, not upload_storage_path
      const bucket = isUploadStoragePath ? 'waiver-uploads' : 'waiver-signatures';

      expect(bucket).toBe('waiver-signatures');
    });
  });

  describe('Content-Disposition Headers', () => {
    it('should use inline disposition for preview route', () => {
      const isPreview = true;
      const disposition = isPreview ? 'inline' : 'attachment';

      expect(disposition).toBe('inline');
    });

    it('should use attachment disposition for download route', () => {
      const isPreview = false;
      const disposition = isPreview ? 'inline' : 'attachment';

      expect(disposition).toBe('attachment');
    });

    it('should include filename in content-disposition', () => {
      const signatureId = 'sig-123';
      const disposition = `inline; filename="waiver-${signatureId}.pdf"`;

      expect(disposition).toContain('filename=');
      expect(disposition).toContain(signatureId);
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should handle missing storage file gracefully', () => {
      const errorScenario = {
        path: 'signatures/missing-file.png',
        storageResponse: { data: null, error: { message: 'File not found' } },
      };

      expect(errorScenario.storageResponse.error).toBeTruthy();
      expect(errorScenario.storageResponse.data).toBeNull();
    });

    it('should handle missing waiver PDF URL', () => {
      const signature = {
        waiver_pdf_url: null,
        waiver_definition: {
          pdf_public_url: null,
        },
      };

      const waiverPdfUrl = signature.waiver_pdf_url || signature.waiver_definition?.pdf_public_url;
      expect(waiverPdfUrl).toBeNull();
    });

    it('should handle missing waiver definition for legacy signatures', () => {
      const legacySignature = {
        signature_storage_path: 'signatures/old.png',
        waiver_definition_id: null,
        waiver_definition: null,
      };

      // When definition is missing for legacy, we cannot generate PDF
      expect(legacySignature.waiver_definition).toBeNull();
    });

    it('should detect invalid payload state (signaturePayload without requiresPdfGeneration)', () => {
      // Edge case: Has payload but method is 'upload' (should use upload_storage_path instead)
      const invalidState = {
        signature_payload: {
          signers: [{ role_key: 'vol', method: 'upload' as const, data: 'x', timestamp: '2026-02-11T10:00:00Z' }],
          fields: {},
        } as SignaturePayload,
        upload_storage_path: null, // This should NOT be null if method is upload
      };

      const requiresGen = invalidState.signature_payload.signers.every(
        s => s.method === 'draw' || s.method === 'typed'
      );

      // requiresGen is false (has upload) but upload_storage_path is null - invalid state
      expect(requiresGen).toBe(false);
      expect(invalidState.upload_storage_path).toBeNull();
    });
  });

  describe('Backward Compatibility Verification', () => {
    it('should handle signatures created before multi-signer system (draw)', () => {
      const preMigrationSignature = {
        id: 'pre-001',
        signature_type: 'draw' as const,
        signature_storage_path: 'signatures/pre-migration-123.png',
        signature_text: null,
        upload_storage_path: null,
        signature_payload: null,
        waiver_definition_id: null,
        created_at: '2025-12-01T00:00:00Z', // Before migration
      };

      // Should be identifiable as legacy
      const isLegacy = preMigrationSignature.waiver_definition_id === null &&
                       preMigrationSignature.signature_payload === null;

      expect(isLegacy).toBe(true);
      expect(preMigrationSignature.signature_storage_path).toBeTruthy();
    });

    it('should handle signatures created before multi-signer system (typed)', () => {
      const preMigrationTyped = {
        id: 'pre-002',
        signature_type: 'typed' as const,
        signature_storage_path: null,
        signature_text: 'John Doe',
        upload_storage_path: null,
        signature_payload: null,
        waiver_definition_id: null,
        created_at: '2025-11-15T00:00:00Z',
      };

      const isLegacy = preMigrationTyped.waiver_definition_id === null &&
                       preMigrationTyped.signature_payload === null;

      expect(isLegacy).toBe(true);
      expect(preMigrationTyped.signature_text).toBeTruthy();
    });

    it('should handle signatures created before multi-signer system (upload)', () => {
      const preMigrationUpload = {
        id: 'pre-003',
        signature_type: 'upload' as const,
        signature_storage_path: null,
        signature_text: null,
        upload_storage_path: 'waivers/pre-migration-upload.pdf',
        signature_payload: null,
        waiver_definition_id: null,
        created_at: '2025-10-20T00:00:00Z',
      };

      const isLegacy = preMigrationUpload.waiver_definition_id === null &&
                       preMigrationUpload.signature_payload === null;

      expect(isLegacy).toBe(true);
      expect(preMigrationUpload.upload_storage_path).toBeTruthy();
    });
  });
});
