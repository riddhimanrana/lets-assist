import { NextRequest, NextResponse } from 'next/server';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { PDFDocument } from 'pdf-lib';
import { extractPdfTextWithPositions } from '@/lib/waiver/pdf-text-extract';
import { findLabels } from '@/lib/waiver/label-detection';
import { detectCandidateAreas } from '@/lib/waiver/candidate-detection';
import { detectPdfWidgets } from '@/lib/waiver/pdf-field-detect';
import type { CandidateArea } from '@/lib/waiver/candidate-detection';
import type { DetectedPdfField } from '@/lib/waiver/pdf-field-detect';

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

const ENABLE_VISION_FALLBACK = true;

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

const VisionDetectedFieldSchema = z.object({
  fieldType: z.enum(FIELD_TYPES).describe('Type of form field'),
  label: z.string().describe('Human-readable label for this field'),
  signerRole: z.string().describe('Who should fill this field (e.g., volunteer, parent, guardian)'),
  pageIndex: z.number().int().nonnegative().describe('Page index (prefer 0-based; 1-based accepted and normalized)'),
  normalizedBoxTopLeft: z.object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().min(0),
    height: z.number().min(0),
  }).describe('Box using TOP-LEFT origin. Values may be normalized (0..1) OR absolute page units.'),
  required: z.boolean(),
  reasoning: z.string().optional(),
});

const VisionFallbackSchema = z.object({
  fields: z.array(VisionDetectedFieldSchema),
  signerRoles: z.array(
    z.object({
      roleKey: z.string(),
      label: z.string(),
      required: z.boolean(),
      description: z.string().optional(),
    })
  ).optional(),
  summary: z.string().optional(),
  recommendations: z.array(z.string()).optional(),
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

export interface SelectableCandidate {
  id: string;
  pageIndex: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  typeHint: string;
  score: number;
  source: 'widget' | 'underscore' | 'right_of_label';
  nearbyLabelTypes?: string[];
  required?: boolean;
  label?: string;
}

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

function getIou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;

  if (interArea === 0) return 0;

  const areaA = Math.max(0, a.width) * Math.max(0, a.height);
  const areaB = Math.max(0, b.width) * Math.max(0, b.height);
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

function toFieldTypeHint(raw: string): typeof FIELD_TYPES[number] {
  const normalized = raw.toLowerCase();

  if (normalized === 'printed_name') return 'name';
  if (normalized === 'initials') return 'initial';
  if (normalized === 'parent_guardian' || normalized === 'witness' || normalized === 'other') return 'text';

  if ((FIELD_TYPES as readonly string[]).includes(normalized)) {
    return normalized as typeof FIELD_TYPES[number];
  }

  return 'text';
}

function inferWidgetFieldType(widget: DetectedPdfField): typeof FIELD_TYPES[number] {
  const base = toFieldTypeHint(widget.fieldType);
  if (base !== 'text') {
    return base;
  }

  const name = (widget.fieldName || '').toLowerCase();

  if (/signature|sign_here|signer_sign|parent_sign|guardian_sign/.test(name)) return 'signature';
  if (/initial/.test(name)) return 'initial';
  if (/date|signed_on|dob/.test(name)) return 'date';
  if (/name|print_name|printed_name/.test(name)) return 'name';
  if (/email|e_mail/.test(name)) return 'email';
  if (/phone|mobile|cell/.test(name)) return 'phone';

  return 'text';
}

function toDefaultFieldLabel(fieldName: string, typeHint: string): string {
  const cleaned = fieldName
    .replace(/[_-]+/g, ' ')
    .trim();

  if (cleaned.length > 0) {
    return cleaned
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  return `Field (${typeHint})`;
}

function defaultLabelForType(fieldType: typeof FIELD_TYPES[number]) {
  switch (fieldType) {
    case 'signature':
      return 'Signature';
    case 'initial':
      return 'Initials';
    case 'date':
      return 'Date';
    case 'name':
      return 'Name';
    case 'email':
      return 'Email';
    case 'phone':
      return 'Phone';
    case 'address':
      return 'Address';
    default:
      return 'Text';
  }
}

function shouldIncludeFallbackCandidate(candidate: SelectableCandidate) {
  if (candidate.source === 'widget') return false;

  const allowedTypes = new Set<typeof FIELD_TYPES[number]>([
    'signature',
    'initial',
    'date',
    'name',
    'email',
    'phone',
    'address',
  ]);

  if (allowedTypes.has(candidate.typeHint as typeof FIELD_TYPES[number])) {
    return candidate.score >= 0.25;
  }

  if (candidate.nearbyLabelTypes?.length) {
    return candidate.score >= 0.35;
  }

  return false;
}

function buildFallbackFieldsFromCandidates(
  candidates: SelectableCandidate[],
  signerRoleKey: string
): ParsedField[] {
  const filtered = candidates
    .filter(shouldIncludeFallbackCandidate)
    .slice(0, 40);

  return filtered.map((candidate) => {
    const fieldType = toFieldTypeHint(candidate.typeHint);

    return {
      fieldType,
      label: candidate.label || defaultLabelForType(fieldType),
      signerRole: signerRoleKey,
      pageIndex: candidate.pageIndex,
      boundingBox: {
        x: candidate.rect.x,
        y: candidate.rect.y,
        width: candidate.rect.width,
        height: candidate.rect.height,
      },
      required: candidate.required ?? fieldType === 'signature',
      notes: 'Fallback from candidate detection (underscores/boxes)',
    };
  });
}

export function buildSelectableCandidates(
  candidates: CandidateArea[],
  widgets: DetectedPdfField[]
): SelectableCandidate[] {
  const widgetCandidates: SelectableCandidate[] = widgets
    .filter((w) => w.fieldType !== 'unknown' && w.fieldType !== 'button')
    .map((w, index) => ({
      id: `widget:${w.pageIndex}:${index}:${w.fieldName || 'field'}`,
      pageIndex: w.pageIndex,
      rect: {
        x: w.rect.x,
        y: w.rect.y,
        width: w.rect.width,
        height: w.rect.height,
      },
      typeHint: inferWidgetFieldType(w),
      score: 1,
      source: 'widget',
      nearbyLabelTypes: [],
      required: w.required,
      label: toDefaultFieldLabel(w.fieldName, w.fieldType),
    }));

  const lineCandidates: SelectableCandidate[] = candidates.map((c) => ({
    id: c.id,
    pageIndex: c.pageIndex,
    rect: c.rect,
    typeHint: toFieldTypeHint(c.typeHint),
    score: c.score,
    source: c.source,
    nearbyLabelTypes: c.nearbyLabelTypes,
  }));

  return [...widgetCandidates, ...lineCandidates].sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;

    // Phase 5: deterministically prioritize widgets on score ties.
    if (a.source === 'widget' && b.source !== 'widget') return -1;
    if (b.source === 'widget' && a.source !== 'widget') return 1;

    return a.id.localeCompare(b.id);
  });
}

export function mapSelectionsToFields(
  selections: z.infer<typeof SelectedFieldSchema>[],
  selectableCandidates: SelectableCandidate[]
): ParsedField[] {
  const shouldLogWarnings = process.env.NODE_ENV !== 'test';
  const candidateById = new Map(selectableCandidates.map((c) => [c.id, c]));

  const mapped = selections
    .map((selection) => {
      const selected = candidateById.get(selection.candidateId);
      if (!selected) {
        if (shouldLogWarnings) {
          console.warn(`Candidate ID not found: ${selection.candidateId}`);
        }
        return null;
      }

      // Phase 6: Validate candidate has finite coordinates (reject NaN/Infinity)
      // Note: Negative coordinates are allowed here - normalization will fix them
      const hasValidCoordinates = (
        Number.isFinite(selected.rect.x) &&
        Number.isFinite(selected.rect.y) &&
        Number.isFinite(selected.rect.width) &&
        Number.isFinite(selected.rect.height)
      );

      if (!hasValidCoordinates) {
        if (shouldLogWarnings) {
          console.warn(`Candidate has invalid coordinates: ${selection.candidateId}`, selected.rect);
        }
        return null;
      }

      const field: ParsedField = {
        fieldType: selection.fieldType,
        label: selection.label,
        signerRole: normalizeRoleKey(selection.signerRole),
        pageIndex: selected.pageIndex,
        boundingBox: {
          x: selected.rect.x,
          y: selected.rect.y,
          width: selected.rect.width,
          height: selected.rect.height,
        },
        required: selection.required,
      };

      if (selection.reasoning) {
        field.notes = selection.reasoning;
      }

      return field;
    });

  return mapped.filter((f): f is ParsedField => f !== null);
}

export function mapWidgetsToFields(widgets: DetectedPdfField[]): ParsedField[] {
  return widgets
    .filter((w) => w.fieldType !== 'unknown' && w.fieldType !== 'button')
    .map((w) => ({
      fieldType: inferWidgetFieldType(w),
      label: toDefaultFieldLabel(w.fieldName, w.fieldType),
      signerRole: 'volunteer',
      pageIndex: w.pageIndex,
      boundingBox: {
        x: w.rect.x,
        y: w.rect.y,
        width: w.rect.width,
        height: w.rect.height,
      },
      required: Boolean(w.required),
      notes: 'Detected from embedded PDF form widget',
    }));
}

export function mapVisionFallbackFields(
  fields: z.infer<typeof VisionDetectedFieldSchema>[],
  pageDimensions: PageDimension[],
  pageCount: number
): ParsedField[] {
  const rawIndexes = fields.map((field) => Math.round(safeNumber(field.pageIndex, 0)));
  const convertFromOneBased = shouldConvertFromOneBased(rawIndexes, pageCount);

  const mapped: ParsedField[] = fields.map((field) => {
    const rawIndex = Math.round(safeNumber(field.pageIndex, 0));
    const clampedIndex = normalizePageIndex(rawIndex, pageCount, convertFromOneBased);
    const page = pageDimensions[clampedIndex] ?? pageDimensions[0];

    const nx = safeNumber(field.normalizedBoxTopLeft.x, 0);
    const nyTop = safeNumber(field.normalizedBoxTopLeft.y, 0);
    const nwidth = safeNumber(field.normalizedBoxTopLeft.width, 0);
    const nheight = safeNumber(field.normalizedBoxTopLeft.height, 0);

    const width = nwidth <= 1 ? nwidth * page.width : nwidth;
    const height = nheight <= 1 ? nheight * page.height : nheight;
    const x = nx <= 1 ? nx * page.width : nx;
    const yTop = nyTop <= 1 ? nyTop * page.height : nyTop;
    const y = page.height - yTop - height;

    return {
      fieldType: field.fieldType,
      label: field.label,
      signerRole: field.signerRole,
      pageIndex: clampedIndex,
      boundingBox: { x, y, width, height },
      required: field.required,
      notes: field.reasoning,
    };
  });

  return normalizeFieldsForOverlay(mapped, pageDimensions, pageCount, { convertFromOneBased: false });
}

export function mergeFieldsPreferWidgets(widgetFields: ParsedField[], aiFields: ParsedField[]): ParsedField[] {
  const merged: ParsedField[] = [...widgetFields];

  for (const aiField of aiFields) {
    const overlappingWidgetIndex = merged.findIndex((widgetField) => {
      if (widgetField.pageIndex !== aiField.pageIndex) return false;
      const iou = getIou(widgetField.boundingBox, aiField.boundingBox);
      if (iou < 0.5) return false;

      // Widget extraction often returns generic "text" fields for semantically specific inputs.
      const typeCompatible =
        widgetField.fieldType === aiField.fieldType ||
        widgetField.fieldType === 'text' ||
        aiField.fieldType === 'text';

      return typeCompatible;
    });

    if (overlappingWidgetIndex >= 0) {
      // Keep widget geometry (authoritative), but preserve AI semantic metadata.
      const widgetField = merged[overlappingWidgetIndex];
      merged[overlappingWidgetIndex] = {
        ...widgetField,
        label: aiField.label || widgetField.label,
        signerRole: aiField.signerRole || widgetField.signerRole,
        required: aiField.required || widgetField.required,
        notes: aiField.notes ?? widgetField.notes,
      };
      continue;
    }

    merged.push(aiField);
  }

  return merged;
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
  pageCount: number,
  options?: {
    convertFromOneBased?: boolean;
  }
): ParsedField[] {
  const pageIndexes = fields.map((f) => Math.round(safeNumber(f.pageIndex, 0)));
  const convertFromOneBased = options?.convertFromOneBased ?? shouldConvertFromOneBased(pageIndexes, pageCount);

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
    const pdfBytes = Buffer.from(arrayBuffer);

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
    const pdfData = new Uint8Array(arrayBuffer.slice(0));
    
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

    // Phase 5: Build unified selectable candidates (widgets first, then inferred line/box candidates)
    const selectableCandidates = buildSelectableCandidates(candidates, widgets);

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
      candidates: selectableCandidates.map(c => ({
        id: c.id,
        pageIndex: c.pageIndex,
        typeHint: c.typeHint,
        nearbyLabelTypes: c.nearbyLabelTypes ?? [],
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

    const result = await generateText({
      model: 'google/gemini-2.5-flash-lite',
      output: Output.object({ schema: WaiverClassificationSchema }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are analyzing a volunteer waiver/consent PDF to detect signature and form fields.

**YOUR TASK**: Look at the PDF visually and select the best candidate IDs for signature fields, dates, names, and other form fields.
Your output MUST maximize field coverage for all signer sections.

**COORDINATE SYSTEM**: All coordinates are in PDF points with BOTTOM-LEFT origin (y increases upward from page bottom).

**AVAILABLE CANDIDATES**:
${structuredInput}

**INSTRUCTIONS**:

1. **Look at the PDF visually** and identify where signatures, dates, names, initials, email, and phone fields should be filled in.

2. **For each field you find**:
   - Look at the candidates array and find the candidateId that best matches the visual location
   - The candidate should be near the label and in a logical fill-in location
   - Prefer candidates with higher scores and matching typeHints
  - If the form has repeated sections (e.g., volunteer + parent/guardian), select candidates for EACH section, not just one

3. **Be direct and accurate**:
   - Select exactly where someone would naturally sign or fill in the field
   - Don't overthink - if you see "Signature:" followed by a line, select that candidate
   - If you see "Date:" with a line or underscores, select that candidate
   - Look for visual cues like lines, underscores, or blank spaces

4. **Classify fields correctly**:
   - signature: Where someone signs their name
   - date: Where a date goes  
   - name: Printed name fields
   - initial: Initial boxes
  - email: Email input fields
  - phone: Cell/phone input fields
   - Assign appropriate signerRole (volunteer, parent, guardian, witness)

5. **Signer-role coverage requirements**:
  - Identify ALL distinct signer roles present in the waiver text
  - If parent/guardian sections exist, include parent/guardian role(s)
  - If witness sections exist, include witness role
  - For each role, include at least one primary field (signature/name/date) when present
  - Do not collapse multiple signer sections into one generic role

6. **If no good candidates exist**:
   - Return empty selectedFields array
   - The system will use vision fallback to detect fields directly

**Key Point**: Trust what you see in the PDF. Select candidates that visually match where fields should be placed and return comprehensive coverage, not minimal coverage.`,
            },
            {
              type: 'file',
              data: pdfBytes,
              mediaType: 'application/pdf',
            },
          ],
        },
      ],
      temperature: 0,
    });
    const structured = result.output;

    // Phase 5: map AI selections from unified candidates, then merge with deterministic widget extraction.
    const aiFields = mapSelectionsToFields(structured.selectedFields, selectableCandidates);
    const widgetFields = mapWidgetsToFields(widgets);
    const mergedFields = mergeFieldsPreferWidgets(widgetFields, aiFields);
    let normalizedFields = normalizeFieldsForOverlay(mergedFields, pageDimensions, pageCount);
    let normalizedSignerRoles = normalizeSignerRoles(structured.signerRoles);
    const defaultSignerRole = normalizedSignerRoles[0]?.roleKey ?? 'volunteer';

    const hasParentGuardianSignals = labels.some((label) => label.type === 'parent_guardian');
    const hasContactSignals = labels.some((label) => label.type === 'email' || label.type === 'phone');
    const targetMinimumFields = Math.min(Math.max(selectableCandidates.length, 3), 10);
    const underDetected =
      normalizedFields.length < Math.max(3, Math.floor(targetMinimumFields * 0.5)) ||
      (hasParentGuardianSignals && normalizedSignerRoles.length < 2) ||
      (hasContactSignals && !normalizedFields.some((field) => field.fieldType === 'email' || field.fieldType === 'phone'));

    if (normalizedFields.length === 0 && selectableCandidates.length > 0) {
      const fallbackFields = buildFallbackFieldsFromCandidates(selectableCandidates, defaultSignerRole);
      if (fallbackFields.length > 0) {
        normalizedFields = normalizeFieldsForOverlay(fallbackFields, pageDimensions, pageCount);
      }
    }

    // Vision fallback: if no fields were produced from structural path, ask model to return boxes directly.
    if (ENABLE_VISION_FALLBACK && (normalizedFields.length === 0 || underDetected)) {
      try {
        const fallback = await generateText({
          model: 'google/gemini-2.5-flash-lite',
          output: Output.object({ schema: VisionFallbackSchema }),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are analyzing a waiver PDF to detect exactly where signature fields, dates, and other form fields should be placed.

**YOUR TASK**: Look at the PDF and return the bounding boxes for where each field should go.

**IMPORTANT - COORDINATE SYSTEM**:
- Return boxes in TOP-LEFT coordinates
- x: distance from left edge (0 = left, increases right)
- y: distance from TOP edge (0 = top, increases down)  
- width: box width
- height: box height
- Use normalized values between 0 and 1 (e.g., x: 0.1 means 10% from left edge)
- pageIndex: 0-based (0 = first page, 1 = second page)

**WHERE TO PLACE FIELDS**:
Look for these visual cues:
- "Signature:" followed by a line → place signature field ON the line
- "Date:" with underscores or line → place date field there
- "Print Name:" with space → place name field there
- Empty boxes or checkboxes → place checkbox fields there

**BE PRECISE**:
- Place the bounding box exactly where someone would write/sign
- If there's a line for signature, the box should cover that line
- Don't place fields on labels - place them on the writable area
- Make signature boxes wide enough (at least 0.3 width ratio)
- Make date boxes appropriate size (around 0.15 width)

**FIELD TYPES TO DETECT**:
- signature: Where someone signs
- date: Date fields
- name: Printed name  
- initial: Initial boxes
- checkbox: Check boxes
- text: Other text input

**SIGNER ROLES**:
Assign fields to: volunteer, parent, guardian, witness (based on waiver language)

Also return signerRoles with roleKey/label/required. Include all distinct signer sections.

Page dimensions:
${JSON.stringify(pageDimensions)}

Return only high-confidence fields that you can clearly see in the PDF.`,
                },
                {
                  type: 'file',
                  data: pdfBytes,
                  mediaType: 'application/pdf',
                },
              ],
            },
          ],
          temperature: 0,
        });

        const visionFields = mapVisionFallbackFields(fallback.output.fields, pageDimensions, pageCount);
        if (visionFields.length > 0) {
          normalizedFields = normalizeFieldsForOverlay(
            mergeFieldsPreferWidgets(normalizedFields, visionFields),
            pageDimensions,
            pageCount,
          );
        }

        if (fallback.output.signerRoles && fallback.output.signerRoles.length > 0) {
          normalizedSignerRoles = normalizeSignerRoles([
            ...normalizedSignerRoles,
            ...fallback.output.signerRoles,
          ]);
        }
      } catch (fallbackError) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Vision fallback failed, continuing without fallback fields:', fallbackError);
        }
      }
    }

    // Normalize signer roles (computed above)

    return NextResponse.json({
      success: true,
      analysis: {
        pageCount,
        pageDimensions,
        signerRoles: normalizedSignerRoles,
        fields: normalizedFields,
        summary: structured.summary,
        recommendations: structured.recommendations,
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
