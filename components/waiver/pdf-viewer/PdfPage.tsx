"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/webpack.mjs";
import { cn } from "@/lib/utils";
import {
  createRectFromCenter,
  getCustomPlacementFieldSize,
} from "@/lib/waiver/custom-field-config";
import { DetectedPdfField, PdfRect } from "@/lib/waiver/pdf-field-detect";
import { convertPdfRectToViewport } from "@/lib/waiver/pdf-viewport";
import { WaiverFieldType } from "@/types/waiver-definitions";
import type { CustomPlacement, PdfViewerValueLayer } from "./types";
import { ResizablePlacement } from "./ResizablePlacement";
import { WaiverPlacementValue } from "./WaiverPlacementValue";

interface PdfPageProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  detectedFields: DetectedPdfField[];
  customPlacements: CustomPlacement[];
  detectedFieldRoleMap?: Record<string, string | undefined>;
  selectedPlacementId?: string;
  onPlacementClick: (placementId: string) => void;
  onDetectedFieldClick?: (field: DetectedPdfField) => void;
  onAddPlacement: (placement: Partial<CustomPlacement>) => void;
  onPlacementResize?: (placementId: string, newRect: PdfRect) => void;
  mode: "view" | "add-signature" | "edit";
  highlightedField: DetectedPdfField | null;
  valueLayer?: PdfViewerValueLayer;
}

export function PdfPage({
  pdfDoc,
  pageNumber,
  scale,
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
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<pdfjsLib.PageViewport | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [renderAttempts, setRenderAttempts] = useState(0);

  const clampRectToPage = useCallback(
    (rect: PdfRect, minWidth = 0, minHeight = 0): PdfRect => {
      if (!viewport) return rect;

      const [
        xMin = 0,
        yMin = 0,
        xMax = viewport.width / viewport.scale,
        yMax = viewport.height / viewport.scale,
      ] = viewport.viewBox;

      const pageWidth = Math.max(0, xMax - xMin);
      const pageHeight = Math.max(0, yMax - yMin);

      const width = Math.min(Math.max(rect.width, minWidth), pageWidth);
      const height = Math.min(Math.max(rect.height, minHeight), pageHeight);

      const x = Math.min(Math.max(rect.x, xMin), xMin + pageWidth - width);
      const y = Math.min(Math.max(rect.y, yMin), yMin + pageHeight - height);

      return { x, y, width, height };
    },
    [viewport],
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

        const context = canvas.getContext("2d");
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

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        renderTaskRef.current = null;
        setRenderAttempts(0); // Reset attempts on successful render
      } catch (err) {
        if (isStale) return;
        const name = err instanceof Error ? err.name : undefined;
        // RenderingCancelledException is expected on fast navigation/zoom.
        if (name !== "RenderingCancelledException") {
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
    if (mode !== "add-signature" || !viewport) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to PDF coordinates (bottom-left origin)
    // viewbox is [x, y, w, h] usually [0,0,w,h]
    // PDF coordinates Y is inverted relative to canvas Y usually.
    // pdfjs viewport.convertToPdfPoint takes [x, y] in canvas pixels and returns [x, y] in pdf points.

    const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);

    const textFieldSize = getCustomPlacementFieldSize("text");

    const clampedRect = clampRectToPage(
      createRectFromCenter(pdfX, pdfY, "text"),
      textFieldSize.minWidth,
      textFieldSize.minHeight,
    );

    onAddPlacement({
      pageIndex: pageNumber - 1,
      rect: clampedRect,
    });
  };

  if (!viewport) return <div className="w-150 h-200 bg-white animate-pulse" />;

  const toWaiverFieldType = (
    fieldType: DetectedPdfField["fieldType"],
  ): WaiverFieldType => {
    const knownFieldTypes: WaiverFieldType[] = [
      "signature",
      "text",
      "checkbox",
      "radio",
      "dropdown",
    ];
    if (knownFieldTypes.includes(fieldType as WaiverFieldType)) {
      return fieldType as WaiverFieldType;
    }
    return "text";
  };

  // Helper to convert PDF rect to specific canvas style
  const getStyle = (rect: PdfRect) => {
    // PDF coords: x, y, width, height. y is from bottom if it's raw PDF, but PDF.js viewport handles the transform
    const [x1, y1, x2, y2] = convertPdfRectToViewport(viewport, rect);

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
      position: "absolute" as const,
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
        const isSignature = field.fieldType === "signature";
        const isHighlighted = highlightedField?.fieldName === field.fieldName;
        const signerRoleKey = detectedFieldRoleMap?.[field.fieldName];
        const fieldValue = valueLayer?.fieldValues?.[field.fieldName];
        const signature = signerRoleKey
          ? valueLayer?.signatures?.[signerRoleKey]
          : undefined;
        const previewPlacement: CustomPlacement = {
          id: `detected-preview-${field.fieldName}-${field.pageIndex}`,
          fieldKey: field.fieldName,
          label: field.fieldName,
          signerRoleKey: signerRoleKey ?? "unassigned",
          fieldType: toWaiverFieldType(field.fieldType),
          required: field.required ?? false,
          pageIndex: field.pageIndex,
          rect: field.rect,
        };

        return (
          <div
            key={`detected-${field.fieldName}-${field.pageIndex}-${idx}`}
            style={getStyle(field.rect)}
            className={cn(
              "border-2 absolute transition-all cursor-pointer group flex items-center justify-center z-10",
              isSignature
                ? "border-blue-500 bg-blue-500/15 hover:bg-blue-500/25"
                : "border-gray-400 bg-gray-400/15 hover:bg-gray-400/25",
              isHighlighted &&
                "ring-2 ring-warning ring-offset-2 bg-warning/20 border-warning",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onDetectedFieldClick?.(field);
            }}
          >
            <span className="opacity-0 group-hover:opacity-100 bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded absolute -top-6 whitespace-nowrap pointer-events-none shadow-sm border text-center">
              {field.fieldName} ({field.fieldType})
            </span>

            <div className="absolute inset-0 flex items-center justify-center px-1.5 py-1 pointer-events-none">
              <WaiverPlacementValue
                placement={previewPlacement}
                fieldValue={fieldValue}
                signature={signature}
              />
            </div>
          </div>
        );
      })}

      {/* Custom Placements Overlay */}
      {customPlacements.map((placement) => {
        const isSelected = selectedPlacementId === placement.id;

        const fieldValue =
          placement.fieldKey && valueLayer?.fieldValues
            ? valueLayer.fieldValues[placement.fieldKey]
            : undefined;

        const signature =
          valueLayer?.signatures?.[placement.signerRoleKey] ?? undefined;

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
