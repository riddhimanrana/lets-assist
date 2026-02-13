import { describe, it, expect } from 'vitest';
import { validateWaiverPayload } from '@/lib/waiver/validate-waiver-payload';
import type { SignaturePayload } from '@/types/waiver-definitions';

/**
 * Integration tests for the complete waiver system flow.
 * These tests validate end-to-end scenarios combining multiple components.
 */
describe('Waiver System Integration Tests', () => {
  describe('Complete Single-Signer Flow', () => {
    it('should validate complete single-signer waiver workflow', () => {
      // Simulates: Organizer creates waiver → Volunteer signs → System validates
      const definition = {
        id: 'def-integration-single',
        scope: 'project' as const,
        project_id: 'proj-int-001',
        title: 'Volunteer Waiver',
        version: 1,
        active: true,
        pdf_storage_path: '/waivers/volunteer.pdf',
        pdf_public_url: 'https://example.com/volunteer.pdf',
        source: 'project_pdf' as const,
        created_by: 'organizer-123',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        signers: [
          {
            id: 'signer-vol-1',
            waiver_definition_id: 'def-integration-single',
            role_key: 'volunteer',
            label: 'Volunteer',
            required: true,
            order_index: 0,
            rules: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
        fields: [
          {
            id: 'field-sig-vol',
            waiver_definition_id: 'def-integration-single',
            field_key: 'volunteer_signature',
            field_type: 'signature' as const,
            label: 'Your Signature',
            required: true,
            source: 'custom_overlay' as const,
            pdf_field_name: null,
            page_index: 0,
            rect: { x: 100, y: 650, width: 250, height: 60 },
            signer_role_key: 'volunteer',
            meta: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
      };

      const payload: SignaturePayload = {
        signers: [
          {
            role_key: 'volunteer',
            method: 'draw',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T10:30:00Z',
            signer_name: 'Alex Volunteer',
            signer_email: 'alex@example.com',
          },
        ],
        fields: {},
      };

      const result = validateWaiverPayload(payload, definition);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Complete Multi-Signer Flow (Student + Parent)', () => {
    it('should validate complete multi-signer waiver workflow', () => {
      // Simulates: Youth program requiring both student and parent signatures
      const definition = {
        id: 'def-integration-multi',
        scope: 'project' as const,
        project_id: 'proj-int-002',
        title: 'Youth Program Waiver',
        version: 1,
        active: true,
        pdf_storage_path: '/waivers/youth-program.pdf',
        pdf_public_url: 'https://example.com/youth-program.pdf',
        source: 'project_pdf' as const,
        created_by: 'organizer-456',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        signers: [
          {
            id: 'signer-student-1',
            waiver_definition_id: 'def-integration-multi',
            role_key: 'student',
            label: 'Student',
            required: true,
            order_index: 0,
            rules: { minAge: 13, maxAge: 17 },
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
          {
            id: 'signer-parent-1',
            waiver_definition_id: 'def-integration-multi',
            role_key: 'parent_guardian',
            label: 'Parent/Guardian',
            required: true,
            order_index: 1,
            rules: { minAge: 18 },
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
        fields: [
          {
            id: 'field-sig-student',
            waiver_definition_id: 'def-integration-multi',
            field_key: 'student_signature',
            field_type: 'signature' as const,
            label: 'Student Signature',
            required: true,
            source: 'custom_overlay' as const,
            pdf_field_name: null,
            page_index: 0,
            rect: { x: 100, y: 650, width: 250, height: 60 },
            signer_role_key: 'student',
            meta: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
          {
            id: 'field-sig-parent',
            waiver_definition_id: 'def-integration-multi',
            field_key: 'parent_signature',
            field_type: 'signature' as const,
            label: 'Parent/Guardian Signature',
            required: true,
            source: 'custom_overlay' as const,
            pdf_field_name: null,
            page_index: 0,
            rect: { x: 100, y: 550, width: 250, height: 60 },
            signer_role_key: 'parent_guardian',
            meta: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
          {
            id: 'field-emergency',
            waiver_definition_id: 'def-integration-multi',
            field_key: 'emergency_contact',
            field_type: 'text' as const,
            label: 'Emergency Contact Phone',
            required: true,
            source: 'custom_overlay' as const,
            pdf_field_name: null,
            page_index: 0,
            rect: { x: 100, y: 450, width: 200, height: 30 },
            signer_role_key: null,
            meta: { placeholder: '(555) 123-4567', maxLength: 20 },
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
      };

      // Both signers complete the waiver
      const payload: SignaturePayload = {
        signers: [
          {
            role_key: 'student',
            method: 'typed',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T14:00:00Z',
            signer_name: 'Emma Student',
            signer_email: 'emma.student@example.com',
          },
          {
            role_key: 'parent_guardian',
            method: 'draw',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T14:05:00Z',
            signer_name: 'Sarah Parent',
            signer_email: 'sarah.parent@example.com',
          },
        ],
        fields: {
          emergency_contact: '(555) 987-6543',
        },
      };

      const result = validateWaiverPayload(payload, definition);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject multi-signer waiver with missing parent signature', () => {
      // Same definition as above, but incomplete payload
      const definition = {
        id: 'def-integration-multi',
        scope: 'project' as const,
        project_id: 'proj-int-002',
        title: 'Youth Program Waiver',
        version: 1,
        active: true,
        pdf_storage_path: '/waivers/youth-program.pdf',
        pdf_public_url: 'https://example.com/youth-program.pdf',
        source: 'project_pdf' as const,
        created_by: 'organizer-456',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        signers: [
          {
            id: 'signer-student-1',
            waiver_definition_id: 'def-integration-multi',
            role_key: 'student',
            label: 'Student',
            required: true,
            order_index: 0,
            rules: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
          {
            id: 'signer-parent-1',
            waiver_definition_id: 'def-integration-multi',
            role_key: 'parent_guardian',
            label: 'Parent/Guardian',
            required: true,
            order_index: 1,
            rules: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
        fields: [],
      };

      // Only student signed, parent missing
      const incompletePayload: SignaturePayload = {
        signers: [
          {
            role_key: 'student',
            method: 'typed',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T14:00:00Z',
            signer_name: 'Emma Student',
          },
        ],
        fields: {},
      };

      const result = validateWaiverPayload(incompletePayload, definition);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Required signature missing for: Parent/Guardian');
    });

    it('should reject multi-signer waiver with missing required field when strictFieldValidation is true', () => {
      // Phase 1 Fix Issue 2: Field validation only enforced when strictFieldValidation=true
      const definition = {
        id: 'def-field-validation',
        scope: 'project' as const,
        project_id: 'proj-int-003',
        title: 'Field Validation Waiver',
        version: 1,
        active: true,
        pdf_storage_path: '/waivers/field-test.pdf',
        pdf_public_url: 'https://example.com/field-test.pdf',
        source: 'project_pdf' as const,
        created_by: 'organizer-789',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        signers: [
          {
            id: 'signer-vol-2',
            waiver_definition_id: 'def-field-validation',
            role_key: 'volunteer',
            label: 'Volunteer',
            required: true,
            order_index: 0,
            rules: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
        fields: [
          {
            id: 'field-emergency-2',
            waiver_definition_id: 'def-field-validation',
            field_key: 'emergency_contact',
            field_type: 'text' as const,
            label: 'Emergency Contact',
            required: true,
            source: 'custom_overlay' as const,
            pdf_field_name: null,
            page_index: 0,
            rect: { x: 100, y: 450, width: 200, height: 30 },
            signer_role_key: null,
            meta: null,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
      };

      // Payload with signature but missing required field
      const payloadMissingField: SignaturePayload = {
        signers: [
          {
            role_key: 'volunteer',
            method: 'draw',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T16:00:00Z',
            signer_name: 'Bob Volunteer',
          },
        ],
        fields: {}, // Missing emergency_contact
      };

      // Should fail when strictFieldValidation is true
      const strictResult = validateWaiverPayload(payloadMissingField, definition, true);
      expect(strictResult.valid).toBe(false);
      expect(strictResult.errors).toContain('Required field missing: Emergency Contact');
      
      // Should pass when strictFieldValidation is false (default for Phase 1-3)
      const lenientResult = validateWaiverPayload(payloadMissingField, definition, false);
      expect(lenientResult.valid).toBe(true);
    });
  });

  describe('Global Template Scenarios', () => {
    it('should validate payload against global-scoped waiver definition', () => {
      // Simulates: Admin sets global template → Project with no custom waiver uses it
      const globalDefinition = {
        id: 'def-global-001',
        scope: 'global' as const,
        project_id: null, // Global templates have no project_id
        title: 'Standard Organization Waiver',
        version: 1,
        active: true,
        pdf_storage_path: '/waivers/global-standard.pdf',
        pdf_public_url: 'https://example.com/global-standard.pdf',
        source: 'global_pdf' as const,
        created_by: 'admin-001',
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        signers: [
          {
            id: 'signer-global-vol',
            waiver_definition_id: 'def-global-001',
            role_key: 'volunteer',
            label: 'Volunteer',
            required: true,
            order_index: 0,
            rules: null,
            created_at: '2026-01-15T00:00:00Z',
            updated_at: '2026-01-15T00:00:00Z',
          },
        ],
        fields: [],
      };

      const payload: SignaturePayload = {
        signers: [
          {
            role_key: 'volunteer',
            method: 'upload',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T18:00:00Z',
            signer_name: 'Chris Volunteer',
          },
        ],
        fields: {},
      };

      const result = validateWaiverPayload(payload, globalDefinition);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(globalDefinition.scope).toBe('global');
      expect(globalDefinition.project_id).toBeNull();
    });
  });

  describe('Signature Method Variations', () => {
    const baseDefinition = {
      id: 'def-methods-test',
      scope: 'project' as const,
      project_id: 'proj-methods',
      title: 'Methods Test Waiver',
      version: 1,
      active: true,
      pdf_storage_path: '/waivers/methods.pdf',
      pdf_public_url: 'https://example.com/methods.pdf',
      source: 'project_pdf' as const,
      created_by: 'tester-001',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      signers: [
        {
          id: 'signer-method-test',
          waiver_definition_id: 'def-methods-test',
          role_key: 'volunteer',
          label: 'Volunteer',
          required: true,
          order_index: 0,
          rules: null,
          created_at: '2026-02-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
        },
      ],
      fields: [],
    };

    it('should accept draw signature method', () => {
      const payload: SignaturePayload = {
        signers: [
          {
            role_key: 'volunteer',
            method: 'draw',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T10:00:00Z',
            signer_name: 'Draw Test',
          },
        ],
        fields: {},
      };

      const result = validateWaiverPayload(payload, baseDefinition);
      expect(result.valid).toBe(true);
    });

    it('should accept typed signature method', () => {
      const payload: SignaturePayload = {
        signers: [
          {
            role_key: 'volunteer',
            method: 'typed',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T10:00:00Z',
            signer_name: 'Typed Test',
          },
        ],
        fields: {},
      };

      const result = validateWaiverPayload(payload, baseDefinition);
      expect(result.valid).toBe(true);
    });

    it('should accept upload signature method', () => {
      const payload: SignaturePayload = {
        signers: [
          {
            role_key: 'volunteer',
            method: 'upload',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T10:00:00Z',
            signer_name: 'Upload Test',
          },
        ],
        fields: {},
      };

      const result = validateWaiverPayload(payload, baseDefinition);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid signature method', () => {
      const payload: SignaturePayload = {
        signers: [
          {
            role_key: 'volunteer',
            method: 'invalid-method' as any,
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY',
            timestamp: '2026-02-11T10:00:00Z',
            signer_name: 'Invalid Method Test',
          },
        ],
        fields: {},
      };

      const result = validateWaiverPayload(payload, baseDefinition);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid signature method'))).toBe(true);
    });
  });
});
