"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/webpack.mjs";
import { cn } from "@/lib/utils";
import { getCustomPlacementFieldSize } from "@/lib/waiver/custom-field-config";
import { PdfRect } from "@/lib/waiver/pdf-field-detect";
import { convertPdfRectToViewport } from "@/lib/waiver/pdf-viewport";
import type { CustomPlacement } from "./types";
import type { SignerData } from "@/types/waiver-definitions";
import { WaiverPlacementValue } from "./WaiverPlacementValue";

interface ResizablePlacementProps {
  placement: CustomPlacement;
  isSelected: boolean;
  viewport: pdfjsLib.PageViewport;
  onPlacementClick: (placementId: string) => void;
  onPlacementResize?: (placementId: string, newRect: PdfRect) => void;
  clampRectToPage: (
    rect: PdfRect,
    minWidth?: number,
    minHeight?: number,
  ) => PdfRect;
  mode: "view" | "add-signature" | "edit";
  fieldValue?: string | boolean | number | null;
  signature?: SignerData;
}

export function ResizablePlacement({
  placement,
  isSelected,
  viewport,
  onPlacementClick,
  onPlacementResize,
  clampRectToPage,
  mode,
  fieldValue,
  signature,
}: ResizablePlacementProps) {
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [localRect, setLocalRect] = useState<PdfRect>(placement.rect);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const startRectRef = useRef<PdfRect | null>(null);
  const latestRectRef = useRef<PdfRect>(placement.rect);
  const { minWidth, minHeight } = getCustomPlacementFieldSize(
    placement.fieldType,
  );

  useEffect(() => {
    if (isDragging || isResizing) return;
    setLocalRect(placement.rect);
    latestRectRef.current = placement.rect;
  }, [placement.rect, isDragging, isResizing]);

  const getStyle = (rect: PdfRect) => {
    const [x1, y1, x2, y2] = convertPdfRectToViewport(viewport, rect);

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
    if ((e.target as HTMLElement).closest(".resize-handle")) return;

    e.stopPropagation();
    setIsDragging(true);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    startRectRef.current = { ...latestRectRef.current };
  };

  useEffect(() => {
    if (
      (!isResizing && !isDragging) ||
      !startPosRef.current ||
      !startRectRef.current
    )
      return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!startPosRef.current || !startRectRef.current || !onPlacementResize)
        return;

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
          y: startRectRef.current.y + pdfDeltaY,
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
        case "se": // Bottom-right corner
          newRect.width = Math.max(
            minWidth,
            startRectRef.current.width + pdfDeltaX,
          );
          newRect.height = Math.max(
            minHeight,
            startRectRef.current.height - pdfDeltaY,
          );
          newRect.y =
            startRectRef.current.y +
            startRectRef.current.height -
            newRect.height;
          break;
        case "sw": // Bottom-left corner
          newRect.width = Math.max(
            minWidth,
            startRectRef.current.width - pdfDeltaX,
          );
          newRect.height = Math.max(
            minHeight,
            startRectRef.current.height - pdfDeltaY,
          );
          newRect.x = startRectRef.current.x + pdfDeltaX;
          newRect.y =
            startRectRef.current.y +
            startRectRef.current.height -
            newRect.height;
          break;
        case "ne": // Top-right corner
          newRect.width = Math.max(
            minWidth,
            startRectRef.current.width + pdfDeltaX,
          );
          newRect.height = Math.max(
            minHeight,
            startRectRef.current.height + pdfDeltaY,
          );
          break;
        case "nw": // Top-left corner
          newRect.width = Math.max(
            minWidth,
            startRectRef.current.width - pdfDeltaX,
          );
          newRect.height = Math.max(
            minHeight,
            startRectRef.current.height + pdfDeltaY,
          );
          newRect.x = startRectRef.current.x + pdfDeltaX;
          break;
        case "e": // Right edge
          newRect.width = Math.max(
            minWidth,
            startRectRef.current.width + pdfDeltaX,
          );
          break;
        case "w": // Left edge
          newRect.width = Math.max(
            minWidth,
            startRectRef.current.width - pdfDeltaX,
          );
          newRect.x = startRectRef.current.x + pdfDeltaX;
          break;
        case "s": // Bottom edge
          newRect.height = Math.max(
            minHeight,
            startRectRef.current.height - pdfDeltaY,
          );
          newRect.y =
            startRectRef.current.y +
            startRectRef.current.height -
            newRect.height;
          break;
        case "n": // Top edge
          newRect.height = Math.max(
            minHeight,
            startRectRef.current.height + pdfDeltaY,
          );
          break;
      }

      const clampedRect = clampRectToPage(newRect, minWidth, minHeight);
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

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isResizing,
    isDragging,
    resizeHandle,
    viewport,
    placement.id,
    onPlacementResize,
    clampRectToPage,
    minWidth,
    minHeight,
  ]);

  const style = getStyle(localRect);

  const isSignature = placement.fieldType === "signature";
  const resizeHandleColorClass = isSignature
    ? "bg-primary border-primary"
    : "bg-indigo-600 border-indigo-600";

  const isEditable = mode === "edit" && typeof onPlacementResize === "function";

  return (
    <div
      style={style}
      className={cn(
        "border-2 absolute hover:bg-opacity-30 transition-colors z-20 select-none rounded-sm",
        isSignature
          ? "border-primary bg-primary/20"
          : "border-indigo-500 bg-indigo-500/20",
        isSelected &&
          (isSignature
            ? "ring-2 ring-primary ring-offset-2 shadow-lg border-primary bg-primary/30"
            : "ring-2 ring-indigo-500 ring-offset-2 shadow-lg border-indigo-500 bg-indigo-500/30"),
        isResizing && "cursor-crosshair",
        isEditable
          ? isDragging
            ? "cursor-grabbing opacity-80 shadow-xl"
            : "cursor-move"
          : "cursor-pointer",
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
          isSignature ? "bg-primary" : "bg-indigo-600",
        )}
      >
        {placement.label || (isSignature ? "Signature" : placement.fieldType)}
      </div>

      {/* Value overlay */}
      <div className="absolute inset-0 flex items-center justify-center px-1.5 py-1 pointer-events-none">
        <WaiverPlacementValue
          placement={placement}
          fieldValue={fieldValue}
          signature={signature}
        />
      </div>

      {isSelected && isEditable && !isResizing && !isDragging && (
        <>
          {/* Corner handles */}
          <div
            className={cn(
              "resize-handle absolute -top-1 -left-1 w-3 h-3 border rounded-full cursor-nw-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "nw")}
          />
          <div
            className={cn(
              "resize-handle absolute -top-1 -right-1 w-3 h-3 border rounded-full cursor-ne-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "ne")}
          />
          <div
            className={cn(
              "resize-handle absolute -bottom-1 -left-1 w-3 h-3 border rounded-full cursor-sw-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "sw")}
          />
          <div
            className={cn(
              "resize-handle absolute -bottom-1 -right-1 w-3 h-3 border rounded-full cursor-se-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "se")}
          />

          {/* Edge handles */}
          <div
            className={cn(
              "resize-handle absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-2 border rounded cursor-n-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "n")}
          />
          <div
            className={cn(
              "resize-handle absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-2 border rounded cursor-s-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "s")}
          />
          <div
            className={cn(
              "resize-handle absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-3 border rounded cursor-w-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "w")}
          />
          <div
            className={cn(
              "resize-handle absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-3 border rounded cursor-e-resize z-30",
              resizeHandleColorClass,
            )}
            onMouseDown={(e) => handleMouseDown(e, "e")}
          />
        </>
      )}
    </div>
  );
}
