"use client";

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetectedPdfField, PdfRect } from "@/lib/waiver/pdf-field-detect";

// Configure worker
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
}

export interface CustomPlacement {
  id: string;
  label: string;
  signerRoleKey: string;
  required: boolean;
  pageIndex: number;
  rect: PdfRect;
}

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
  highlightedField
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
    const loadPdf = async () => {
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

    if (pdfUrl) {
      loadPdf();
    }
  }, [pdfUrl]);

  // Handle page navigation
  const prevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const nextPage = () => setCurrentPage((p) => Math.min(pageCount, p + 1));
  const zoomIn = () => setScale((s) => Math.min(2.0, s + 0.1));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.1));

  // Scroll to highlighted field page
  useEffect(() => {
    if (highlightedField) {
      setCurrentPage(highlightedField.pageIndex + 1);
    }
  }, [highlightedField]);

  return (
    <div className="flex flex-col h-full bg-muted overflow-hidden border rounded-md">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-background border-b">
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
          "flex-1 overflow-auto p-4 flex justify-center relative bg-muted/50", 
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
  highlightedField
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<pdfjsLib.PageViewport | null>(null);

  // Render Page
  useEffect(() => {
    const renderPage = async () => {
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
      
      try {
        await page.render(renderContext).promise;
      } catch (err) {
        // Only log if it's not a cancelled request (which happens on fast navigation)
        console.error("Page render error:", err);
      }
    };

    renderPage();
  }, [pdfDoc, pageNumber, scale]);

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

    onAddPlacement({
      pageIndex: pageNumber - 1,
      rect: {
        x: finalX,
        y: finalY,
        width: newWidth,
        height: newHeight
      }
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
      className="relative shadow-lg"
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
            key={`detected-${idx}`}
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
        
        return (
          <ResizablePlacement
            key={placement.id}
            placement={placement}
            isSelected={isSelected}
            viewport={viewport}
            onPlacementClick={onPlacementClick}
            onPlacementResize={onPlacementResize}
          />
        );
      })}
    </div>
  );
}

// Resizable Placement Component
interface ResizablePlacementProps {
  placement: CustomPlacement;
  isSelected: boolean;
  viewport: pdfjsLib.PageViewport;
  onPlacementClick: (placementId: string) => void;
  onPlacementResize?: (placementId: string, newRect: PdfRect) => void;
}

function ResizablePlacement({
  placement,
  isSelected,
  viewport,
  onPlacementClick,
  onPlacementResize
}: ResizablePlacementProps) {
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const startRectRef = useRef<PdfRect | null>(null);

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
    startRectRef.current = { ...placement.rect };
  };

  const handleDragStart = (e: React.MouseEvent) => {
    // Only start drag if clicking on the box itself, not handles
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    
    e.stopPropagation();
    setIsDragging(true);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    startRectRef.current = { ...placement.rect };
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

        const newRect = {
          ...startRectRef.current,
          x: startRectRef.current.x + pdfDeltaX,
          y: startRectRef.current.y + pdfDeltaY
        };

        onPlacementResize(placement.id, newRect);
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

      onPlacementResize(placement.id, newRect);
    };

    const handleMouseUp = () => {
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
  }, [isResizing, isDragging, resizeHandle, viewport, placement.id, onPlacementResize]);

  const style = getStyle(placement.rect);

  return (
    <div
      style={style}
      className={cn(
        "border-2 border-primary bg-primary/20 absolute hover:bg-primary/30 transition-all z-20 flex items-center justify-center select-none rounded-sm",
        isSelected && "ring-2 ring-primary ring-offset-2 shadow-lg border-primary bg-primary/30",
        isResizing && "cursor-crosshair",
        isDragging ? "cursor-grabbing opacity-80 shadow-xl" : "cursor-move"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onPlacementClick(placement.id);
      }}
      onMouseDown={handleDragStart}
    >
      <div className="text-[9px] md:text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded truncate max-w-full pointer-events-none font-medium">
        {placement.label}
      </div>
      
      {isSelected && !isResizing && !isDragging && (
        <>
          {/* Corner handles */}
          <div
            className="resize-handle absolute -top-1 -left-1 w-3 h-3 bg-primary border border-white rounded-full cursor-nw-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 'nw')}
          />
          <div
            className="resize-handle absolute -top-1 -right-1 w-3 h-3 bg-primary border border-white rounded-full cursor-ne-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 'ne')}
          />
          <div
            className="resize-handle absolute -bottom-1 -left-1 w-3 h-3 bg-primary border border-white rounded-full cursor-sw-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 'sw')}
          />
          <div
            className="resize-handle absolute -bottom-1 -right-1 w-3 h-3 bg-primary border border-white rounded-full cursor-se-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 'se')}
          />
          
          {/* Edge handles */}
          <div
            className="resize-handle absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-2 bg-primary border border-white rounded cursor-n-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 'n')}
          />
          <div
            className="resize-handle absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-2 bg-primary border border-white rounded cursor-s-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 's')}
          />
          <div
            className="resize-handle absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-3 bg-primary border border-white rounded cursor-w-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 'w')}
          />
          <div
            className="resize-handle absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-3 bg-primary border border-white rounded cursor-e-resize z-30"
            onMouseDown={(e) => handleMouseDown(e, 'e')}
          />
        </>
      )}
    </div>
  );
}
