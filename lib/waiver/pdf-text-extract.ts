import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure PDF.js worker (same pattern as pdf-field-detect.ts)
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
}

let serverWorkerReadyPromise: Promise<void> | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function ensurePdfJsWorkerReady() {
  if (typeof window !== 'undefined') return;

  const globalWithWorker = globalThis as typeof globalThis & {
    pdfjsWorker?: { WorkerMessageHandler?: unknown };
  };

  if (globalWithWorker.pdfjsWorker?.WorkerMessageHandler) {
    return;
  }

  if (!serverWorkerReadyPromise) {
    const workerModulePath = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    serverWorkerReadyPromise = import(workerModulePath)
      .then((workerModule) => {
        const workerExport = (workerModule as { default?: unknown }).default ?? workerModule;
        globalWithWorker.pdfjsWorker = workerExport as { WorkerMessageHandler?: unknown };
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Failed to preload pdf.js worker module:', error);
        }
      });
  }

  await serverWorkerReadyPromise;
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

    await ensurePdfJsWorkerReady();

    // Load PDF document with low-noise options.
    // - verbosity: errors only (suppresses expected warnings in tests)
    // - useSystemFonts/disableFontFace: reduces standard-font warnings for text extraction flows
    const documentParams: Record<string, unknown> = {
      data: pdfData,
      verbosity: (pdfjsLib as unknown as { VerbosityLevel?: { ERRORS?: number } }).VerbosityLevel?.ERRORS ?? 0,
      useSystemFonts: true,
      disableFontFace: true,
    };
    const loadingTask = pdfjsLib.getDocument(documentParams);
    pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;

    const allTextItems: PdfTextItem[] = [];

    // Process each page
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;

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
        // NOTE: pdf.js textItem.width/height are already in page-space units.
        // Using raw matrix scaling again causes double-scaling (giant boxes).
        // We therefore normalize transform vectors to keep rotation/shear only,
        // then apply page-space width/height once.
        const [a, b, c, d, e, f] = textItem.transform;

        const scaleX = Math.hypot(a, b) || 1;
        const scaleY = Math.hypot(c, d) || 1;

        // Rotation/shear basis without scale
        const na = a / scaleX;
        const nb = b / scaleX;
        const nc = c / scaleY;
        const nd = d / scaleY;

        const rawWidth = Number.isFinite(textItem.width) && textItem.width > 0
          ? textItem.width
          : scaleX;
        const rawHeight = Number.isFinite(textItem.height) && textItem.height > 0
          ? textItem.height
          : scaleY;
        
        // Compute bounding box using full transform matrix
        // Text rectangle in local space: (0, 0) to (width, height)
        // Transform the four corners to get the bounding box in PDF space
        const corners = [
          { x: 0, y: 0 },                          // bottom-left
          { x: rawWidth, y: 0 },             // bottom-right
          { x: 0, y: rawHeight },            // top-left
          { x: rawWidth, y: rawHeight }, // top-right
        ];
        
        // Apply transform matrix to each corner
        const transformedCorners = corners.map(corner => ({
          x: na * corner.x + nc * corner.y + e,
          y: nb * corner.x + nd * corner.y + f,
        }));
        
        // Find bounding box (min/max of transformed corners)
        const xs = transformedCorners.map(p => p.x);
        const ys = transformedCorners.map(p => p.y);
        
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        
        // Clamp bbox to page bounds. If clamp collapses the box, fall back to
        // a conservative axis-aligned box from origin and page-space sizes.
        const clampedMinX = clamp(minX, 0, pageWidth);
        const clampedMinY = clamp(minY, 0, pageHeight);
        const clampedMaxX = clamp(maxX, 0, pageWidth);
        const clampedMaxY = clamp(maxY, 0, pageHeight);

        let finalX = clampedMinX;
        let finalY = clampedMinY;
        let finalWidth = Math.max(0, clampedMaxX - clampedMinX);
        let finalHeight = Math.max(0, clampedMaxY - clampedMinY);

        if (finalWidth <= 0 || finalHeight <= 0) {
          const fallbackWidth = clamp(rawWidth, 1, pageWidth);
          const fallbackHeight = clamp(rawHeight, 1, pageHeight);
          finalX = clamp(e, 0, Math.max(pageWidth - fallbackWidth, 0));
          finalY = clamp(f, 0, Math.max(pageHeight - fallbackHeight, 0));
          finalWidth = fallbackWidth;
          finalHeight = fallbackHeight;
        }

        // In PDF coordinate space, y represents the bottom of the bbox
        allTextItems.push({
          text: textItem.str,
          x: finalX,
          y: finalY,  // bottom of bbox (bottom-left origin)
          width: finalWidth,
          height: finalHeight,
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
    if (process.env.NODE_ENV !== 'test') {
      console.error('PDF text extraction error:', error);
    }
    
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
