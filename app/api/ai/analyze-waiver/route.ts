import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { PDFDocument } from 'pdf-lib';
import { extractPdfTextWithPositions } from '@/lib/waiver/pdf-text-extract';
import { findLabels } from '@/lib/waiver/label-detection';
import { detectCandidateAreas } from '@/lib/waiver/candidate-detection';
import { detectPdfWidgets } from '@/lib/waiver/pdf-field-detect';

const FIELD_TYPES = [
  'signature',
  'name',
  'date',
  'email',
  'phone',
  'address',
  'text',
  'checkbox',
  'radio',
  'dropdown',
  'initial',
] as const;

// Phase 3: New schema for AI output with candidate selection
const SelectedFieldSchema = z.object({
  candidateId: z.string().describe('ID of the selected candidate area from the structured input data'),
  fieldType: z.enum(FIELD_TYPES).describe('Type of form field'),
  signerRole: z.string().describe('Who should fill this field (e.g., "volunteer", "parent", "guardian")'),
  label: z.string().describe('Human-readable label for this field'),
  required: z.boolean().describe('Whether this field is required'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence score for this classification (0-1)'),
  reasoning: z.string().optional().describe('Brief explanation of why this candidate was selected'),
});

const WaiverClassificationSchema = z.object({
  pageCount: z.number().finite().describe('Total number of pages in the PDF'),
  selectedFields: z.array(SelectedFieldSchema).describe('Fields identified by selecting candidate IDs from the structured input'),
  signerRoles: z.array(
    z.object({
      roleKey: z.string().describe('Machine-readable key (e.g., "volunteer", "parent", "guardian")'),
      label: z.string().describe('Human-readable label (e.g., "Volunteer", "Parent/Guardian")'),
      required: z.boolean().describe('Whether this role must sign based on the waiver text'),
      description: z.string().optional().describe('Context about when this signer is needed'),
    })
  ),
  summary: z.string().describe('Brief summary of what the waiver covers'),
  recommendations: z.array(z.string()).describe('Suggestions for setting up the waiver fields'),
  reasoning: z.string().optional().describe('Overall reasoning about the document structure and field selections'),
});

interface PageDimension {
  pageIndex: number;
  width: number;
  height: number;
}

/**
 * Phase 4 Standardization: All coordinates in this system use PDF coordinate space:
 * - Origin: bottom-left corner of each page
 * - Units: PDF points (1/72 inch)
 * - Y-axis: increases upward from page bottom
 * 
 * No coordinate system inference or y-axis flipping is performed.
 */
interface ParsedField {
  fieldType: typeof FIELD_TYPES[number];
  label: string;
  signerRole: string;
  pageIndex: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  required: boolean;
  notes?: string;
}
type ParsedRole = z.infer<typeof WaiverClassificationSchema>['signerRoles'][number];
export type AnalyzeWaiverNormalizedField = ParsedField;
export type AnalyzeWaiverPageDimension = PageDimension;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRoleKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return cleaned || 'volunteer';
}

function toRoleLabel(roleKey: string): string {
  return roleKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shouldConvertFromOneBased(pageIndexes: number[], pageCount: number): boolean {
  if (pageIndexes.length === 0) return false;

  const hasZero = pageIndexes.some((idx) => idx === 0);
  if (hasZero) return false;

  const min = Math.min(...pageIndexes);
  const max = Math.max(...pageIndexes);

  return min >= 1 && max <= pageCount;
}

function normalizePageIndex(rawPageIndex: number, pageCount: number, convertFromOneBased: boolean): number {
  const numeric = Math.round(safeNumber(rawPageIndex, 0));
  const base = convertFromOneBased ? numeric - 1 : numeric;
  return clamp(base, 0, Math.max(pageCount - 1, 0));
}

/**
 * Phase 4: Normalizes field coordinates for overlay rendering.
 * 
 * CONTRACT:
 * - Input coordinates MUST be in PDF coordinate space (bottom-left origin, points)
 * - Output coordinates are in the same space (no y-axis flipping)
 * - Only performs: negative dimension fixes, page index normalization, bounds clamping, minimum size enforcement
 * 
 * No coordinate system inference or conversion is performed.
 */
export function normalizeFieldsForOverlay(
  fields: ParsedField[],
  pageDimensions: PageDimension[],
  pageCount: number
): ParsedField[] {
  const pageIndexes = fields.map((f) => Math.round(safeNumber(f.pageIndex, 0)));
  const convertFromOneBased = shouldConvertFromOneBased(pageIndexes, pageCount);

  const normalized: ParsedField[] = [];

  for (const field of fields) {
    const pageIndex = normalizePageIndex(field.pageIndex, pageCount, convertFromOneBased);
    const page = pageDimensions[pageIndex] ?? pageDimensions[0];
    if (!page) continue;

    let x = safeNumber(field.boundingBox.x, 0);
    let y = safeNumber(field.boundingBox.y, 0);
    let width = safeNumber(field.boundingBox.width, 0);
    let height = safeNumber(field.boundingBox.height, 0);

    if (width < 0) {
      x += width;
      width = Math.abs(width);
    }
    if (height < 0) {
      y += height;
      height = Math.abs(height);
    }

    // Phase 4: No y-axis flipping - coordinates are already in bottom-left PDF space

    const minWidth = field.fieldType === 'signature' ? 72 : field.fieldType === 'checkbox' ? 10 : 24;
    const minHeight = field.fieldType === 'signature' ? 18 : field.fieldType === 'checkbox' ? 10 : 12;

    width = Math.max(width, minWidth);
    height = Math.max(height, minHeight);

    if (width > page.width) width = page.width;
    if (height > page.height) height = page.height;

    x = clamp(x, 0, Math.max(page.width - width, 0));
    y = clamp(y, 0, Math.max(page.height - height, 0));

    const roleKey = normalizeRoleKey(field.signerRole);

    normalized.push({
      ...field,
      pageIndex,
      signerRole: roleKey,
      label: field.label.trim() || `${toRoleLabel(roleKey)} ${field.fieldType}`,
      required: Boolean(field.required),
      boundingBox: { x, y, width, height },
    });
  }

  return normalized;
}

function normalizeSignerRoles(roles: ParsedRole[]): ParsedRole[] {
  const roleMap = new Map<string, ParsedRole>();

  for (const role of roles) {
    const roleKey = normalizeRoleKey(role.roleKey || role.label);
    const existing = roleMap.get(roleKey);

    const normalizedRole: ParsedRole = {
      roleKey,
      label: role.label.trim() || toRoleLabel(roleKey),
      required: Boolean(role.required),
      description: role.description?.trim() || undefined,
    };

    if (!existing) {
      roleMap.set(roleKey, normalizedRole);
      continue;
    }

    roleMap.set(roleKey, {
      ...existing,
      required: existing.required || normalizedRole.required,
      label: existing.label || normalizedRole.label,
      description: existing.description || normalizedRole.description,
    });
  }

  if (roleMap.size === 0) {
    roleMap.set('volunteer', {
      roleKey: 'volunteer',
      label: 'Volunteer',
      required: true,
      description: undefined,
    });
  }

  return Array.from(roleMap.values());
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB

    const formData = await request.formData();
    const fileValue = formData.get('file');

    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const file = fileValue;

    if (file.size <= 0) {
      return NextResponse.json({ error: 'Empty file provided' }, { status: 400 });
    }

    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF too large. Max size is ${Math.round(MAX_PDF_BYTES / (1024 * 1024))}MB.` },
        { status: 413 }
      );
    }

    const looksLikePdfByName = typeof file.name === 'string' && file.name.toLowerCase().endsWith('.pdf');
    const looksLikePdfByMime = file.type === 'application/pdf';

    if (!looksLikePdfByMime && !looksLikePdfByName) {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();

    let pdfDoc: PDFDocument;
    try {
      pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    } catch {
      return NextResponse.json({ error: 'Invalid or corrupted PDF' }, { status: 400 });
    }
    const pages = pdfDoc.getPages();

    const pageDimensions = pages.map((page, index) => ({
      pageIndex: index,
      width: page.getWidth(),
      height: page.getHeight(),
    }));
    const pageCount = pageDimensions.length;

    if (pageCount === 0) {
      return NextResponse.json({ error: 'Unable to read PDF pages' }, { status: 400 });
    }

    // Phase 3: Extract structural data from PDF
    const pdfData = new Uint8Array(arrayBuffer);
    
    // Step 1: Extract text with coordinates
    const textExtraction = await extractPdfTextWithPositions(pdfData);
    const textItems = textExtraction.success ? textExtraction.textItems : [];
    
    // Step 2: Detect labels (signature, date, name, etc.)
    const labels = findLabels(textItems);
    
    // Step 3: Detect candidate writable areas
    const candidates = detectCandidateAreas(textItems, labels);
    
    // Step 4: Detect AcroForm widgets (if any) - pass File directly
    const widgetDetection = await detectPdfWidgets(file);
    const widgets = widgetDetection.success ? widgetDetection.fields : [];

    // Build structured input payload for AI with text content (capped)
    // Cap text items to prevent payload bloat (max 500 items, ~150 chars each)
    const MAX_TEXT_ITEMS = 500;
    const MAX_TEXT_LENGTH = 150;
    const cappedTextItems = textItems.slice(0, MAX_TEXT_ITEMS).map(item => ({
      text: item.text.length > MAX_TEXT_LENGTH ? item.text.slice(0, MAX_TEXT_LENGTH) + '...' : item.text,
      pageIndex: item.pageIndex,
      rectInPoints: {
        x: Math.round(item.x),
        y: Math.round(item.y),
        width: Math.round(item.width),
        height: Math.round(item.height),
      },
    }));

    const structuredInput = JSON.stringify({
      pages: pageDimensions.map(p => ({
        pageIndex: p.pageIndex,
        width: p.width,
        height: p.height,
      })),
      textItems: cappedTextItems,
      textItemsTotal: textItems.length,
      labels: labels.map(l => ({
        id: l.id,
        text: l.text,
        type: l.type,
        pageIndex: l.pageIndex,
        confidence: l.confidence,
        rectInPoints: {
          x: Math.round(l.rect.x),
          y: Math.round(l.rect.y),
          width: Math.round(l.rect.width),
          height: Math.round(l.rect.height),
        },
      })),
      candidates: candidates.map(c => ({
        id: c.id,
        pageIndex: c.pageIndex,
        typeHint: c.typeHint,
        nearbyLabelTypes: c.nearbyLabelTypes,
        score: c.score,
        source: c.source,
        rectInPoints: {
          x: Math.round(c.rect.x),
          y: Math.round(c.rect.y),
          width: Math.round(c.rect.width),
          height: Math.round(c.rect.height),
        },
      })),
      widgets: widgets.map(w => ({
        name: w.fieldName,
        type: w.fieldType,
        pageIndex: w.pageIndex,
        required: w.required,
      })),
    }, null, 2);

    const hasStructuralData = textItems.length > 0 || candidates.length > 0 || widgets.length > 0;

    const result = await generateObject({
      model: 'google/gemini-2.5-flash-lite',
      schema: WaiverClassificationSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: hasStructuralData
                ? `You are analyzing a volunteer waiver/consent PDF with structured data extraction.

**YOUR TASK**: Select appropriate candidate IDs for form fields based on the provided structural data.

**COORDINATE SYSTEM**: All coordinates are in PDF points with BOTTOM-LEFT origin (y increases upward from page bottom).

**STRUCTURED INPUT DATA**:
${structuredInput}

**INSTRUCTIONS**:

1. **Review the structured data**:
   - Pages: dimensions and count
   - Labels: detected field labels with types (signature, date, name, etc.)
   - Candidates: detected writable areas (underscore runs, right-of-label gaps) with type hints
   - Widgets: AcroForm fields if present

2. **Select candidate IDs**:
   - For each field you want to include, SELECT a candidateId from the candidates array
   - Use the candidate's typeHint, nearbyLabelTypes, and score to guide selection
   - Prioritize candidates with high scores and matching type hints

3. **Classify fields**:
   - Assign appropriate fieldType (signature, date, name, email, etc.)
   - Assign signerRole (volunteer, parent, guardian, witness, etc.)
   - Create descriptive labels
   - Mark fields as required based on waiver language

4. **Detect signer roles**:
   - Identify all signer roles mentioned in the waiver
   - Common patterns: volunteer, participant, parent/guardian, witness
   - Mark roles as required if explicitly stated

5. **DO NOT generate coordinates**:
   - You select candidate IDs, NOT coordinates
   - The system will map your selections to bounding boxes automatically

**EDGE CASES**:
- If no candidates available: return empty selectedFields array
- If candidate type hint doesn't match field type: you can override with reasoning
- Multiple candidates for same label: select the highest-scoring one

**FALLBACK**:
If structural data is empty or insufficient, you can still analyze the PDF visually, but you won't be able to reference candidate IDs (return empty selectedFields).`
                : `You are analyzing a volunteer waiver/consent PDF (vision-only fallback - no structural data available).

This PDF has no extractable text or detected candidates. Analyze the visual PDF to:
1. Identify signer roles
2. Provide a summary
3. Return recommendations

Return empty selectedFields array since no candidates are available.`,
            },
            {
              type: 'file',
              data: pdfData,
              mediaType: 'application/pdf',
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    // Map selected candidate IDs to bounding boxes
    const fieldsFromCandidates = result.object.selectedFields
      .map(selection => {
        const candidate = candidates.find(c => c.id === selection.candidateId);
        if (!candidate) {
          // Invalid candidateId - skip this field
          console.warn(`Candidate ID not found: ${selection.candidateId}`);
          return null;
        }

        return {
          fieldType: selection.fieldType,
          label: selection.label,
          signerRole: normalizeRoleKey(selection.signerRole),
          pageIndex: candidate.pageIndex,
          boundingBox: {
            x: candidate.rect.x,
            y: candidate.rect.y,
            width: candidate.rect.width,
            height: candidate.rect.height,
          },
          required: selection.required,
          notes: selection.reasoning,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    // Normalize signer roles
    const normalizedSignerRoles = normalizeSignerRoles(result.object.signerRoles);

    return NextResponse.json({
      success: true,
      analysis: {
        pageCount,
        pageDimensions,
        signerRoles: normalizedSignerRoles,
        fields: fieldsFromCandidates,
        summary: result.object.summary,
        recommendations: result.object.recommendations,
      },
    });

  } catch (error) {
    console.error('AI waiver analysis error:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze waiver',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
