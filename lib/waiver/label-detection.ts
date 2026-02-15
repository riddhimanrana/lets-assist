import { PdfTextItem } from './pdf-text-extract';
import { createHash } from 'crypto';

/**
 * Type of waiver label detected in PDF text
 */
export type WaiverLabelType =
  | 'signature'
  | 'date'
  | 'printed_name'
  | 'parent_guardian'
  | 'initials'
  | 'witness'
  | 'other';

/**
 * A detected label in a waiver PDF with position and classification
 */
export interface DetectedLabel {
  id: string;
  text: string;
  normalizedText: string;
  type: WaiverLabelType;
  pageIndex: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

/**
 * Find waiver field labels in PDF text items using keyword/pattern matching.
 * 
 * Uses robust case-insensitive matching for common waiver labels like:
 * - signature, sign here, signer signature
 * - date, signed on
 * - print name, printed name, name (context-aware)
 * - parent/guardian, guardian signature
 * - initials
 * - witness
 * 
 * Coordinates are preserved in PDF bottom-left coordinate space.
 * 
 * @param textItems - PDF text items with positions
 * @returns Array of detected labels with classifications
 */
export function findLabels(textItems: PdfTextItem[]): DetectedLabel[] {
  if (!textItems || textItems.length === 0) {
    return [];
  }

  const labels: DetectedLabel[] = [];

  for (const item of textItems) {
    const normalized = normalizeText(item.text);
    
    // Skip empty or very short text
    if (normalized.length < 2) {
      continue;
    }

    // Detect label type and confidence
    const detection = detectLabelType(normalized, item.text);
    
    if (detection.type !== 'other') {
      // Generate deterministic ID
      const id = generateLabelId(item, normalized);
      
      labels.push({
        id,
        text: item.text,
        normalizedText: normalized,
        type: detection.type,
        pageIndex: item.pageIndex,
        rect: {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
        confidence: detection.confidence,
      });
    }
  }

  return labels;
}

/**
 * Normalize text for comparison (lowercase, trim, collapse whitespace)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Detect the type of label from normalized text
 */
function detectLabelType(
  normalized: string,
  original: string
): { type: WaiverLabelType; confidence: number } {
  // Priority order: more specific patterns first

  // Parent/Guardian - check before generic signature, use word boundaries
  if (
    /\b(parent|guardian)\b/.test(normalized)
  ) {
    return { type: 'parent_guardian', confidence: 0.95 };
  }

  // Witness - use word boundary
  if (/\bwitness\b/.test(normalized)) {
    return { type: 'witness', confidence: 0.95 };
  }

  // Initials - check before signature (since signature is more generic), use word boundary
  if (
    /\binitial(s)?\b/.test(normalized) &&
    !normalized.includes('signature')
  ) {
    return { type: 'initials', confidence: 0.9 };
  }

  // Signature patterns
  if (
    /\bsignature\b/.test(normalized) ||
    /\bsigner\b/.test(normalized) ||
    (/\bsign\b/.test(normalized) && /\bhere\b/.test(normalized))
  ) {
    return { type: 'signature', confidence: 0.9 };
  }

  // Date patterns - check after signature to catch "signed on" properly, use word boundaries
  if (
    (/\bdate\b/.test(normalized) && !isDateInSentence(normalized)) ||
    /\bsigned on\b/.test(normalized) ||
    (/\bsigned\b/.test(normalized) && /\bdate\b/.test(normalized))
  ) {
    return { type: 'date', confidence: 0.9 };
  }

  // Printed name patterns - be context-aware
  if (
    (normalized.includes('print') && normalized.includes('name')) ||
    (normalized.includes('printed') && normalized.includes('name')) ||
    (normalized === 'name:' || normalized === 'name')
  ) {
    return { type: 'printed_name', confidence: 0.85 };
  }

  // Standalone "Name:" at end of text (with colon)
  if (original.trim().match(/^name\s*:?\s*$/i)) {
    return { type: 'printed_name', confidence: 0.8 };
  }

  return { type: 'other', confidence: 0 };
}

/**
 * Check if "date" appears in a sentence context (to avoid false positives)
 */
function isDateInSentence(normalized: string): boolean {
  // If text is short and contains colon, it's likely a label
  if (normalized.length < 15 && normalized.includes(':')) {
    return false;
  }

  // Check for sentence patterns that indicate it's not a label
  const sentenceIndicators = [
    'the date is',
    'the date was',
    'a date',
    'date is important',
    'date must',
    'date should',
  ];

  return sentenceIndicators.some(indicator => normalized.includes(indicator));
}

/**
 * Generate a deterministic ID for a label based on position and text
 */
function generateLabelId(item: PdfTextItem, normalizedText: string): string {
  // Create a stable string representation including width/height for collision prevention
  const stableString = `${item.pageIndex}-${Math.round(item.x)}-${Math.round(item.y)}-${Math.round(item.width)}-${Math.round(item.height)}-${normalizedText}`;
  
  // Generate a short hash
  const hash = createHash('sha256')
    .update(stableString)
    .digest('hex')
    .substring(0, 12);
  
  return `label-${hash}`;
}
