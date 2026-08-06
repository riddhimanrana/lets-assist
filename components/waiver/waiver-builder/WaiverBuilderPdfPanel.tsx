"use client";

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import {
  PdfViewerWithOverlay,
  type CustomPlacement,
} from "../PdfViewerWithOverlay";

type ViewerMode = "view" | "add-signature" | "edit";

type Props = {
  pdfUrl: string | null;
  detectedFields: DetectedPdfField[];
  customPlacements: CustomPlacement[];
  setCustomPlacements: Dispatch<SetStateAction<CustomPlacement[]>>;
  detectedFieldRoleMap?: Record<string, string | undefined>;
  selectedPlacementId?: string;
  setSelectedPlacementId: Dispatch<SetStateAction<string | undefined>>;
  setActiveTab: Dispatch<SetStateAction<string>>;
  highlightedField: DetectedPdfField | null;
  setHighlightedField: Dispatch<SetStateAction<DetectedPdfField | null>>;
  onAddPlacement: (placement: Partial<CustomPlacement>) => void;
  viewerMode: ViewerMode;
  setViewerMode: Dispatch<SetStateAction<ViewerMode>>;
  valueLayer?: ComponentProps<typeof PdfViewerWithOverlay>["valueLayer"];
};

export function WaiverBuilderPdfPanel(props: Props) {
  const {
    pdfUrl,
    detectedFields,
    customPlacements,
    setCustomPlacements,
    detectedFieldRoleMap,
    selectedPlacementId,
    setSelectedPlacementId,
    setActiveTab,
    highlightedField,
    setHighlightedField,
    onAddPlacement,
    viewerMode,
    setViewerMode,
    valueLayer,
  } = props;

  return (
    <div className="h-full bg-muted/20 relative flex flex-col">
      {pdfUrl ? (
        <PdfViewerWithOverlay
          pdfUrl={pdfUrl}
          detectedFields={detectedFields}
          customPlacements={customPlacements}
          detectedFieldRoleMap={detectedFieldRoleMap}
          selectedPlacementId={selectedPlacementId}
          onPlacementClick={(id) => {
            setSelectedPlacementId(id);
            setActiveTab("fields");
            setHighlightedField(null);
          }}
          onDetectedFieldClick={(field) => {
            setHighlightedField(field);
            setActiveTab("fields");
            setSelectedPlacementId(undefined);
          }}
          onAddPlacement={onAddPlacement}
          onPlacementResize={(placementId, rect) => {
            setCustomPlacements((previous) =>
              previous.map((placement) =>
                placement.id === placementId
                  ? { ...placement, rect }
                  : placement,
              ),
            );
          }}
          mode={viewerMode}
          highlightedField={highlightedField}
          valueLayer={valueLayer}
        />
      ) : (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}

      {viewerMode === "add-signature" && (
        <div className="absolute top-3 sm:top-6 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 sm:px-4 py-2 rounded-full shadow-lg text-[11px] sm:text-sm font-medium animate-in fade-in slide-in-from-top-4 z-30 max-w-[95%] sm:max-w-none">
          <span className="text-center">
            Tap/click on document to place a new field label
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-6 text-primary-foreground hover:text-primary-foreground/80 hover:bg-primary-foreground/20"
            onClick={() => setViewerMode("edit")}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
