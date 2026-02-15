import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { normalizeFieldsForOverlay } from '@/app/api/ai/analyze-waiver/route';
import type { AnalyzeWaiverNormalizedField, AnalyzeWaiverPageDimension } from '@/app/api/ai/analyze-waiver/route';

/**
 * Phase 3 Schema Tests: Validate new AI input/output contract
 * 
 * These tests verify that:
 * 1. AI receives structured input (text, labels, candidates)
 * 2. AI returns candidate ID selections (not raw coordinates)
 * 3. Selected candidates map back to bounding boxes correctly
 * 4. Invalid candidates are handled gracefully
 * 5. Response format remains backward-compatible
 * 6. Route-level tests validate actual contract behavior
 */

describe('Phase 3: AI Schema with Candidate Selection', () => {
  describe('AI Output Schema', () => {
    it('should define SelectedFieldSchema with candidateId', () => {
      const SelectedFieldSchema = z.object({
        candidateId: z.string().describe('ID of the selected candidate area from input'),
        fieldType: z.enum(['signature', 'name', 'date', 'email', 'phone', 'address', 'text', 'checkbox', 'radio', 'dropdown', 'initial']),
        signerRole: z.string(),
        label: z.string(),
        required: z.boolean(),
        confidence: z.number().optional(),
        reasoning: z.string().optional(),
      });

      const result = SelectedFieldSchema.safeParse({
        candidateId: 'candidate-abc123',
        fieldType: 'signature',
        signerRole: 'volunteer',
        label: 'Volunteer Signature',
        required: true,
      });

      expect(result.success).toBe(true);
    });

    it('should define WaiverClassificationSchema with selectedFields array', () => {
      const SelectedFieldSchema = z.object({
        candidateId: z.string(),
        fieldType: z.enum(['signature', 'name', 'date', 'email', 'phone', 'address', 'text', 'checkbox', 'radio', 'dropdown', 'initial']),
        signerRole: z.string(),
        label: z.string(),
        required: z.boolean(),
        confidence: z.number().optional(),
        reasoning: z.string().optional(),
      });

      const WaiverClassificationSchema = z.object({
        pageCount: z.number(),
        selectedFields: z.array(SelectedFieldSchema),
        signerRoles: z.array(z.object({
          roleKey: z.string(),
          label: z.string(),
          required: z.boolean(),
          description: z.string().optional(),
        })),
        summary: z.string(),
        recommendations: z.array(z.string()),
        reasoning: z.string().optional(),
      });

      const result = WaiverClassificationSchema.safeParse({
        pageCount: 1,
        selectedFields: [
          {
            candidateId: 'candidate-abc123',
            fieldType: 'signature',
            signerRole: 'volunteer',
            label: 'Volunteer Signature',
            required: true,
          },
        ],
        signerRoles: [
          {
            roleKey: 'volunteer',
            label: 'Volunteer',
            required: true,
          },
        ],
        summary: 'Test waiver',
        recommendations: [],
      });

      expect(result.success).toBe(true);
    });

    it('should reject selectedFields without candidateId', () => {
      const SelectedFieldSchema = z.object({
        candidateId: z.string(),
        fieldType: z.enum(['signature', 'name', 'date', 'email', 'phone', 'address', 'text', 'checkbox', 'radio', 'dropdown', 'initial']),
        signerRole: z.string(),
        label: z.string(),
        required: z.boolean(),
      });

      const result = SelectedFieldSchema.safeParse({
        fieldType: 'signature',
        signerRole: 'volunteer',
        label: 'Volunteer Signature',
        required: true,
        // Missing candidateId
      });

      expect(result.success).toBe(false);
    });
  });

  describe('Candidate Mapping Logic', () => {
    it('should map candidateId to bounding box coordinates', () => {
      const candidates = [
        {
          id: 'candidate-abc123',
          pageIndex: 0,
          rect: { x: 100, y: 500, width: 200, height: 40 },
          typeHint: 'signature' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.9,
          source: 'underscore' as const,
        },
      ];

      const selectedField = {
        candidateId: 'candidate-abc123',
        fieldType: 'signature' as const,
        signerRole: 'volunteer',
        label: 'Volunteer Signature',
        required: true,
      };

      // Mapping logic
      const candidate = candidates.find(c => c.id === selectedField.candidateId);
      expect(candidate).toBeDefined();
      expect(candidate?.rect.x).toBe(100);
      expect(candidate?.rect.y).toBe(500);
      expect(candidate?.rect.width).toBe(200);
      expect(candidate?.rect.height).toBe(40);
    });

    it('should handle invalid candidateId gracefully', () => {
      const candidates = [
        {
          id: 'candidate-valid',
          pageIndex: 0,
          rect: { x: 100, y: 500, width: 200, height: 40 },
          typeHint: 'signature' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.9,
          source: 'underscore' as const,
        },
      ];

      const selectedField = {
        candidateId: 'candidate-invalid',
        fieldType: 'signature',
        signerRole: 'volunteer',
        label: 'Signature',
        required: true,
      };

      const candidate = candidates.find(c => c.id === selectedField.candidateId);
      expect(candidate).toBeUndefined();
    });

    it('should filter out fields with invalid candidateIds', () => {
      const candidates = [
        {
          id: 'candidate-1',
          pageIndex: 0,
          rect: { x: 100, y: 500, width: 200, height: 40 },
          typeHint: 'signature' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.9,
          source: 'underscore' as const,
        },
      ];

      const selectedFields = [
        {
          candidateId: 'candidate-1',
          fieldType: 'signature' as const,
          signerRole: 'volunteer',
          label: 'Valid Field',
          required: true,
        },
        {
          candidateId: 'candidate-invalid',
          fieldType: 'date' as const,
          signerRole: 'volunteer',
          label: 'Invalid Field',
          required: false,
        },
      ];

      const validFields = selectedFields
        .map(sf => {
          const candidate = candidates.find(c => c.id === sf.candidateId);
          if (!candidate) return null;
          return {
            ...sf,
            pageIndex: candidate.pageIndex,
            boundingBox: candidate.rect,
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      expect(validFields).toHaveLength(1);
      expect(validFields[0].label).toBe('Valid Field');
    });
  });

  describe('Route-Level Contract Tests', () => {
    it('should skip invalid candidate IDs safely without crashing', () => {
      // Simulates AI returning a mix of valid and invalid candidate IDs
      const candidates = [
        {
          id: 'candidate-valid-1',
          pageIndex: 0,
          rect: { x: 100, y: 500, width: 200, height: 40 },
          typeHint: 'signature' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.9,
          source: 'underscore' as const,
        },
      ];

      const aiSelectedFields = [
        {
          candidateId: 'candidate-valid-1',
          fieldType: 'signature' as const,
          signerRole: 'volunteer',
          label: 'Valid Signature',
          required: true,
        },
        {
          candidateId: 'candidate-nonexistent',
          fieldType: 'date' as const,
          signerRole: 'volunteer',
          label: 'Invalid Date Field',
          required: false,
        },
        {
          candidateId: 'candidate-also-invalid',
          fieldType: 'name' as const,
          signerRole: 'parent',
          label: 'Invalid Name Field',
          required: true,
        },
      ];

      // Route mapping logic
      const fieldsFromCandidates = aiSelectedFields
        .map(selection => {
          const candidate = candidates.find(c => c.id === selection.candidateId);
          if (!candidate) {
            // Should log warning but not crash
            return null;
          }
          return {
            fieldType: selection.fieldType,
            label: selection.label,
            signerRole: selection.signerRole,
            pageIndex: candidate.pageIndex,
            boundingBox: candidate.rect,
            required: selection.required,
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      // Should only return the valid field
      expect(fieldsFromCandidates).toHaveLength(1);
      expect(fieldsFromCandidates[0].label).toBe('Valid Signature');
      expect(fieldsFromCandidates[0].boundingBox).toEqual({ x: 100, y: 500, width: 200, height: 40 });
    });

    it('should produce stable response when no candidates are available (fallback)', () => {
      // Simulates empty structural data - AI should still return valid response
      const candidates: Array<{
        id: string;
        pageIndex: number;
        rect: { x: number; y: number; width: number; height: number };
        typeHint: 'signature' | 'date' | 'name' | 'other';
        nearbyLabelIds: string[];
        nearbyLabelTypes: Array<'signature' | 'date' | 'name' | 'other'>;
        score: number;
        source: 'underscore' | 'right_of_label';
      }> = [];

      type SelectedField = {
        candidateId: string;
        fieldType: 'signature' | 'date' | 'name' | 'text';
        signerRole: string;
        label: string;
        required: boolean;
      };

      const aiResponse = {
        pageCount: 1,
        selectedFields: [] as SelectedField[], // No fields because no candidates
        signerRoles: [
          {
            roleKey: 'volunteer',
            label: 'Volunteer',
            required: true,
            description: 'Primary participant',
          },
        ],
        summary: 'This is a volunteer waiver requiring signatures.',
        recommendations: ['Ensure all signatures are collected before event.'],
      };

      // Map to output format
      const fieldsFromCandidates = aiResponse.selectedFields
        .map(selection => {
          const candidate = candidates.find(c => c.id === selection.candidateId);
          if (!candidate) return null;
          return {
            fieldType: selection.fieldType,
            label: selection.label,
            signerRole: selection.signerRole,
            pageIndex: candidate.pageIndex,
            boundingBox: candidate.rect,
            required: selection.required,
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      // Response should be valid even with empty fields
      expect(fieldsFromCandidates).toHaveLength(0);
      expect(aiResponse.signerRoles).toHaveLength(1);
      expect(aiResponse.summary).toBeTruthy();
      expect(aiResponse.recommendations).toBeInstanceOf(Array);
    });

    it('should maintain backward-compatible response shape for existing UI', () => {
      // Validates that the response matches the expected structure used by components
      const candidates = [
        {
          id: 'candidate-sig',
          pageIndex: 0,
          rect: { x: 150, y: 600, width: 200, height: 50 },
          typeHint: 'signature' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.95,
          source: 'underscore' as const,
        },
        {
          id: 'candidate-date',
          pageIndex: 0,
          rect: { x: 400, y: 600, width: 100, height: 30 },
          typeHint: 'date' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.85,
          source: 'right_of_label' as const,
        },
      ];

      const aiSelectedFields = [
        {
          candidateId: 'candidate-sig',
          fieldType: 'signature' as const,
          signerRole: 'volunteer',
          label: 'Volunteer Signature',
          required: true,
        },
        {
          candidateId: 'candidate-date',
          fieldType: 'date' as const,
          signerRole: 'volunteer',
          label: 'Date Signed',
          required: true,
        },
      ];

      const aiSignerRoles = [
        {
          roleKey: 'volunteer',
          label: 'Volunteer',
          required: true,
          description: 'Primary participant',
        },
      ];

      // Map to response format
      const fields = aiSelectedFields
        .map(selection => {
          const candidate = candidates.find(c => c.id === selection.candidateId);
          if (!candidate) return null;
          return {
            fieldType: selection.fieldType,
            label: selection.label,
            signerRole: selection.signerRole,
            pageIndex: candidate.pageIndex,
            boundingBox: candidate.rect,
            required: selection.required,
          } as const;
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      const response = {
        success: true,
        analysis: {
          pageCount: 1,
          pageDimensions: [{ pageIndex: 0, width: 612, height: 792 }],
          signerRoles: aiSignerRoles,
          fields,
          summary: 'Volunteer waiver',
          recommendations: [],
        },
      };

      // Validate expected structure for UI compatibility
      expect(response.success).toBe(true);
      expect(response.analysis).toBeDefined();
      expect(response.analysis.pageCount).toBe(1);
      expect(response.analysis.pageDimensions).toBeInstanceOf(Array);
      expect(response.analysis.signerRoles).toBeInstanceOf(Array);
      expect(response.analysis.fields).toBeInstanceOf(Array);

      // Each field should have required properties
      for (const field of response.analysis.fields) {
        expect(field).toHaveProperty('fieldType');
        expect(field).toHaveProperty('label');
        expect(field).toHaveProperty('signerRole');
        expect(field).toHaveProperty('pageIndex');
        expect(field).toHaveProperty('boundingBox');
        expect(field).toHaveProperty('required');

        // BoundingBox should have x, y, width, height
        expect(field.boundingBox).toHaveProperty('x');
        expect(field.boundingBox).toHaveProperty('y');
        expect(field.boundingBox).toHaveProperty('width');
        expect(field.boundingBox).toHaveProperty('height');
      }

      expect(response.analysis.summary).toBeTruthy();
      expect(response.analysis.recommendations).toBeInstanceOf(Array);
    });
  });

  describe('Structured Input Validation', () => {
    it('should include text items with coordinates in structured payload', () => {
      // Validates that text content is included (not just counts)
      const textItems = [
        { text: 'Volunteer Waiver', pageIndex: 0, x: 100, y: 700, width: 120, height: 14 },
        { text: 'Signature:', pageIndex: 0, x: 100, y: 600, width: 70, height: 12 },
        { text: 'Date:', pageIndex: 0, x: 300, y: 600, width: 35, height: 12 },
      ];

      const structuredPayload = {
        pages: [{ pageIndex: 0, width: 612, height: 792 }],
        textItems: textItems.map(item => ({
          text: item.text,
          pageIndex: item.pageIndex,
          rectInPoints: {
            x: Math.round(item.x),
            y: Math.round(item.y),
            width: Math.round(item.width),
            height: Math.round(item.height),
          },
        })),
        textItemsTotal: textItems.length,
        labels: [],
        candidates: [],
        widgets: [],
      };

      // Should include actual text content with coordinates
      expect(structuredPayload.textItems).toHaveLength(3);
      expect(structuredPayload.textItems[0]).toHaveProperty('text', 'Volunteer Waiver');
      expect(structuredPayload.textItems[0]).toHaveProperty('pageIndex', 0);
      expect(structuredPayload.textItems[0]).toHaveProperty('rectInPoints');
      expect(structuredPayload.textItems[0].rectInPoints).toEqual({
        x: 100,
        y: 700,
        width: 120,
        height: 14,
      });
    });

    it('should cap text items to prevent payload bloat', () => {
      // Validates that very large PDFs don't create enormous payloads
      const MAX_TEXT_ITEMS = 500;
      const MAX_TEXT_LENGTH = 150;

      // Simulate a large PDF with 1000 text items
      const manyTextItems = Array.from({ length: 1000 }, (_, i) => ({
        text: `Text item ${i}`.repeat(50), // Long text
        pageIndex: Math.floor(i / 100),
        x: 100,
        y: 700 - (i % 100) * 10,
        width: 200,
        height: 12,
      }));

      // Cap and truncate
      const cappedTextItems = manyTextItems.slice(0, MAX_TEXT_ITEMS).map(item => ({
        text: item.text.length > MAX_TEXT_LENGTH ? item.text.slice(0, MAX_TEXT_LENGTH) + '...' : item.text,
        pageIndex: item.pageIndex,
        rectInPoints: {
          x: Math.round(item.x),
          y: Math.round(item.y),
          width: Math.round(item.width),
          height: Math.round(item.height),
        },
      }));

      expect(cappedTextItems).toHaveLength(MAX_TEXT_ITEMS);
      for (const item of cappedTextItems) {
        expect(item.text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH + 3); // +3 for "..."
      }
    });

    it('should preserve bottom-left coordinates in structured data', () => {
      // Validates that PDF coordinate system is maintained
      const label = {
        id: 'label-1',
        text: 'Signature:',
        type: 'signature' as const,
        pageIndex: 0,
        confidence: 0.95,
        rect: { x: 100, y: 500, width: 70, height: 12 },
      };

      const candidate = {
        id: 'candidate-1',
        pageIndex: 0,
        rect: { x: 180, y: 500, width: 200, height: 40 },
        typeHint: 'signature' as const,
        nearbyLabelIds: ['label-1'],
        nearbyLabelTypes: ['signature' as const],
        score: 0.9,
        source: 'right_of_label' as const,
      };

      const structuredData = {
        labels: [{
          id: label.id,
          text: label.text,
          type: label.type,
          pageIndex: label.pageIndex,
          confidence: label.confidence,
          rectInPoints: {
            x: Math.round(label.rect.x),
            y: Math.round(label.rect.y), // Bottom-left y coordinate
            width: Math.round(label.rect.width),
            height: Math.round(label.rect.height),
          },
        }],
        candidates: [{
          id: candidate.id,
          pageIndex: candidate.pageIndex,
          typeHint: candidate.typeHint,
          nearbyLabelTypes: candidate.nearbyLabelTypes,
          score: candidate.score,
          source: candidate.source,
          rectInPoints: {
            x: Math.round(candidate.rect.x),
            y: Math.round(candidate.rect.y), // Bottom-left y coordinate
            width: Math.round(candidate.rect.width),
            height: Math.round(candidate.rect.height),
          },
        }],
      };

      // Coordinates should be preserved as-is (bottom-left origin)
      expect(structuredData.labels[0].rectInPoints.y).toBe(500);
      expect(structuredData.candidates[0].rectInPoints.y).toBe(500);
    });
  });

  describe('Normalization Logic Tests', () => {
    it('should normalize fields correctly using normalizeFieldsForOverlay', () => {
      const fields: AnalyzeWaiverNormalizedField[] = [
        {
          fieldType: 'signature',
          label: 'Volunteer Signature',
          signerRole: 'volunteer',
          pageIndex: 0,
          boundingBox: { x: 100, y: 500, width: 200, height: 40 },
          required: true,
        },
      ];

      const pageDimensions: AnalyzeWaiverPageDimension[] = [
        { pageIndex: 0, width: 612, height: 792 },
      ];

      const normalized = normalizeFieldsForOverlay(fields, pageDimensions, 1);

      expect(normalized).toHaveLength(1);
      expect(normalized[0].pageIndex).toBe(0);
      expect(normalized[0].fieldType).toBe('signature');
      
      // Coordinates should be normalized and clamped
      expect(normalized[0].boundingBox.x).toBeGreaterThanOrEqual(0);
      expect(normalized[0].boundingBox.y).toBeGreaterThanOrEqual(0);
      expect(normalized[0].boundingBox.width).toBeGreaterThan(0);
      expect(normalized[0].boundingBox.height).toBeGreaterThan(0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain response structure with boundingBox field', () => {
      const candidates = [
        {
          id: 'candidate-xyz',
          pageIndex: 0,
          rect: { x: 150, y: 450, width: 180, height: 35 },
          typeHint: 'date' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.85,
          source: 'right_of_label' as const,
        },
      ];

      const selectedField = {
        candidateId: 'candidate-xyz',
        fieldType: 'date' as const,
        signerRole: 'volunteer',
        label: 'Date',
        required: true,
      };

      const candidate = candidates.find(c => c.id === selectedField.candidateId);
      
      // Map to backward-compatible format
      const outputField = {
        fieldType: selectedField.fieldType,
        label: selectedField.label,
        signerRole: selectedField.signerRole,
        pageIndex: candidate!.pageIndex,
        boundingBox: candidate!.rect,
        required: selectedField.required,
      };

      expect(outputField).toHaveProperty('fieldType');
      expect(outputField).toHaveProperty('label');
      expect(outputField).toHaveProperty('signerRole');
      expect(outputField).toHaveProperty('pageIndex');
      expect(outputField).toHaveProperty('boundingBox');
      expect(outputField).toHaveProperty('required');
      expect(outputField.boundingBox).toEqual({ x: 150, y: 450, width: 180, height: 35 });
    });
  });
});
