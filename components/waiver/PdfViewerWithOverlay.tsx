"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetectedPdfField, PdfRect } from "@/lib/waiver/pdf-field-detect";
import { WaiverFieldType } from "@/types/waiver-definitions";
import type { SignerData } from "@/types/waiver-definitions";

// Configure worker
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
}

export interface CustomPlacement {
  id: string;
  /** For definition-backed fields, this maps to `waiver_definition_fields.field_key` (used to look up entered values). */
  fieldKey?: string;
  label: string;
  signerRoleKey: string;
  fieldType: WaiverFieldType;
  required: boolean;
  pageIndex: number;
  rect: PdfRect;
}

export type PdfViewerValueLayer = {
  fieldValues: Record<string, string | boolean | number | null | undefined>;
  signatures: Record<string, SignerData | undefined>;
};

interface PdfViewerWithOverlayProps {
  pdfUrl: string;
  detectedFields: DetectedPdfField[];
  customPlacements: CustomPlacement[];
  selectedPlacementId?: string;
  onPlacementClick: (placementId: string) => void;
  onDetectedFieldClick?: (field: DetectedPdfField) => void;
  onAddPlacement: (placement: Partial<CustomPlacement>) => void;
  onPlacementResize?: (placementId: string, newRect: PdfRect) => void;
  mode: 'view' | 'add-signature' | 'edit';
  highlightedField?: DetectedPdfField | null;
  /** Optional: renders entered field values/signatures over the PDF (DOM overlay). */
  valueLayer?: PdfViewerValueLayer;
}

export function PdfViewerWithOverlay({
  pdfUrl,
  detectedFields,
  customPlacements,
  selectedPlacementId,
  onPlacementClick,
  onDetectedFieldClick,
  onAddPlacement,
  onPlacementResize,
  mode,
  highlightedField,
  valueLayer
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
    let loadingTask: any | null = null;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        setCurrentPage(1);

        loadingTask = pdfjsLib.getDocument(pdfUrl);
        const doc = await loadingTask.promise;
        if (isStale) return;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        // Clamp current page just in case
        setCurrentPage((prev) => Math.min(Math.max(1, prev), doc.numPages || 1));
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
  const nextPage = () => setCurrentPage((p) => Math.max(1, Math.min(pageCount, p + 1)));
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevPage} disabled={currentPage <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs md:text-sm font-medium px-2">
            {currentPage} / {pageCount || "-"}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextPage} disabled={currentPage >= pageCount}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomOut} disabled={scale <= 0.5}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs md:text-sm font-medium min-w-12 text-center">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomIn} disabled={scale >= 2.0}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Viewport */}
      <div 
        ref={containerRef}
        className={cn(
          "flex-1 overflow-auto p-1 sm:p-2 flex justify-center relative bg-muted/20", 
          mode === 'add-signature' ? "cursor-crosshair" : "cursor-default"
        )}
      >
        {loading && <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}
        {error && <div className="flex items-center justify-center h-full text-destructive text-sm">{error}</div>}
        
        {pdfDoc && !loading && (
          <PdfPage
            pdfDoc={pdfDoc}
            pageNumber={currentPage}
            scale={scale}
            detectedFields={detectedFields.filter(f => f.pageIndex === currentPage - 1)}
            customPlacements={customPlacements.filter(p => p.pageIndex === currentPage - 1)}
            selectedPlacementId={selectedPlacementId}
            onPlacementClick={onPlacementClick}
            onDetectedFieldClick={onDetectedFieldClick}
            onAddPlacement={onAddPlacement}
            onPlacementResize={onPlacementResize}
            mode={mode}
            highlightedField={highlightedField?.pageIndex === currentPage - 1 ? highlightedField : null}
            valueLayer={valueLayer}
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
  detectedFields: DetectedPdfField[];
  customPlacements: CustomPlacement[];
  selectedPlacementId?: string;
  onPlacementClick: (placementId: string) => void;
  onDetectedFieldClick?: (field: DetectedPdfField) => void;
  onAddPlacement: (placement: Partial<CustomPlacement>) => void;
  onPlacementResize?: (placementId: string, newRect: PdfRect) => void;
  mode: 'view' | 'add-signature' | 'edit';
  highlightedField: DetectedPdfField | null;
  valueLayer?: PdfViewerValueLayer;
}

function PdfPage({
  pdfDoc,
  pageNumber,
  scale,
  detectedFields,
  customPlacements,
  selectedPlacementId,
  onPlacementClick,
  onDetectedFieldClick,
  onAddPlacement,
  onPlacementResize,
  mode,
  highlightedField,
  valueLayer
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<pdfjsLib.PageViewport | null>(null);
  const renderTaskRef = useRef<any | null>(null);
  const [renderAttempts, setRenderAttempts] = useState(0);

  const clampRectToPage = useCallback(
    (rect: PdfRect, minWidth = 30, minHeight = 20): PdfRect => {
      if (!viewport) return rect;

      const viewBox = (viewport as any).viewBox as [number, number, number, number] | undefined;
      const xMin = viewBox?.[0] ?? 0;
      const yMin = viewBox?.[1] ?? 0;
      const xMax = viewBox?.[2] ?? viewport.width / viewport.scale;
      const yMax = viewBox?.[3] ?? viewport.height / viewport.scale;

      const pageWidth = Math.max(0, xMax - xMin);
      const pageHeight = Math.max(0, yMax - yMin);

      const width = Math.min(Math.max(rect.width, minWidth), pageWidth);
      const height = Math.min(Math.max(rect.height, minHeight), pageHeight);

      const x = Math.min(Math.max(rect.x, xMin), xMin + pageWidth - width);
      const y = Math.min(Math.max(rect.y, yMin), yMin + pageHeight - height);

      return { x, y, width, height };
    },
    [viewport]
  );

  // Render Page
  useEffect(() => {
    let isStale = false;
    let retryTimeout: NodeJS.Timeout | null = null;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (isStale) return;

        const vp = page.getViewport({ scale });
        setViewport(vp);

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Clear any previous content
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Set canvas actual pixel dimensions (for high DPI)
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = vp.width * pixelRatio;
        canvas.height = vp.height * pixelRatio;

        // Set CSS dimensions
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;

        // Scale context for high DPI
        context.scale(pixelRatio, pixelRatio);

        const renderContext = {
          canvasContext: context,
          viewport: vp,
          canvas,
        };

        // Cancel any in-flight render before starting a new one.
        if (renderTaskRef.current?.cancel) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // ignore
          }
        }

        const renderTask = page.render(renderContext as any);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        renderTaskRef.current = null;
        setRenderAttempts(0); // Reset attempts on successful render
      } catch (err) {
        if (isStale) return;
        const name = (err as any)?.name;
        // RenderingCancelledException is expected on fast navigation/zoom.
        if (name !== 'RenderingCancelledException') {
          console.error("Page render error:", err);
          // Retry once after 100ms if initial render fails
          if (renderAttempts === 0) {
            retryTimeout = setTimeout(() => {
              if (!isStale) {
                setRenderAttempts(1);
              }
            }, 100);
          }
        }
      }
    };

    renderPage();

    return () => {
      isStale = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (renderTaskRef.current?.cancel) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
      renderTaskRef.current = null;
    };
  }, [pdfDoc, pageNumber, scale, renderAttempts]);

  // Force re-render after PDF fully loads
  useEffect(() => {
    if (pdfDoc && pageNumber > 0) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        setRenderAttempts((prev) => prev + 1);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pdfDoc]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'add-signature' || !viewport) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to PDF coordinates (bottom-left origin)
    // viewbox is [x, y, w, h] usually [0,0,w,h]
    // PDF coordinates Y is inverted relative to canvas Y usually.
    // pdfjs viewport.convertToPdfPoint takes [x, y] in canvas pixels and returns [x, y] in pdf points.
    
    const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);

    // Default size for new signature box (e.g. 150x50 points)
    const newWidth = 150;
    const newHeight = 50;

    // Adjust y to be bottom-left of the rect, since click is usually center or top-left?
    // Let's center the new box on click
    const finalX = pdfX - (newWidth / 2);
    const finalY = pdfY - (newHeight / 2);

    const clampedRect = clampRectToPage(
      {
        x: finalX,
        y: finalY,
        width: newWidth,
        height: newHeight,
      },
      30,
      20
    );

    onAddPlacement({
      pageIndex: pageNumber - 1,
      rect: clampedRect,
    });
  };

  if (!viewport) return <div className="w-150 h-200 bg-white animate-pulse" />;

  // Helper to convert PDF rect to specific canvas style
  const getStyle = (rect: PdfRect) => {
    // PDF coords: x, y, width, height. y is from bottom if it's raw PDF, but PDF.js viewport handles the transform
    // viewport.convertToViewportRectangle([x, y, x+w, y+h]) returns [x1, y1, x2, y2] in canvas coords
    
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]);
    
    // Calculate CSS properties
    // Note: viewport rectangle might have y1 > y2 or vice versa depending on rotation/inversion
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
      position: 'absolute' as const,
    };
  };

  return (
    <div 
      ref={containerRef}
      className="relative ring-1 ring-border shadow-sm"
      style={{ width: viewport.width, height: viewport.height }}
      onClick={handleCanvasClick}
    >
      <canvas ref={canvasRef} className="block bg-white" />
      
      {/* Detected Fields Overlay */}
      {detectedFields.map((field, idx) => {
        const isSignature = field.fieldType === 'signature';
        const isHighlighted = highlightedField?.fieldName === field.fieldName;
        
        return (
          <div
            key={`detected-${field.fieldName}-${field.pageIndex}`}
            style={getStyle(field.rect)}
            className={cn(
              "border-2 absolute transition-all cursor-pointer group flex items-center justify-center z-10",
              isSignature ? "border-blue-500 bg-blue-500/15 hover:bg-blue-500/25" : "border-gray-400 bg-gray-400/15 hover:bg-gray-400/25",
              isHighlighted && "ring-2 ring-warning ring-offset-2 bg-warning/20 border-warning"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onDetectedFieldClick?.(field);
            }}
          >
             <span className="opacity-0 group-hover:opacity-100 bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded absolute -top-6 whitespace-nowrap pointer-events-none shadow-sm border text-center">
              {field.fieldName} ({field.fieldType})
            </span>
          </div>
        );
      })}

      {/* Custom Placements Overlay */}
      {customPlacements.map((placement) => {
        const isSelected = selectedPlacementId === placement.id;

        const fieldValue = placement.fieldKey && valueLayer?.fieldValues
          ? valueLayer.fieldValues[placement.fieldKey]
          : undefined;

        const signature = valueLayer?.signatures?.[placement.signerRoleKey] ?? undefined;
        
        return (
          <ResizablePlacement
            key={placement.id}
            placement={placement}
            isSelected={isSelected}
            viewport={viewport}
            onPlacementClick={onPlacementClick}
            onPlacementResize={onPlacementResize}
            clampRectToPage={clampRectToPage}
            mode={mode}
            fieldValue={fieldValue}
            signature={signature}
          />
        );
      })}
    </div>
  );
}

export function WaiverPlacementValue({
  placement,
  fieldValue,
  signature,
}: {
  placement: CustomPlacement;
  fieldValue: string | boolean | number | null | undefined;
  signature?: SignerData;
}) {
  // IMPORTANT: This overlay renders on top of a PDF canvas which is typically a white page,
  // even when the app theme is dark. Keep the ink color black for readability.
  const inkClass = "text-black/90";

  if (placement.fieldType === 'signature') {
    if (!signature) return null;

    if (signature.method === 'typed') {
      const text = signature.data?.trim();
      if (!text) return null;
      return (
        <span
          data-testid="waiver-placement-signature-typed"
          className={cn(
            "text-[11px] md:text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-full",
            inkClass
          )}
          style={{ fontFamily: 'cursive' }}
        >
          {text}
        </span>
      );
    }

    const src = signature.data;
    if (!src) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid="waiver-placement-signature-image"
        alt={placement.label ? `${placement.label} signature` : 'Signature'}
        src={src}
        className="max-h-full max-w-full object-contain opacity-90"
      />
    );
  }

  if (typeof fieldValue === 'boolean') {
    if (!fieldValue) return null;
    return (
      <span
        data-testid="waiver-placement-checkbox"
        className={cn("text-base md:text-lg font-bold", inkClass)}
        aria-label="Checked"
      >
        ✓
      </span>
    );
  }

  if (fieldValue === null || fieldValue === undefined) return null;
  const text = String(fieldValue).trim();
  if (!text) return null;

  return (
    <span
      data-testid="waiver-placement-text"
      className={cn(
        "text-[11px] md:text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-full",
        inkClass
      )}
    >
      {text}
    </span>
  );
}

// Resizable Placement Component
interface ResizablePlacementProps {
  placement: CustomPlacement;
  isSelected: boolean;
  viewport: pdfjsLib.PageViewport;
  onPlacementClick: (placementId: string) => void;
  onPlacementResize?: (placementId: string, newRect: PdfRect) => void;
  clampRectToPage: (rect: PdfRect, minWidth?: number, minHeight?: number) => PdfRect;
  mode: 'view' | 'add-signature' | 'edit';
  fieldValue?: string | boolean | number | null;
  signature?: SignerData;
}

function ResizablePlacement({
  placement,
  isSelected,
  viewport,
  onPlacementClick,
  onPlacementResize,
  clampRectToPage,
  mode,
  fieldValue,
  signature
}: ResizablePlacementProps) {
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [localRect, setLocalRect] = useState<PdfRect>(placement.rect);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const startRectRef = useRef<PdfRect | null>(null);
  const latestRectRef = useRef<PdfRect>(placement.rect);

  useEffect(() => {
    if (isDragging || isResizing) return;
    setLocalRect(placement.rect);
    latestRectRef.current = placement.rect;
  }, [placement.rect, isDragging, isResizing]);

  const getStyle = (rect: PdfRect) => {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
      rect.x,
      rect.y,
      rect.x + rect.width,
      rect.y + rect.height
    ]);
    
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
      position: 'absolute' as const,
    };
  };

  const handleMouseDown = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    
    setIsResizing(true);
    setResizeHandle(handle);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    startRectRef.current = { ...latestRectRef.current };
  };

  const handleDragStart = (e: React.MouseEvent) => {
    // Only start drag if clicking on the box itself, not handles
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    
    e.stopPropagation();
    setIsDragging(true);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    startRectRef.current = { ...latestRectRef.current };
  };

  useEffect(() => {
    if ((!isResizing && !isDragging) || !startPosRef.current || !startRectRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!startPosRef.current || !startRectRef.current || !onPlacementResize) return;

      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = e.clientY - startPosRef.current.y;

      // Handle dragging (moving entire box)
      if (isDragging) {
        const scale = viewport.scale;
        const pdfDeltaX = deltaX / scale;
        const pdfDeltaY = -deltaY / scale;

        const newRect = clampRectToPage({
          ...startRectRef.current,
          x: startRectRef.current.x + pdfDeltaX,
          y: startRectRef.current.y + pdfDeltaY
        });

        latestRectRef.current = newRect;
        setLocalRect(newRect);
        return;
      }

      // Convert pixel deltas to PDF coordinate deltas
      const scale = viewport.scale;
      const pdfDeltaX = deltaX / scale;
      const pdfDeltaY = -deltaY / scale; // Y is inverted in PDF coords

      const newRect = { ...startRectRef.current };

      // Apply resize based on handle
      switch (resizeHandle) {
        case 'se': // Bottom-right corner
          newRect.width = Math.max(30, startRectRef.current.width + pdfDeltaX);
          newRect.height = Math.max(20, startRectRef.current.height - pdfDeltaY);
          newRect.y = startRectRef.current.y + startRectRef.current.height - newRect.height;
          break;
        case 'sw': // Bottom-left corner
          newRect.width = Math.max(30, startRectRef.current.width - pdfDeltaX);
          newRect.height = Math.max(20, startRectRef.current.height - pdfDeltaY);
          newRect.x = startRectRef.current.x + pdfDeltaX;
          newRect.y = startRectRef.current.y + startRectRef.current.height - newRect.height;
          break;
        case 'ne': // Top-right corner
          newRect.width = Math.max(30, startRectRef.current.width + pdfDeltaX);
          newRect.height = Math.max(20, startRectRef.current.height + pdfDeltaY);
          break;
        case 'nw': // Top-left corner
          newRect.width = Math.max(30, startRectRef.current.width - pdfDeltaX);
          newRect.height = Math.max(20, startRectRef.current.height + pdfDeltaY);
          newRect.x = startRectRef.current.x + pdfDeltaX;
          break;
        case 'e': // Right edge
          newRect.width = Math.max(30, startRectRef.current.width + pdfDeltaX);
          break;
        case 'w': // Left edge
          newRect.width = Math.max(30, startRectRef.current.width - pdfDeltaX);
          newRect.x = startRectRef.current.x + pdfDeltaX;
          break;
        case 's': // Bottom edge
          newRect.height = Math.max(20, startRectRef.current.height - pdfDeltaY);
          newRect.y = startRectRef.current.y + startRectRef.current.height - newRect.height;
          break;
        case 'n': // Top edge
          newRect.height = Math.max(20, startRectRef.current.height + pdfDeltaY);
          break;
      }

      const clampedRect = clampRectToPage(newRect);
      latestRectRef.current = clampedRect;
      setLocalRect(clampedRect);
    };

    const handleMouseUp = () => {
      if (onPlacementResize && (isResizing || isDragging)) {
        onPlacementResize(placement.id, latestRectRef.current);
      }

      setIsResizing(false);
      setIsDragging(false);
      setResizeHandle(null);
      startPosRef.current = null;
      startRectRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isDragging, resizeHandle, viewport, placement.id, onPlacementResize, clampRectToPage]);

  const style = getStyle(localRect);

  const isSignature = placement.fieldType === 'signature';
  const resizeHandleColorClass = isSignature
    ? "bg-primary border-primary"
    : "bg-indigo-600 border-indigo-600";

  const isEditable = mode === 'edit' && typeof onPlacementResize === 'function';
  
  return (
    <div
      style={style}
      className={cn(
        "border-2 absolute hover:bg-opacity-30 transition-colors z-20 select-none rounded-sm",
        isSignature ? "border-primary bg-primary/20" : "border-indigo-500 bg-indigo-500/20",
        isSelected && (isSignature ? "ring-2 ring-primary ring-offset-2 shadow-lg border-primary bg-primary/30" : "ring-2 ring-indigo-500 ring-offset-2 shadow-lg border-indigo-500 bg-indigo-500/30"),
        isResizing && "cursor-crosshair",
        isEditable ? (isDragging ? "cursor-grabbing opacity-80 shadow-xl" : "cursor-move") : "cursor-pointer"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onPlacementClick(placement.id);
      }}
      onMouseDown={isEditable ? handleDragStart : undefined}
    >
      {/* Label */}
      <div
        className={cn(
          "absolute left-1 top-1 text-[9px] md:text-[10px] text-white px-1.5 py-0.5 rounded truncate max-w-[calc(100%-0.5rem)] pointer-events-none font-medium",
          isSignature ? "bg-primary" : "bg-indigo-600"
        )}
      >
        {placement.label || (isSignature ? "Signature" : placement.fieldType)}
      </div>

      {/* Value overlay */}
      <div className="absolute inset-0 flex items-center justify-center px-1.5 py-1 pointer-events-none">
        <WaiverPlacementValue placement={placement} fieldValue={fieldValue} signature={signature} />
      </div>
      
      {isSelected && isEditable && !isResizing && !isDragging && (
        <>
          {/* Corner handles */}
          <div
            className={cn("resize-handle absolute -top-1 -left-1 w-3 h-3 border rounded-full cursor-nw-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 'nw')}
          />
          <div
            className={cn("resize-handle absolute -top-1 -right-1 w-3 h-3 border rounded-full cursor-ne-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 'ne')}
          />
          <div
            className={cn("resize-handle absolute -bottom-1 -left-1 w-3 h-3 border rounded-full cursor-sw-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 'sw')}
          />
          <div
            className={cn("resize-handle absolute -bottom-1 -right-1 w-3 h-3 border rounded-full cursor-se-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 'se')}
          />
          
          {/* Edge handles */}
          <div
            className={cn("resize-handle absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-2 border rounded cursor-n-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 'n')}
          />
          <div
            className={cn("resize-handle absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-2 border rounded cursor-s-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 's')}
          />
          <div
            className={cn("resize-handle absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-3 border rounded cursor-w-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 'w')}
          />
          <div
            className={cn("resize-handle absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-3 border rounded cursor-e-resize z-30", resizeHandleColorClass)}
            onMouseDown={(e) => handleMouseDown(e, 'e')}
          />
        </>
      )}
    </div>
  );
}
