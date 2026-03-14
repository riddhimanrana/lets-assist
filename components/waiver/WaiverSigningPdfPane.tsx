"use client";

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, Download, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

// Configure worker (same as in PdfViewerWithOverlay)
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
}

interface WaiverSigningPdfPaneProps {
  pdfUrl: string;
  onDownload?: () => void;
  onPrint?: () => void;
  className?: string;
}

export function WaiverSigningPdfPane({
  pdfUrl,
  onDownload,
  onPrint,
  className
}: WaiverSigningPdfPaneProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0); // Start at 100%
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load PDF
  useEffect(() => {
    // Reset to page 1 when PDF changes
    setCurrentPage(1);

    const loadPdf = async () => {
      if (!pdfUrl) return;
      
      try {
        setLoading(true);
        setError(null);
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const doc = await loadingTask.promise;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setLoading(false);
      } catch (err) {
        console.error("Error loading PDF:", err);
        setError("Failed to load PDF document.");
        setLoading(false);
      }
    };

    loadPdf();
  }, [pdfUrl]);

  // Handle page navigation
  const prevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const nextPage = () => setCurrentPage((p) => Math.min(pageCount, p + 1));
  const zoomIn = () => setScale((s) => Math.min(3.0, s + 0.1));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.1));

  // Fit width logic could be added here to auto-scale on load
  useEffect(() => {
    // If container width is small (mobile), maybe start with "fit width" scale?
    // For now keeping simple manual zoom.
  }, []);

  return (
    <div className={cn("flex flex-col h-full bg-muted overflow-hidden border rounded-md", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-background border-b shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevPage} disabled={currentPage <= 1 || loading} aria-label="Previous Page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs md:text-sm font-medium px-2 whitespace-nowrap">
             {loading ? "-" : `${currentPage} / ${pageCount}`}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextPage} disabled={currentPage >= pageCount || loading} aria-label="Next Page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomOut} disabled={scale <= 0.5 || loading} aria-label="Zoom Out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs md:text-sm font-medium min-w-[3ch] text-center">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomIn} disabled={scale >= 3.0 || loading} aria-label="Zoom In">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {onDownload && (
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={onDownload} title="Download PDF" aria-label="Download PDF">
              <Download className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only sm:ml-2 text-xs">Download</span>
            </Button>
          )}
          {onPrint && (
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={onPrint} title="Print PDF" aria-label="Print PDF">
              <Printer className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only sm:ml-2 text-xs">Print</span>
            </Button>
          )}
        </div>
      </div>

      {/* PDF Viewport */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex justify-center relative bg-muted/50"
      >
        {loading && <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}
        {error && <div className="flex items-center justify-center h-full text-destructive text-sm p-4 text-center">{error}</div>}
        
        {pdfDoc && !loading && (
          <PdfPage
            pdfDoc={pdfDoc}
            pageNumber={currentPage}
            scale={scale}
          />
        )}
      </div>
    </div>
  );
}

interface PdfPageProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}

function PdfPage({
  pdfDoc,
  pageNumber,
  scale,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<pdfjsLib.PageViewport | null>(null);

  // Render Page
  useEffect(() => {
    let renderTask: pdfjsLib.RenderTask | null = null;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const vp = page.getViewport({ scale });
        setViewport(vp);

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = vp.height;
        canvas.width = vp.width;

        const renderContext = {
          canvasContext: context,
          viewport: vp,
          canvas,
        };
        
        renderTask = page.render(renderContext);
        await renderTask.promise;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err && err.name !== 'RenderingCancelledException') {
          console.error("Page render error:", err);
        } else if (err) {
             console.error("Page render error:", err);
        }
      }
    };

    renderPage();

    return () => {
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, pageNumber, scale]);

  if (!viewport) return <div className="w-[300px] h-[400px] bg-background animate-pulse rounded shadow" />;

  return (
    <div className="relative shadow-lg h-fit bg-white">
      <canvas ref={canvasRef} className="block" style={{ width: viewport.width, height: viewport.height }} />
    </div>
  );
}
