import { describe, it, expect } from 'vitest';
import { validateWaiverPayload } from './validate-waiver-payload';
import type { SignaturePayload } from '@/types/waiver-definitions';

describe('validateWaiverPayload', () => {
  const mockDefinition = {
    id: 'def-123',
    scope: 'project' as const,
    project_id: 'proj-123',
    title: 'Test Waiver',
    version: 1,
    active: true,
    pdf_storage_path: '/test.pdf',
    pdf_public_url: 'https://example.com/test.pdf',
    source: 'project_pdf' as const,
    created_by: 'user-123',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    signers: [
      {
        id: 'signer-1',
        waiver_definition_id: 'def-123',
        role_key: 'volunteer',
        label: 'Volunteer',
        required: true,
        order_index: 0,
        rules: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      {
        id: 'signer-2',
        waiver_definition_id: 'def-123',
        role_key: 'parent',
        label: 'Parent/Guardian',
        required: true,
        order_index: 1,
        rules: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
    fields: [
      {
        id: 'field-1',
        waiver_definition_id: 'def-123',
        field_key: 'volunteer_signature',
        field_type: 'signature' as const,
        label: 'Volunteer Signature',
        required: true,
        source: 'custom_overlay' as const,
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 100, y: 500, width: 200, height: 50 },
        signer_role_key: 'volunteer',
        meta: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      {
        id: 'field-2',
        waiver_definition_id: 'def-123',
        field_key: 'emergency_contact',
        field_type: 'text' as const,
        label: 'Emergency Contact',
        required: true,
        source: 'custom_overlay' as const,
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 100, y: 600, width: 200, height: 30 },
        signer_role_key: null,
        meta: { placeholder: 'Enter phone number' },
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
  };

  it('should pass validation for complete valid payload', () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:00:00Z',
          signer_name: 'John Doe',
          signer_email: 'john@example.com',
        },
        {
          role_key: 'parent',
          method: 'typed',
          data: 'Jane Doe',
          timestamp: '2026-02-10T10:01:00Z',
          signer_name: 'Jane Doe',
          signer_email: 'jane@example.com',
        },
      ],
      fields: {
        emergency_contact: '555-1234',
      },
    };

    const result = validateWaiverPayload(payload, mockDefinition);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail validation when required signer is missing', () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:00:00Z',
        },
        // Missing 'parent' signer
      ],
      fields: {
        emergency_contact: '555-1234',
      },
    };

    const result = validateWaiverPayload(payload, mockDefinition);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Required signature missing for: Parent/Guardian');
  });

  it('should fail validation with invalid signature method', () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          method: 'invalid' as any,
          data: 'some-data',
          timestamp: '2026-02-10T10:00:00Z',
        },
        {
          role_key: 'parent',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:01:00Z',
        },
      ],
      fields: {
        emergency_contact: '555-1234',
      },
    };

    const result = validateWaiverPayload(payload, mockDefinition);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid signature method for volunteer');
  });

  it('should fail validation when signature data is empty', () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: '',
          timestamp: '2026-02-10T10:00:00Z',
        },
        {
          role_key: 'parent',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:01:00Z',
        },
      ],
      fields: {
        emergency_contact: '555-1234',
      },
    };

    const result = validateWaiverPayload(payload, mockDefinition);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Empty signature data for volunteer');
  });

  it('should add warning when timestamp is missing', () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '',
        },
        {
          role_key: 'parent',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:01:00Z',
        },
      ],
      fields: {
        emergency_contact: '555-1234',
      },
    };

    const result = validateWaiverPayload(payload, mockDefinition);

    expect(result.valid).toBe(true); // Still valid but has warnings
    expect(result.warnings).toBeDefined();
    expect(result.warnings).toContain('Missing timestamp for volunteer');
  });

  it('should fail validation when required field is missing and strictFieldValidation is true', () => {
    // Phase 1 Fix Issue 2: Required field validation only enforced when strictFieldValidation=true
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:00:00Z',
        },
        {
          role_key: 'parent',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:01:00Z',
        },
      ],
      fields: {
        // Missing emergency_contact
      },
    };

    // Should fail when strictFieldValidation is true
    const strictResult = validateWaiverPayload(payload, mockDefinition, true);
    expect(strictResult.valid).toBe(false);
    expect(strictResult.errors).toContain('Required field missing: Emergency Contact');
    
    // Should pass when strictFieldValidation is false (default)
    const lenientResult = validateWaiverPayload(payload, mockDefinition, false);
    expect(lenientResult.valid).toBe(true);
    
    // Default should be lenient
    const defaultResult = validateWaiverPayload(payload, mockDefinition);
    expect(defaultResult.valid).toBe(true);
  });

  it('should pass validation when definition has no custom fields', () => {
    const definitionWithoutFields = {
      ...mockDefinition,
      fields: mockDefinition.fields.filter(f => f.field_type === 'signature'),
    };

    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:00:00Z',
        },
        {
          role_key: 'parent',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
          timestamp: '2026-02-10T10:01:00Z',
        },
      ],
      fields: {},
    };

    const result = validateWaiverPayload(payload, definitionWithoutFields);

    expect(result.valid).toBe(true);
  });
});

