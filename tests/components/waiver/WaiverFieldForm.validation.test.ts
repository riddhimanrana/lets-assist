import { describe, expect, it } from 'vitest';
import { formatUsPhoneNumber, validateWaiverFieldValue } from '@/components/waiver/WaiverFieldForm';
import type { WaiverDefinitionField } from '@/types/waiver-definitions';

function makeField(overrides: Partial<WaiverDefinitionField>): WaiverDefinitionField {
  return {
    id: 'field-1',
    waiver_definition_id: 'waiver-1',
    field_key: 'field_key',
    field_type: 'text',
    label: 'Field',
    required: false,
    source: 'custom_overlay',
    pdf_field_name: null,
    page_index: 0,
    rect: { x: 10, y: 10, width: 100, height: 24 },
    signer_role_key: 'volunteer',
    meta: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('WaiverFieldForm validation helpers', () => {
  it('formats US phone values to XXX-XXX-XXXX and caps at 10 digits', () => {
    expect(formatUsPhoneNumber('123')).toBe('123');
    expect(formatUsPhoneNumber('1234')).toBe('123-4');
    expect(formatUsPhoneNumber('(123) 456-7890')).toBe('123-456-7890');
    expect(formatUsPhoneNumber('1234567890123')).toBe('123-456-7890');
  });

  it('validates email fields', () => {
    const emailField = makeField({ field_type: 'email', required: true });

    expect(validateWaiverFieldValue(emailField, 'person@example.com').valid).toBe(true);
    expect(validateWaiverFieldValue(emailField, 'not-an-email').valid).toBe(false);
  });

  it('validates phone fields as exactly 10 digits', () => {
    const phoneField = makeField({ field_type: 'phone', required: true });

    expect(validateWaiverFieldValue(phoneField, '123-456-7890').valid).toBe(true);
    expect(validateWaiverFieldValue(phoneField, '123-456-789').valid).toBe(false);
  });

  it('allows optional phone/email fields to remain empty', () => {
    const optionalPhone = makeField({ field_type: 'phone', required: false });
    const optionalEmail = makeField({ field_type: 'email', required: false });

    expect(validateWaiverFieldValue(optionalPhone, '').valid).toBe(true);
    expect(validateWaiverFieldValue(optionalEmail, '').valid).toBe(true);
  });

  it('enforces required checkbox values', () => {
    const checkboxField = makeField({ field_type: 'checkbox', required: true });

    expect(validateWaiverFieldValue(checkboxField, true).valid).toBe(true);
    expect(validateWaiverFieldValue(checkboxField, false).valid).toBe(false);
  });

  it('validates date boundaries when min/max are provided', () => {
    const dateField = makeField({
      field_type: 'date',
      required: true,
      meta: {
        minDate: '2026-01-01',
        maxDate: '2026-12-31',
      },
    });

    expect(validateWaiverFieldValue(dateField, '2026-06-15').valid).toBe(true);
    expect(validateWaiverFieldValue(dateField, '2025-12-31').valid).toBe(false);
    expect(validateWaiverFieldValue(dateField, '2027-01-01').valid).toBe(false);
  });
});
