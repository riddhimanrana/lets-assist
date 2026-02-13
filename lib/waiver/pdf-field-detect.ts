import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  // Use unpkg CDN with HTTPS for reliable worker loading
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
}

// Type definitions for PDF.js annotation objects
interface PdfJsAnnotation {
  subtype?: string;
  fieldName?: string;
  fieldType?: string;
  alternativeText?: string;
  rect?: number[];
  fieldFlags?: number;
  fieldValue?: string | number | boolean;
  defaultValue?: string | number | boolean;
}

export interface PdfFieldDetectionResult {
  success: boolean;
  fields: DetectedPdfField[];
  pageCount: number;
  hasSignatureFields: boolean;
  errors?: string[];
}

export interface DetectedPdfField {
  fieldName: string;
  fieldType: 'signature' | 'text' | 'checkbox' | 'radio' | 'dropdown' | 'button' | 'unknown';
  pageIndex: number; // 0-based
  rect: PdfRect; // PDF coordinates (points)
  required?: boolean;
  defaultValue?: string;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Detect PDF form fields using PDF.js annotation extraction.
 * Supports both File objects (browser) and URLs (server).
 */
export async function detectPdfWidgets(
  source: File | string
): Promise<PdfFieldDetectionResult> {
  const errors: string[] = [];

  try {
    // Load PDF document
    let pdfData: ArrayBuffer | Uint8Array;

    if (source instanceof File) {
      // Browser: File object
      pdfData = await source.arrayBuffer();
    } else {
      // Server/Browser: URL
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.statusText}`);
      }
      pdfData = await response.arrayBuffer();
    }

    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdfDocument = await loadingTask.promise;

    const pageCount = pdfDocument.numPages;
    const allFields: DetectedPdfField[] = [];

    // Iterate through all pages
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const annotations = await page.getAnnotations();

      // Filter for widget annotations (form fields)
      const widgets = (annotations as PdfJsAnnotation[]).filter((ann) => ann.subtype === 'Widget');

      for (const annotation of widgets) {
        const field = normalizeAnnotation(annotation, pageNum - 1);
        if (field) {
          allFields.push(field);
        }
      }
    }

    const hasSignatureFields = allFields.some(f => f.fieldType === 'signature');

    return {
      success: true,
      fields: allFields,
      pageCount,
      hasSignatureFields,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error('PDF.js detection error:', error);
    
    // Fallback to naive detection
    try {
      let arrayBuffer: ArrayBuffer;
      
      if (source instanceof File) {
        arrayBuffer = await source.arrayBuffer();
      } else {
        const response = await fetch(source);
        arrayBuffer = await response.arrayBuffer();
      }
      
      const fallbackResult = detectPdfSignaturesNaive(arrayBuffer);
      
      return {
        success: false,
        fields: [],
        pageCount: 0,
        hasSignatureFields: fallbackResult.hasSignatureFields,
        errors: [
          `PDF.js detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          `Fallback detection confidence: ${fallbackResult.confidence}`,
        ],
      };
    } catch (fallbackError) {
      return {
        success: false,
        fields: [],
        pageCount: 0,
        hasSignatureFields: false,
        errors: [
          `PDF.js detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          `Fallback detection also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
        ],
      };
    }
  }
}

/**
 * Fallback: naive byte-string detection for when PDF.js fails.
 * Returns basic info without coordinates.
 */
export function detectPdfSignaturesNaive(
  pdfBytes: ArrayBuffer
): { hasSignatureFields: boolean; confidence: 'low' | 'medium' } {
  try {
    const bytes = new Uint8Array(pdfBytes);
    const pdfText = new TextDecoder('latin1').decode(bytes);

    // Check for signature-related PDF structures
    const hasAcroForm = pdfText.includes('/AcroForm');
    const hasSigField = pdfText.includes('/Sig');
    const hasSigFlags = pdfText.includes('/SigFlags');
    const hasSignatureKeyword = pdfText.includes('signature') || pdfText.includes('Signature');
    const hasWidget = pdfText.includes('/Widget');

    // Higher confidence if multiple indicators present
    if (hasAcroForm && (hasSigField || hasSigFlags)) {
      return { hasSignatureFields: true, confidence: 'medium' };
    }

    // Lower confidence based on keyword presence
    if (hasWidget && hasSignatureKeyword) {
      return { hasSignatureFields: true, confidence: 'low' };
    }

    if (hasSigField || hasSigFlags) {
      return { hasSignatureFields: true, confidence: 'low' };
    }

    return { hasSignatureFields: false, confidence: 'low' };
  } catch (error) {
    console.error('Naive detection error:', error);
    return { hasSignatureFields: false, confidence: 'low' };
  }
}

/**
 * Helper: Convert PDF.js annotation to normalized field.
 */
function normalizeAnnotation(annotation: PdfJsAnnotation, pageIndex: number): DetectedPdfField | null {
  try {
    const fieldName = annotation.fieldName || annotation.alternativeText || `field_${pageIndex}_${Math.random().toString(36).substr(2, 9)}`;
    const fieldType = mapFieldType(annotation.fieldType);

    // Extract rectangle coordinates
    // PDF.js returns rect as [x1, y1, x2, y2] in PDF coordinates
    const rect = annotation.rect;
    if (!rect || rect.length < 4) {
      return null;
    }

    const [x1, y1, x2, y2] = rect;
    const pdfRect: PdfRect = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };

    // Check if field is required
    // fieldFlags bit 2 indicates required field
    const required = annotation.fieldFlags ? (annotation.fieldFlags & 2) !== 0 : false;

    // Extract default value if present
    const defaultValue = annotation.fieldValue || annotation.defaultValue || undefined;

    return {
      fieldName,
      fieldType,
      pageIndex,
      rect: pdfRect,
      required,
      defaultValue: defaultValue ? String(defaultValue) : undefined,
    };
  } catch (error) {
    console.error('Error normalizing annotation:', error);
    return null;
  }
}

/**
 * Helper: Map PDF.js field types to our simplified types.
 */
function mapFieldType(fieldType: string | undefined): DetectedPdfField['fieldType'] {
  if (!fieldType) return 'unknown';

  const type = fieldType.toLowerCase();

  // PDF field type mapping
  // Reference: PDF Reference 1.7, Section 8.6.3
  if (type.includes('sig')) return 'signature';
  if (type.includes('tx') || type.includes('text')) return 'text';
  if (type.includes('btn')) {
    // Button can be checkbox, radio, or push button
    // We'd need to check buttonFlags for more precision
    // For now, default to checkbox
    return 'checkbox';
  }
  if (type.includes('ch')) {
    // Choice field can be dropdown or listbox
    return 'dropdown';
  }

  return 'unknown';
}
