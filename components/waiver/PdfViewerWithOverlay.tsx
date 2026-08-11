"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/webpack.mjs";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DetectedPdfField, PdfRect } from "@/lib/waiver/pdf-field-detect";
import { PdfPage } from "./pdf-viewer/PdfPage";
import type { CustomPlacement, PdfViewerValueLayer } from "./pdf-viewer/types";
export type { CustomPlacement, PdfViewerValueLayer } from "./pdf-viewer/types";

interface PdfViewerWithOverlayProps {
  pdfUrl: string;
  detectedFields: DetectedPdfField[];
  customPlacements: CustomPlacement[];
  detectedFieldRoleMap?: Record<string, string | undefined>;
  selectedPlacementId?: string;
  onPlacementClick: (placementId: string) => void;
  onDetectedFieldClick?: (field: DetectedPdfField) => void;
  onAddPlacement: (placement: Partial<CustomPlacement>) => void;
  onPlacementResize?: (placementId: string, newRect: PdfRect) => void;
  mode: "view" | "add-signature" | "edit";
  highlightedField?: DetectedPdfField | null;
  /** Optional: renders entered field values/signatures over the PDF (DOM overlay). */
  valueLayer?: PdfViewerValueLayer;
}

export function PdfViewerWithOverlay({
  pdfUrl,
  detectedFields,
  customPlacements,
  detectedFieldRoleMap,
  selectedPlacementId,
  onPlacementClick,
  onDetectedFieldClick,
  onAddPlacement,
  onPlacementResize,
  mode,
  highlightedField,
  valueLayer,
}: PdfViewerWithOverlayProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load PDF
  useEffect(() => {
    let isStale = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        setCurrentPage(1);

        loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
        const doc = await loadingTask.promise;
        if (isStale) return;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        // Clamp current page just in case
        setCurrentPage((prev) =>
          Math.min(Math.max(1, prev), doc.numPages || 1),
        );
        setLoading(false);
      } catch (err) {
        if (isStale) return;
        console.error("Error loading PDF:", err);
        setError("Failed to load PDF document.");
        setLoading(false);
      }
    };

    if (pdfUrl) {
      loadPdf();
    }

    return () => {
      isStale = true;
      if (loadingTask?.destroy) {
        try {
          loadingTask.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfUrl]);

  // Handle page navigation
  const prevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const nextPage = () =>
    setCurrentPage((p) => Math.max(1, Math.min(pageCount, p + 1)));
  const zoomIn = () => setScale((s) => Math.min(2.0, s + 0.1));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.1));

  // Scroll to highlighted field page
  useEffect(() => {
    if (highlightedField) {
      const target = highlightedField.pageIndex + 1;
      if (pageCount > 0 && target >= 1 && target <= pageCount) {
        setCurrentPage(target);
      }
    }
  }, [highlightedField, pageCount]);

  return (
    <div className="flex flex-col h-full bg-muted overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none px-4 border-b bg-background/95 backdrop-blur flex items-center justify-between sticky top-0 z-30 h-10 shrink-0">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={prevPage}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs md:text-sm font-medium px-2">
            {currentPage} / {pageCount || "-"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={nextPage}
            disabled={currentPage >= pageCount}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={zoomOut}
            disabled={scale <= 0.5}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs md:text-sm font-medium min-w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={zoomIn}
            disabled={scale >= 2.0}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Viewport */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-auto p-1 sm:p-2 flex justify-center relative bg-muted/20",
          mode === "add-signature" ? "cursor-crosshair" : "cursor-default",
        )}
      >
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full text-destructive text-sm">
            {error}
          </div>
        )}

        {pdfDoc && !loading && (
          <PdfPage
            pdfDoc={pdfDoc}
            pageNumber={currentPage}
            scale={scale}
            detectedFields={detectedFields.filter(
              (f) => f.pageIndex === currentPage - 1,
            )}
            customPlacements={customPlacements.filter(
              (p) => p.pageIndex === currentPage - 1,
            )}
            detectedFieldRoleMap={detectedFieldRoleMap}
            selectedPlacementId={selectedPlacementId}
            onPlacementClick={onPlacementClick}
            onDetectedFieldClick={onDetectedFieldClick}
            onAddPlacement={onAddPlacement}
            onPlacementResize={onPlacementResize}
            mode={mode}
            highlightedField={
              highlightedField?.pageIndex === currentPage - 1
                ? highlightedField
                : null
            }
            valueLayer={valueLayer}
          />
        )}
      </div>
    </div>
  );
}
