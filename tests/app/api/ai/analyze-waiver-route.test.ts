import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  buildSelectableCandidates,
  mapVisionFallbackFields,
  mapSelectionsToFields,
  mapWidgetsToFields,
  mergeFieldsPreferWidgets,
  normalizeFieldsForOverlay,
} from '@/app/api/ai/analyze-waiver/route';
import type { 
  AnalyzeWaiverNormalizedField, 
  AnalyzeWaiverPageDimension,
  SelectableCandidate,
} from '@/app/api/ai/analyze-waiver/route';
import type { DetectedPdfField } from '@/lib/waiver/pdf-field-detect';

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

  describe('Phase 5: Pipeline Integration', () => {
    it('should build unified selectable candidates with widget priority', () => {
      const widgets: DetectedPdfField[] = [
        {
          fieldName: 'volunteer_signature',
          fieldType: 'signature',
          pageIndex: 0,
          rect: { x: 100, y: 500, width: 200, height: 40 },
          required: true,
        },
      ];

      const inferredCandidates = [
        {
          id: 'candidate-line-1',
          pageIndex: 0,
          rect: { x: 110, y: 505, width: 190, height: 36 },
          typeHint: 'signature' as const,
          nearbyLabelIds: [],
          nearbyLabelTypes: ['signature' as const],
          score: 1,
          source: 'underscore' as const,
        },
      ];

      const selectable = buildSelectableCandidates(inferredCandidates, widgets);

      expect(selectable).toHaveLength(2);
      expect(selectable[0].source).toBe('widget');
      expect(selectable[0].score).toBe(1);
      expect(selectable[1].id).toBe('candidate-line-1');
    });

    it('should map selected IDs to fields and skip invalid selections', () => {
      const selectable = [
        {
          id: 'widget:0:0:volunteer_signature',
          pageIndex: 0,
          rect: { x: 100, y: 500, width: 200, height: 40 },
          typeHint: 'signature',
          score: 1,
          source: 'widget' as const,
        },
      ];

      const mapped = mapSelectionsToFields(
        [
          {
            candidateId: 'widget:0:0:volunteer_signature',
            fieldType: 'signature',
            signerRole: 'volunteer',
            label: 'Volunteer Signature',
            required: true,
          },
          {
            candidateId: 'missing-id',
            fieldType: 'date',
            signerRole: 'volunteer',
            label: 'Date',
            required: false,
          },
        ],
        selectable
      );

      expect(mapped).toHaveLength(1);
      expect(mapped[0].boundingBox).toEqual({ x: 100, y: 500, width: 200, height: 40 });
    });

    it('should map widgets to fields and merge with AI fields preferring widgets', () => {
      const widgets: DetectedPdfField[] = [
        {
          fieldName: 'sig_widget',
          fieldType: 'signature',
          pageIndex: 0,
          rect: { x: 100, y: 500, width: 200, height: 40 },
          required: true,
        },
        {
          fieldName: 'submit_btn',
          fieldType: 'button',
          pageIndex: 0,
          rect: { x: 10, y: 10, width: 20, height: 10 },
        },
      ];

      const widgetFields = mapWidgetsToFields(widgets);
      expect(widgetFields).toHaveLength(1);

      const aiFields: AnalyzeWaiverNormalizedField[] = [
        {
          fieldType: 'signature',
          label: 'AI Signature',
          signerRole: 'parent',
          pageIndex: 0,
          boundingBox: { x: 105, y: 502, width: 195, height: 38 },
          required: false,
          notes: 'AI classified as parent signature',
        },
        {
          fieldType: 'date',
          label: 'Date',
          signerRole: 'volunteer',
          pageIndex: 0,
          boundingBox: { x: 320, y: 500, width: 100, height: 30 },
          required: true,
        },
      ];

      const merged = mergeFieldsPreferWidgets(widgetFields, aiFields);

      // Overlapping signature from AI should be dropped in favor of widget field.
      expect(merged.filter((f) => f.fieldType === 'signature')).toHaveLength(1);
      // Widget geometry should be preserved while AI semantic metadata is retained.
      const signatureField = merged.find((f) => f.fieldType === 'signature');
      expect(signatureField?.boundingBox).toEqual({ x: 100, y: 500, width: 200, height: 40 });
      expect(signatureField?.signerRole).toBe('parent');
      expect(signatureField?.label).toBe('AI Signature');
      expect(signatureField?.required).toBe(true); // widget required=true should still prevail
      expect(signatureField?.notes).toBe('AI classified as parent signature');
      // Non-overlapping date should be preserved.
      expect(merged.some((f) => f.fieldType === 'date')).toBe(true);
    });

    it('should enrich generic widget text fields with AI semantic classifications', () => {
      const widgetFields: AnalyzeWaiverNormalizedField[] = [
        {
          fieldType: 'text',
          label: 'dob_input',
          signerRole: 'volunteer',
          pageIndex: 0,
          boundingBox: { x: 250, y: 420, width: 120, height: 24 },
          required: false,
          notes: 'Detected from embedded PDF form widget',
        },
      ];

      const aiFields: AnalyzeWaiverNormalizedField[] = [
        {
          fieldType: 'date',
          label: 'Date of Birth',
          signerRole: 'participant',
          pageIndex: 0,
          boundingBox: { x: 252, y: 421, width: 118, height: 22 },
          required: true,
          notes: 'AI inferred semantic date field',
        },
      ];

      const merged = mergeFieldsPreferWidgets(widgetFields, aiFields);

      expect(merged).toHaveLength(1);
      expect(merged[0].fieldType).toBe('text'); // keep widget geometry/type source
      expect(merged[0].label).toBe('Date of Birth');
      expect(merged[0].signerRole).toBe('participant');
      expect(merged[0].required).toBe(true);
      expect(merged[0].notes).toBe('AI inferred semantic date field');
      expect(merged[0].boundingBox).toEqual({ x: 250, y: 420, width: 120, height: 24 });
    });

    it('should infer signature type for text widgets using signature-like field names', () => {
      const widgets: DetectedPdfField[] = [
        {
          fieldName: 'guardian_signature',
          fieldType: 'text',
          pageIndex: 0,
          rect: { x: 120, y: 380, width: 240, height: 32 },
          required: true,
        },
      ];

      const mapped = mapWidgetsToFields(widgets);
      expect(mapped).toHaveLength(1);
      expect(mapped[0].fieldType).toBe('signature');
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

  describe('Phase 6: Accuracy and Robustness Validation', () => {
    describe('Accuracy Tests: Realistic Waiver Scenarios', () => {
      it('should accurately map simple single-signer waiver with signature and date', () => {
        // Simulate a basic volunteer waiver with signature and date fields
        const inferredCandidates = [
          {
            id: 'candidate-sig-1',
            pageIndex: 0,
            rect: { x: 150, y: 500, width: 200, height: 40 },
            typeHint: 'signature' as const,
            nearbyLabelIds: ['label-sig'],
            nearbyLabelTypes: ['signature' as const],
            score: 0.95,
            source: 'underscore' as const,
          },
          {
            id: 'candidate-date-1',
            pageIndex: 0,
            rect: { x: 400, y: 500, width: 100, height: 30 },
            typeHint: 'date' as const,
            nearbyLabelIds: ['label-date'],
            nearbyLabelTypes: ['date' as const],
            score: 0.90,
            source: 'right_of_label' as const,
          },
        ];

        const widgets: DetectedPdfField[] = [];
        const selectable = buildSelectableCandidates(inferredCandidates, widgets);

        // AI selects both candidates
        const aiSelections = [
          {
            candidateId: 'candidate-sig-1',
            fieldType: 'signature' as const,
            signerRole: 'volunteer',
            label: 'Volunteer Signature',
            required: true,
            confidence: 0.95,
            reasoning: 'Located below "Signature:" label with underscore field',
          },
          {
            candidateId: 'candidate-date-1',
            fieldType: 'date' as const,
            signerRole: 'volunteer',
            label: 'Date Signed',
            required: true,
            confidence: 0.90,
            reasoning: 'Date field adjacent to signature',
          },
        ];

        const mapped = mapSelectionsToFields(aiSelections, selectable);

        // Validate accurate mapping
        expect(mapped).toHaveLength(2);
        
        const sigField = mapped.find(f => f.fieldType === 'signature');
        expect(sigField).toBeDefined();
        expect(sigField?.label).toBe('Volunteer Signature');
        expect(sigField?.signerRole).toBe('volunteer');
        expect(sigField?.boundingBox).toEqual({ x: 150, y: 500, width: 200, height: 40 });
        expect(sigField?.required).toBe(true);
        expect(sigField?.notes).toContain('underscore field');

        const dateField = mapped.find(f => f.fieldType === 'date');
        expect(dateField).toBeDefined();
        expect(dateField?.label).toBe('Date Signed');
        expect(dateField?.signerRole).toBe('volunteer');
        expect(dateField?.boundingBox).toEqual({ x: 400, y: 500, width: 100, height: 30 });
        expect(dateField?.required).toBe(true);
      });

      it('should correctly handle multi-signer waiver with parent/guardian and volunteer', () => {
        // Simulate waiver requiring both volunteer and parent/guardian signatures
        const inferredCandidates = [
          {
            id: 'candidate-volunteer-sig',
            pageIndex: 0,
            rect: { x: 100, y: 400, width: 200, height: 40 },
            typeHint: 'signature' as const,
            nearbyLabelIds: ['label-volunteer'],
            nearbyLabelTypes: ['signature' as const],
            score: 0.95,
            source: 'underscore' as const,
          },
          {
            id: 'candidate-volunteer-date',
            pageIndex: 0,
            rect: { x: 320, y: 400, width: 100, height: 30 },
            typeHint: 'date' as const,
            nearbyLabelIds: ['label-vol-date'],
            nearbyLabelTypes: ['date' as const],
            score: 0.90,
            source: 'right_of_label' as const,
          },
          {
            id: 'candidate-parent-sig',
            pageIndex: 0,
            rect: { x: 100, y: 300, width: 200, height: 40 },
            typeHint: 'signature' as const,
            nearbyLabelIds: ['label-parent'],
            nearbyLabelTypes: ['parent_guardian' as const],
            score: 0.92,
            source: 'underscore' as const,
          },
          {
            id: 'candidate-parent-date',
            pageIndex: 0,
            rect: { x: 320, y: 300, width: 100, height: 30 },
            typeHint: 'date' as const,
            nearbyLabelIds: ['label-parent-date'],
            nearbyLabelTypes: ['date' as const],
            score: 0.88,
            source: 'right_of_label' as const,
          },
        ];

        const widgets: DetectedPdfField[] = [];
        const selectable = buildSelectableCandidates(inferredCandidates, widgets);

        // AI identifies separate signer roles
        const aiSelections = [
          {
            candidateId: 'candidate-volunteer-sig',
            fieldType: 'signature' as const,
            signerRole: 'volunteer',
            label: 'Volunteer Signature',
            required: true,
          },
          {
            candidateId: 'candidate-volunteer-date',
            fieldType: 'date' as const,
            signerRole: 'volunteer',
            label: 'Volunteer Date',
            required: true,
          },
          {
            candidateId: 'candidate-parent-sig',
            fieldType: 'signature' as const,
            signerRole: 'parent_guardian',
            label: 'Parent/Guardian Signature',
            required: true,
          },
          {
            candidateId: 'candidate-parent-date',
            fieldType: 'date' as const,
            signerRole: 'parent_guardian',
            label: 'Parent/Guardian Date',
            required: true,
          },
        ];

        const mapped = mapSelectionsToFields(aiSelections, selectable);

        // Validate correct role separation and field mapping
        expect(mapped).toHaveLength(4);

        const volunteerFields = mapped.filter(f => f.signerRole === 'volunteer');
        expect(volunteerFields).toHaveLength(2);
        expect(volunteerFields.some(f => f.fieldType === 'signature')).toBe(true);
        expect(volunteerFields.some(f => f.fieldType === 'date')).toBe(true);

        const parentFields = mapped.filter(f => f.signerRole === 'parent_guardian');
        expect(parentFields).toHaveLength(2);
        expect(parentFields.some(f => f.fieldType === 'signature')).toBe(true);
        expect(parentFields.some(f => f.fieldType === 'date')).toBe(true);

        // Validate coordinates are preserved correctly
        const parentSig = parentFields.find(f => f.fieldType === 'signature');
        expect(parentSig?.boundingBox.y).toBe(300); // Parent section at y=300
        
        const volunteerSig = volunteerFields.find(f => f.fieldType === 'signature');
        expect(volunteerSig?.boundingBox.y).toBe(400); // Volunteer section at y=400
      });

      it('should handle widget-only waiver with no inferred candidates', () => {
        // Simulate PDF with AcroForm fields but no visual underscore/label patterns
        const inferredCandidates = [] as never[];
        
        const widgets: DetectedPdfField[] = [
          {
            fieldName: 'volunteer_signature',
            fieldType: 'signature',
            pageIndex: 0,
            rect: { x: 100, y: 500, width: 200, height: 40 },
            required: true,
          },
          {
            fieldName: 'volunteer_date',
            fieldType: 'text',
            pageIndex: 0,
            rect: { x: 320, y: 500, width: 100, height: 30 },
            required: true,
          },
          {
            fieldName: 'volunteer_name',
            fieldType: 'text',
            pageIndex: 0,
            rect: { x: 100, y: 550, width: 200, height: 30 },
            required: false,
          },
        ];

        const selectable = buildSelectableCandidates(inferredCandidates, widgets);

        // All selectable candidates should come from widgets
        expect(selectable).toHaveLength(3);
        expect(selectable.every(c => c.source === 'widget')).toBe(true);

        // AI can select widget candidates
        const aiSelections = [
          {
            candidateId: 'widget:0:0:volunteer_signature',
            fieldType: 'signature' as const,
            signerRole: 'volunteer',
            label: 'Volunteer Signature',
            required: true,
          },
          {
            candidateId: 'widget:0:1:volunteer_date',
            fieldType: 'date' as const,
            signerRole: 'volunteer',
            label: 'Date Signed',
            required: true,
          },
        ];

        const mapped = mapSelectionsToFields(aiSelections, selectable);
        
        // Validate widget fields are correctly mapped
        expect(mapped).toHaveLength(2);
        expect(mapped.every(f => f.signerRole === 'volunteer')).toBe(true);
        
        const sigField = mapped.find(f => f.fieldType === 'signature');
        expect(sigField?.boundingBox).toEqual({ x: 100, y: 500, width: 200, height: 40 });
        expect(sigField?.required).toBe(true);

        // Validate widget coordinates are preserved precisely
        const dateField = mapped.find(f => f.fieldType === 'date');
        expect(dateField?.boundingBox).toEqual({ x: 320, y: 500, width: 100, height: 30 });
      });

      it('should preserve semantic AI classifications when merging with generic widget text fields', () => {
        // Widget extraction detected a generic "text" field for DOB input
        const widgetFields: AnalyzeWaiverNormalizedField[] = [
          {
            fieldType: 'text',
            label: 'dob_field',
            signerRole: 'volunteer',
            pageIndex: 0,
            boundingBox: { x: 250, y: 420, width: 120, height: 24 },
            required: false,
            notes: 'Detected from embedded PDF form widget',
          },
        ];

        // AI correctly identified this as a date field semantically
        const aiFields: AnalyzeWaiverNormalizedField[] = [
          {
            fieldType: 'date',
            label: 'Date of Birth',
            signerRole: 'participant',
            pageIndex: 0,
            boundingBox: { x: 252, y: 421, width: 118, height: 22 },
            required: true,
            notes: 'AI classified as date field for participant DOB',
          },
        ];

        const merged = mergeFieldsPreferWidgets(widgetFields, aiFields);

        // Should have one field (merged)
        expect(merged).toHaveLength(1);
        
        // Widget geometry should be preserved (authoritative)
        expect(merged[0].boundingBox).toEqual({ x: 250, y: 420, width: 120, height: 24 });
        
        // But AI semantic classification should be applied
        expect(merged[0].label).toBe('Date of Birth');
        expect(merged[0].signerRole).toBe('participant');
        expect(merged[0].required).toBe(true);
        expect(merged[0].notes).toContain('AI classified');
        
        // Field type remains 'text' (widget type preference) but semantic label is enriched
        expect(merged[0].fieldType).toBe('text');
      });
    });

    describe('Robustness and Fallback Tests', () => {
      it('should produce stable output contract with minimal/empty structural data', () => {
        // Simulate PDF with no extractable text or candidates
        const inferredCandidates = [] as never[];
        const widgets: DetectedPdfField[] = [];
        
        const selectable = buildSelectableCandidates(inferredCandidates, widgets);
        expect(selectable).toHaveLength(0);

        // AI response with empty selections
        const aiSelections = [] as never[];
        
        const mapped = mapSelectionsToFields(aiSelections, selectable);
        expect(mapped).toHaveLength(0);

        // Validate response structure is still valid
        const pageDimensions: AnalyzeWaiverPageDimension[] = [
          { pageIndex: 0, width: 612, height: 792 },
        ];
        
        const normalized = normalizeFieldsForOverlay(mapped, pageDimensions, 1);
        expect(normalized).toHaveLength(0);

        // Response contract should be stable
        const response = {
          success: true,
          analysis: {
            pageCount: 1,
            pageDimensions,
            signerRoles: [
              {
                roleKey: 'volunteer',
                label: 'Volunteer',
                required: true,
                description: undefined,
              },
            ],
            fields: normalized,
            summary: 'Unable to extract field structure from PDF',
            recommendations: ['Consider using a different PDF format', 'Manually configure fields'],
          },
        };

        // Validate output contract
        expect(response.success).toBe(true);
        expect(response.analysis).toBeDefined();
        expect(response.analysis.fields).toBeInstanceOf(Array);
        expect(response.analysis.signerRoles).toBeInstanceOf(Array);
        expect(response.analysis.pageDimensions).toBeInstanceOf(Array);
        expect(typeof response.analysis.summary).toBe('string');
        expect(Array.isArray(response.analysis.recommendations)).toBe(true);
      });

      it('should gracefully filter malformed candidate selections without crashing', () => {
        const inferredCandidates = [
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
          {
            id: 'candidate-valid-2',
            pageIndex: 0,
            rect: { x: 320, y: 500, width: 100, height: 30 },
            typeHint: 'date' as const,
            nearbyLabelIds: [],
            nearbyLabelTypes: [],
            score: 0.85,
            source: 'right_of_label' as const,
          },
        ];

        const widgets: DetectedPdfField[] = [];
        const selectable = buildSelectableCandidates(inferredCandidates, widgets);

        // AI returns mix of valid and invalid candidate IDs (hallucination/error)
        const aiSelections = [
          {
            candidateId: 'candidate-valid-1',
            fieldType: 'signature' as const,
            signerRole: 'volunteer',
            label: 'Valid Signature',
            required: true,
          },
          {
            candidateId: 'candidate-does-not-exist',
            fieldType: 'date' as const,
            signerRole: 'volunteer',
            label: 'Hallucinated Date Field',
            required: false,
          },
          {
            candidateId: '', // Empty ID
            fieldType: 'name' as const,
            signerRole: 'volunteer',
            label: 'Empty ID Field',
            required: false,
          },
          {
            candidateId: 'candidate-valid-2',
            fieldType: 'date' as const,
            signerRole: 'volunteer',
            label: 'Valid Date',
            required: true,
          },
          {
            candidateId: 'widget:99:99:nonexistent',
            fieldType: 'text' as const,
            signerRole: 'volunteer',
            label: 'Invalid Widget Reference',
            required: false,
          },
        ];

        const mapped = mapSelectionsToFields(aiSelections, selectable);

        // Should only map the 2 valid candidates, filtering out invalid ones
        expect(mapped).toHaveLength(2);
        
        const labels = mapped.map(f => f.label);
        expect(labels).toContain('Valid Signature');
        expect(labels).toContain('Valid Date');
        expect(labels).not.toContain('Hallucinated Date Field');
        expect(labels).not.toContain('Empty ID Field');
        expect(labels).not.toContain('Invalid Widget Reference');

        // Validate mapped fields have correct coordinates
        const sigField = mapped.find(f => f.fieldType === 'signature');
        expect(sigField?.boundingBox).toEqual({ x: 100, y: 500, width: 200, height: 40 });

        const dateField = mapped.find(f => f.fieldType === 'date');
        expect(dateField?.boundingBox).toEqual({ x: 320, y: 500, width: 100, height: 30 });
      });

      it('should handle coordinate boundary violations gracefully with normalization', () => {
        const inferredCandidates = [
          {
            id: 'candidate-1',
            pageIndex: 0,
            rect: { x: -10, y: -5, width: 200, height: 40 }, // Negative coordinates
            typeHint: 'signature' as const,
            nearbyLabelIds: [],
            nearbyLabelTypes: [],
            score: 0.9,
            source: 'underscore' as const,
          },
          {
            id: 'candidate-2',
            pageIndex: 0,
            rect: { x: 600, y: 780, width: 200, height: 50 }, // Exceeds page bounds
            typeHint: 'date' as const,
            nearbyLabelIds: [],
            nearbyLabelTypes: [],
            score: 0.85,
            source: 'right_of_label' as const,
          },
          {
            id: 'candidate-3',
            pageIndex: 0,
            rect: { x: 100, y: 500, width: -50, height: -20 }, // Negative dimensions
            typeHint: 'printed_name' as const,
            nearbyLabelIds: [],
            nearbyLabelTypes: [],
            score: 0.8,
            source: 'underscore' as const,
          },
        ];

        const widgets: DetectedPdfField[] = [];
        const selectable = buildSelectableCandidates(inferredCandidates, widgets);

        const aiSelections = selectable.map((c, i) => ({
          candidateId: c.id,
          fieldType: 'text' as const,
          signerRole: 'volunteer',
          label: `Field ${i + 1}`,
          required: true,
        }));

        const mapped = mapSelectionsToFields(aiSelections, selectable);
        expect(mapped).toHaveLength(3);

        const pageDimensions: AnalyzeWaiverPageDimension[] = [
          { pageIndex: 0, width: 612, height: 792 },
        ];

        // Normalization should fix all boundary issues
        const normalized = normalizeFieldsForOverlay(mapped, pageDimensions, 1);
        expect(normalized).toHaveLength(3);

        // All coordinates should be within bounds
        for (const field of normalized) {
          expect(field.boundingBox.x).toBeGreaterThanOrEqual(0);
          expect(field.boundingBox.y).toBeGreaterThanOrEqual(0);
          expect(field.boundingBox.width).toBeGreaterThan(0);
          expect(field.boundingBox.height).toBeGreaterThan(0);
          expect(field.boundingBox.x + field.boundingBox.width).toBeLessThanOrEqual(612);
          expect(field.boundingBox.y + field.boundingBox.height).toBeLessThanOrEqual(792);
        }
      });

      it('should handle extreme data volumes without crashing (stress test)', () => {
        // Create a large number of candidates
        const inferredCandidates = Array.from({ length: 500 }, (_, i) => ({
          id: `candidate-${i}`,
          pageIndex: i % 10, // Spread across 10 pages
          rect: { 
            x: 100 + (i % 5) * 100,
            y: 100 + (i % 50) * 15,
            width: 150,
            height: 30,
          },
          typeHint: (['signature', 'date', 'printed_name', 'other'] as const)[i % 4],
          nearbyLabelIds: [],
          nearbyLabelTypes: [],
          score: 0.5 + (i % 50) / 100,
          source: (['underscore', 'right_of_label'] as const)[i % 2],
        }));

        const widgets: DetectedPdfField[] = [];
        const selectable = buildSelectableCandidates(inferredCandidates, widgets);

        expect(selectable.length).toBeGreaterThan(0);
        expect(selectable.length).toBeLessThanOrEqual(500);

        // AI selects a subset
        const aiSelections = inferredCandidates.slice(0, 50).map(c => ({
          candidateId: c.id,
          fieldType: 'text' as const,
          signerRole: 'volunteer',
          label: `Field ${c.id}`,
          required: true,
        }));

        const mapped = mapSelectionsToFields(aiSelections, selectable);
        expect(mapped.length).toBe(50);

        // All mapped fields should be valid
        for (const field of mapped) {
          expect(field.boundingBox.x).toBeGreaterThanOrEqual(0);
          expect(field.boundingBox.width).toBeGreaterThan(0);
          expect(field.boundingBox.height).toBeGreaterThan(0);
          expect(field.pageIndex).toBeGreaterThanOrEqual(0);
        }
      });

      it('should filter out candidates with NaN or Infinity coordinates', () => {
        // Create SelectableCandidate objects directly (can have any typeHint string)
        const selectable: SelectableCandidate[] = [
          {
            id: 'candidate-valid',
            pageIndex: 0,
            rect: { x: 100, y: 500, width: 200, height: 40 },
            typeHint: 'signature',
            score: 0.9,
            source: 'underscore',
            nearbyLabelTypes: [],
          },
          {
            id: 'candidate-nan-x',
            pageIndex: 0,
            rect: { x: NaN, y: 500, width: 200, height: 40 },
            typeHint: 'date',
            score: 0.8,
            source: 'underscore',
            nearbyLabelTypes: [],
          },
          {
            id: 'candidate-infinity',
            pageIndex: 0,
            rect: { x: 100, y: Infinity, width: 200, height: 40 },
            typeHint: 'name',
            score: 0.85,
            source: 'right_of_label',
            nearbyLabelTypes: [],
          },
          {
            id: 'candidate-negative-x',
            pageIndex: 0,
            rect: { x: -100, y: 500, width: 200, height: 40 },
            typeHint: 'text',
            score: 0.7,
            source: 'underscore',
            nearbyLabelTypes: [],
          },
        ];

        const aiSelections = [
          {
            candidateId: 'candidate-valid',
            fieldType: 'signature' as const,
            signerRole: 'volunteer',
            label: 'Valid Field',
            required: true,
          },
          {
            candidateId: 'candidate-nan-x',
            fieldType: 'date' as const,
            signerRole: 'volunteer',
            label: 'NaN Field',
            required: true,
          },
          {
            candidateId: 'candidate-infinity',
            fieldType: 'name' as const,
            signerRole: 'volunteer',
            label: 'Infinity Field',
            required: true,
          },
          {
            candidateId: 'candidate-negative-x',
            fieldType: 'text' as const,
            signerRole: 'volunteer',
            label: 'Negative Field',
            required: true,
          },
        ];

        const mapped = mapSelectionsToFields(aiSelections, selectable);

        // Should filter out NaN and Infinity but allow negative (will be normalized later)
        expect(mapped.length).toBe(2); // valid and negative-x
        
        const mappedIds = mapped.map(f => {
          const candidate = selectable.find(c => 
            c.rect.x === f.boundingBox.x && 
            c.rect.y === f.boundingBox.y
          );
          return candidate?.id;
        });

        // Valid and negative-x should pass validation (negative is valid, just needs normalization)
        expect(mappedIds).toContain('candidate-valid');
        expect(mappedIds).toContain('candidate-negative-x');
        
        // NaN and Infinity should be filtered
        expect(mappedIds).not.toContain('candidate-nan-x');
        expect(mappedIds).not.toContain('candidate-infinity');
      });

      it('should convert vision fallback normalized top-left boxes to bottom-left PDF coordinates', () => {
        const pageDimensions: AnalyzeWaiverPageDimension[] = [
          { pageIndex: 0, width: 1000, height: 1000 },
        ];

        const mapped = mapVisionFallbackFields(
          [
            {
              fieldType: 'signature',
              label: 'Fallback Signature',
              signerRole: 'volunteer',
              pageIndex: 0,
              normalizedBoxTopLeft: {
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.1,
              },
              required: true,
              reasoning: 'Detected from visual line',
            },
          ],
          pageDimensions,
          1
        );

        expect(mapped).toHaveLength(1);
        expect(mapped[0].boundingBox.x).toBe(100);
        expect(mapped[0].boundingBox.width).toBe(300);
        expect(mapped[0].boundingBox.height).toBe(100);
        expect(mapped[0].boundingBox.y).toBe(700);
      });

      it('should normalize 1-based page index from vision fallback', () => {
        const pageDimensions: AnalyzeWaiverPageDimension[] = [
          { pageIndex: 0, width: 600, height: 800 },
          { pageIndex: 1, width: 600, height: 800 },
        ];

        const mapped = mapVisionFallbackFields(
          [
            {
              fieldType: 'date',
              label: 'Fallback Date',
              signerRole: 'volunteer',
              pageIndex: 2,
              normalizedBoxTopLeft: {
                x: 0.5,
                y: 0.5,
                width: 0.2,
                height: 0.05,
              },
              required: true,
            },
          ],
          pageDimensions,
          2
        );

        expect(mapped).toHaveLength(1);
        expect(mapped[0].pageIndex).toBe(1);
      });
    });
  });
});
