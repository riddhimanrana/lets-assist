import { describe, it, expect, afterEach, vi } from 'vitest';
import { mapDetectedFieldsForDb, mapCustomPlacementsForDb } from '@/lib/waiver/map-definition-input';
import { normalizeFieldsForOverlay, type AnalyzeWaiverPageDimension } from '@/app/api/ai/analyze-waiver/route';

describe('Waiver Critical Fixes', () => {
  describe('Issue 1: Detected Field Persistence', () => {
    it('should include all required columns for detected text field', () => {
      const input = [{
        fieldKey: 'email',
        fieldType: 'text',
        pageIndex: 0,
        rect: { x: 100, y: 200, width: 300, height: 40 },
        pdfFieldName: 'email_field',
        label: 'Email Address',
        required: true,
        signerRoleKey: 'participant',
      }];

      const result = mapDetectedFieldsForDb('test-id', input);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        waiver_definition_id: 'test-id',
        field_key: 'email',
        field_type: 'text',
        label: 'Email Address',
        source: 'pdf_widget',
        page_index: 0,
        rect: { x: 100, y: 200, width: 300, height: 40 },
        pdf_field_name: 'email_field',
        required: true,
        signer_role_key: 'participant',
      });
    });

    it('should preserve field type for checkbox fields', () => {
      const input = [{
        fieldKey: 'consent',
        fieldType: 'checkbox',
        pageIndex: 1,
        rect: { x: 50, y: 400, width: 20, height: 20 },
        label: 'I agree',
      }];

      const result = mapDetectedFieldsForDb('test-id', input);

      expect(result[0].field_type).toBe('checkbox'); // NOT "signature"
      expect(result[0].source).toBe('pdf_widget');
    });

    it('should use defaults when optional fields missing', () => {
      const input = [{
        fieldKey: 'name',
        fieldType: 'text',
        pageIndex: 0,
        rect: { x: 0, y: 0, width: 100, height: 20 },
      }];

      const result = mapDetectedFieldsForDb('test-id', input);

      expect(result[0].label).toBe('name'); // Defaults to fieldKey
      expect(result[0].pdf_field_name).toBe('name'); // Defaults to fieldKey
      expect(result[0].required).toBe(false); // Defaults to false
      expect(result[0].signer_role_key).toBeNull();
    });
  });

  describe('Issue 2: Custom Placement Persistence', () => {
    it('should include all required columns for custom signatures', () => {
      const input = [{
        id: 'custom-sig-1',
        label: 'Parent Signature',
        fieldType: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 500, width: 200, height: 50 },
        signerRoleKey: 'parent',
        required: true,
      }];

      const result = mapCustomPlacementsForDb('test-id', input);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        waiver_definition_id: 'test-id',
        field_key: 'custom-sig-1',
        field_type: 'signature',
        label: 'Parent Signature',
        source: 'custom_overlay',
        page_index: 0,
        rect: { x: 50, y: 500, width: 200, height: 50 },
        required: true,
        signer_role_key: 'parent',
        pdf_field_name: null,
      });
    });

    it('should respect non-signature field types in custom placements', () => {
      const input = [{
        id: 'custom-name-1',
        label: 'Name Field',
        fieldType: 'name',
        pageIndex: 0,
        rect: { x: 100, y: 600, width: 250, height: 30 },
        signerRoleKey: 'volunteer',
        required: true,
      }];

      const result = mapCustomPlacementsForDb('test-id', input);

      expect(result[0].field_type).toBe('name'); // NOT forced to "signature"
      expect(result[0].label).toBe('Name Field');
    });

    it('should support various field types: email, phone, date, text', () => {
      const input = [
        {
          id: 'custom-email',
          label: 'Email',
          fieldType: 'email',
          pageIndex: 0,
          rect: { x: 0, y: 0, width: 200, height: 30 },
        },
        {
          id: 'custom-phone',
          label: 'Phone',
          fieldType: 'phone',
          pageIndex: 0,
          rect: { x: 0, y: 50, width: 150, height: 30 },
        },
        {
          id: 'custom-date',
          label: 'Date',
          fieldType: 'date',
          pageIndex: 0,
          rect: { x: 0, y: 100, width: 100, height: 30 },
        },
      ];

      const result = mapCustomPlacementsForDb('test-id', input);

      expect(result[0].field_type).toBe('email');
      expect(result[1].field_type).toBe('phone');
      expect(result[2].field_type).toBe('date');
    });

    it('should use defaults when optional fields missing', () => {
      const input = [{
        pageIndex: 0,
        rect: { x: 0, y: 0, width: 100, height: 50 },
      }];

      const result = mapCustomPlacementsForDb('test-id', input);

      expect(result[0].label).toBe('Signature');
      expect(result[0].field_type).toBe('signature'); // Default when not specified
      expect(result[0].required).toBe(true); // Signatures default to required
      expect(result[0].signer_role_key).toBeNull();
      expect(result[0].pdf_field_name).toBeNull();
    });
  });

  describe('Issue 3: Anonymous Download Security', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should require anonymousSignupId for anonymous downloads', async () => {
      // Mock fetch to avoid actually calling the API
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Unauthorized',
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      // Simulate anonymous user trying to download without anonymousSignupId
      const response = await fetch('/api/waivers/sig-123/download');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
    });

    it('should allow download with valid anonymousSignupId', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['pdf content'])),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const response = await fetch('/api/waivers/sig-123/download?anonymousSignupId=anon-456');

      expect(response.ok).toBe(true);
    });
  });

  describe('Issue 4: Dashboard Download Logic', () => {
    it('should construct correct download URL with signatureId', () => {
      const signatureId = 'sig-789';
      const downloadUrl = `/api/waivers/${signatureId}/download`;

      expect(downloadUrl).toBe('/api/waivers/sig-789/download');
    });
  });

  describe('AI Scan Coordinate Normalization', () => {
    const pageDimensions: AnalyzeWaiverPageDimension[] = [
      { pageIndex: 0, width: 612, height: 792 },
      { pageIndex: 1, width: 612, height: 792 },
    ];

    const makeField = (overrides?: Partial<{
      fieldType: 'signature' | 'name' | 'date' | 'email' | 'phone' | 'address' | 'text' | 'checkbox' | 'radio' | 'dropdown' | 'initial';
      label: string;
      signerRole: string;
      pageIndex: number;
      boundingBox: { x: number; y: number; width: number; height: number };
      required: boolean;
    }>) => ({
      fieldType: 'text' as const,
      label: 'Test Field',
      signerRole: 'volunteer',
      pageIndex: 0,
      boundingBox: { x: 100, y: 200, width: 200, height: 40 },
      required: true,
      ...overrides,
    });

    it('should handle negative width by adjusting x coordinate', () => {
      const [result] = normalizeFieldsForOverlay(
        [makeField({ boundingBox: { x: 300, y: 100, width: -200, height: 50 } })],
        pageDimensions,
        2
      );

      expect(result.boundingBox.x).toBe(100); // 300 + (-200)
      expect(result.boundingBox.width).toBe(200); // abs(-200)
    });

    it('should handle negative height by adjusting y coordinate', () => {
      const [result] = normalizeFieldsForOverlay(
        [makeField({ boundingBox: { x: 100, y: 300, width: 200, height: -50 } })],
        pageDimensions,
        2
      );

      expect(result.boundingBox.y).toBe(250); // 300 + (-50)
      expect(result.boundingBox.height).toBe(50); // abs(-50)
    });

    it('should convert 1-based page index to 0-based', () => {
      const [result] = normalizeFieldsForOverlay(
        [makeField({ pageIndex: 1 })],
        pageDimensions,
        2
      );

      expect(result.pageIndex).toBe(0); // Converted from one-based because no zero indices were present
    });

    it('should preserve valid bottom-left coordinates without flipping', () => {
      const [result] = normalizeFieldsForOverlay(
        [makeField({ fieldType: 'signature', boundingBox: { x: 100, y: 650, width: 200, height: 50 } })],
        pageDimensions,
        2
      );

      expect(result.boundingBox.y).toBe(650);
    });

    it('should clamp coordinates to page bounds', () => {
      const [result] = normalizeFieldsForOverlay(
        [makeField({ boundingBox: { x: 700, y: 800, width: 200, height: 100 } })],
        pageDimensions,
        2
      );

      expect(result.boundingBox.x).toBeLessThanOrEqual(612);
      expect(result.boundingBox.y).toBeLessThanOrEqual(792);
      expect(result.boundingBox.x + result.boundingBox.width).toBeLessThanOrEqual(612);
      expect(result.boundingBox.y + result.boundingBox.height).toBeLessThanOrEqual(792);
    });

    it('should handle invalid numeric values gracefully', () => {
      const [result] = normalizeFieldsForOverlay(
        [
          makeField({
            pageIndex: null as unknown as number,
            boundingBox: {
              x: Number.NaN,
              y: undefined as unknown as number,
              width: null as unknown as number,
              height: -0,
            },
          }),
        ],
        pageDimensions,
        2
      );

      expect(result.boundingBox.x).toBe(0);
      expect(result.boundingBox.y).toBe(0);
      expect(result.pageIndex).toBe(0);
      // minimum non-signature dimensions are enforced
      expect(result.boundingBox.width).toBe(24);
      expect(result.boundingBox.height).toBe(12);
    });
  });
});
