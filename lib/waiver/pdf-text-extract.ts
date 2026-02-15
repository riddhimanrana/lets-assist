import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure PDF.js worker (same pattern as pdf-field-detect.ts)
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
}

/**
 * A text item with precise bounding box coordinates in PDF space.
 */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number; // 0-based
}

/**
 * Result of PDF text extraction.
 */
export interface PdfTextExtractionResult {
  success: boolean;
  textItems: PdfTextItem[];
  pageCount: number;
  error?: string;
}

/**
 * Extract text content with precise bounding boxes from a PDF.
 * 
 * Uses PDF.js to extract text items with their coordinates in PDF coordinate space:
 * - Origin: bottom-left corner
 * - Y-axis: increases upward
 * - Units: points (1/72 inch)
 * 
 * Bounding boxes are computed using the full transform matrix to handle rotated/skewed text.
 * 
 * @param pdfData - PDF file data as Uint8Array
 * @returns Text extraction result with coordinates
 */
export async function extractPdfTextWithPositions(
  pdfData: Uint8Array
): Promise<PdfTextExtractionResult> {
  let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
  
  try {
    // Validate input
    if (!pdfData || pdfData.length === 0) {
      return {
        success: false,
        textItems: [],
        pageCount: 0,
        error: 'Empty or invalid PDF data',
      };
    }

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;

    const allTextItems: PdfTextItem[] = [];

    // Process each page
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Extract text items with positions
      for (const item of textContent.items) {
        // Type guard: ensure item has required properties
        if (!('str' in item) || !('transform' in item) || !('width' in item) || !('height' in item)) {
          continue;
        }

        const textItem = item as {
          str: string;
          transform: number[];
          width: number;
          height: number;
        };

        // Skip empty text
        if (!textItem.str || textItem.str.trim().length === 0) {
          continue;
        }

        // Extract transform matrix: [a, b, c, d, e, f]
        // a, b: x-axis scaling and rotation
        // c, d: y-axis scaling and rotation
        // e, f: translation (position)
        const [a, b, c, d, e, f] = textItem.transform;
        
        // Compute bounding box using full transform matrix
        // Text rectangle in local space: (0, 0) to (width, height)
        // Transform the four corners to get the bounding box in PDF space
        const corners = [
          { x: 0, y: 0 },                          // bottom-left
          { x: textItem.width, y: 0 },             // bottom-right
          { x: 0, y: textItem.height },            // top-left
          { x: textItem.width, y: textItem.height }, // top-right
        ];
        
        // Apply transform matrix to each corner
        const transformedCorners = corners.map(corner => ({
          x: a * corner.x + c * corner.y + e,
          y: b * corner.x + d * corner.y + f,
        }));
        
        // Find bounding box (min/max of transformed corners)
        const xs = transformedCorners.map(p => p.x);
        const ys = transformedCorners.map(p => p.y);
        
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        
        // In PDF coordinate space, y represents the bottom of the bbox
        allTextItems.push({
          text: textItem.str,
          x: minX,
          y: minY,  // bottom of bbox (bottom-left origin)
          width: maxX - minX,
          height: maxY - minY,
          pageIndex: pageNum - 1, // Convert to 0-based
        });
      }
    }

    return {
      success: true,
      textItems: allTextItems,
      pageCount,
    };
  } catch (error) {
    console.error('PDF text extraction error:', error);
    
    return {
      success: false,
      textItems: [],
      pageCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error during PDF text extraction',
    };
  } finally {
    // Clean up PDF document to prevent memory leaks
    if (pdfDocument) {
      pdfDocument.destroy();
    }
  }
}
