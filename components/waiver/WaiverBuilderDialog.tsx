"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Sparkles } from "lucide-react";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import type { CustomPlacement } from "./PdfViewerWithOverlay";
import type { WaiverDefinitionSignerInput } from "./SignerRolesEditor";
import type { FieldMapping } from "./FieldListPanel";
import {
  normalizeCustomPlacementFieldType,
  resizeRectToFieldType,
} from "@/lib/waiver/custom-field-config";
import { toast } from "sonner";
import { WaiverDefinitionFull } from "@/types/waiver-definitions";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

export type { WaiverDefinitionInput } from "./waiver-builder/types";
import type { WaiverDefinitionInput } from "./waiver-builder/types";
import {
  buildDefinitionPayload,
  reconcileDetectedMappings,
} from "./waiver-builder/definition-mappings";
import { useWaiverAiScan } from "./waiver-builder/useWaiverAiScan";
import { WaiverBuilderSidebar } from "./waiver-builder/WaiverBuilderSidebar";
import { useWaiverSampleValues } from "./waiver-builder/useWaiverSampleValues";
import { WaiverBuilderPdfPanel } from "./waiver-builder/WaiverBuilderPdfPanel";

interface WaiverBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfFile: File | null;
  pdfUrl: string | null;
  projectId?: string;
  detectedFields: DetectedPdfField[];
  onSave: (definition: WaiverDefinitionInput) => Promise<void>;
  existingDefinition?: WaiverDefinitionFull;
  existingDraftDefinition?: WaiverDefinitionInput | null;
  autoSaveDraft?: boolean;
}

export function WaiverBuilderDialog({
  open,
  onOpenChange,
  pdfFile,
  pdfUrl,
  detectedFields,
  onSave,
  existingDefinition,
  existingDraftDefinition,
  autoSaveDraft = false,
}: WaiverBuilderDialogProps) {
  const [activeTab, setActiveTab] = useState("signers");
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const isPhone = useMediaQuery("(max-width: 640px)");
  const isCompactLayout = useMediaQuery("(max-width: 1024px)");

  // State
  const [signers, setSigners] = useState<WaiverDefinitionSignerInput[]>([
    { roleKey: "volunteer", label: "Volunteer", required: true, orderIndex: 0 },
  ]);

  const [fieldMappings, setFieldMappings] = useState<
    Record<string, FieldMapping>
  >({});
  const [customPlacements, setCustomPlacements] = useState<CustomPlacement[]>(
    [],
  );
  const { isScanning, handleAIScan } = useWaiverAiScan({
    pdfFile,
    setSigners,
    setCustomPlacements,
    setActiveTab,
  });
  const [showSamplePreview, setShowSamplePreview] = useState(false);

  // Selection state
  const [selectedPlacementId, setSelectedPlacementId] = useState<
    string | undefined
  >();
  const [highlightedField, setHighlightedField] =
    useState<DetectedPdfField | null>(null);

  // Mode
  // In the builder we want placements to be draggable/resizable by default.
  const [viewerMode, setViewerMode] = useState<
    "view" | "add-signature" | "edit"
  >("edit");

  // Handle PDF URL and load existing definition PDF (Task 3)
  const [effectivePdfUrl, setEffectivePdfUrl] = useState<string | null>(null);
  const lastSavedSnapshotRef = useRef<string>("");
  const hasInitializedForOpenRef = useRef(false);

  useEffect(() => {
    if (pdfUrl) {
      setEffectivePdfUrl(pdfUrl);
    } else if (pdfFile && pdfFile instanceof Blob) {
      try {
        const url = URL.createObjectURL(pdfFile);
        setEffectivePdfUrl(url);
        return () => URL.revokeObjectURL(url);
      } catch (error) {
        console.error("Failed to create object URL for PDF:", error);
        toast.error("Error loading PDF file");
      }
    } else if (existingDefinition?.pdf_public_url) {
      // Logic handled below in initialization effect for URL setting,
      // but here we ensure state is sync
      if (!effectivePdfUrl) {
        setEffectivePdfUrl(existingDefinition.pdf_public_url);
      }
    }
  }, [pdfUrl, pdfFile, existingDefinition]);

  const getCurrentDefinition = useCallback((): WaiverDefinitionInput => {
    return buildDefinitionPayload(
      signers,
      fieldMappings,
      customPlacements,
      detectedFields,
    );
  }, [signers, fieldMappings, customPlacements, detectedFields]);

  const persistDefinition = useCallback(
    async (mode: "manual" | "auto", closeAfterSave: boolean = false) => {
      const currentDefinition = getCurrentDefinition();
      const snapshot = JSON.stringify(currentDefinition);

      if (mode === "auto" && snapshot === lastSavedSnapshotRef.current) {
        if (closeAfterSave) {
          onOpenChange(false);
        }
        return;
      }

      if (mode === "manual") {
        if (signers.length === 0) {
          toast.error("At least one signer role is required.");
          return;
        }
        setIsSaving(true);
      } else {
        setIsAutoSaving(true);
      }

      try {
        await onSave(currentDefinition);
        lastSavedSnapshotRef.current = snapshot;

        if (mode === "auto" && closeAfterSave) {
          onOpenChange(false);
        }

        if (mode === "manual") {
          toast.success("Waiver configuration saved!");
        } else {
          toast.success("Waiver configuration auto-saved", {
            id: "waiver-builder-autosave",
          });
        }

        if (closeAfterSave && mode === "manual") {
          onOpenChange(false);
        }
      } catch (error) {
        console.error(error);
        if (mode === "manual") {
          toast.error("Failed to save waiver configuration.");
        } else {
          if (closeAfterSave) {
            onOpenChange(false);
          }
          toast.error("Auto-save failed. Please check your connection.", {
            id: "waiver-builder-autosave",
          });
        }
      } finally {
        if (mode === "manual") {
          setIsSaving(false);
        } else {
          setIsAutoSaving(false);
        }
      }
    },
    [getCurrentDefinition, onSave, onOpenChange, signers.length],
  );

  // Initialize state once per open cycle.
  useEffect(() => {
    if (!open) {
      hasInitializedForOpenRef.current = false;
      return;
    }

    if (hasInitializedForOpenRef.current) {
      return;
    }

    hasInitializedForOpenRef.current = true;
    setShowSamplePreview(false);

    let initialSigners: WaiverDefinitionSignerInput[] = [
      {
        roleKey: "volunteer",
        label: "Volunteer",
        required: true,
        orderIndex: 0,
      },
    ];
    let initialMappings: Record<string, FieldMapping> = {};
    let initialCustomPlacements: CustomPlacement[] = [];

    if (existingDraftDefinition) {
      const loadedSigners = existingDraftDefinition.signers
        .map((signer) => ({
          roleKey: signer.roleKey,
          label: signer.label,
          required: signer.required,
          orderIndex: signer.orderIndex,
        }))
        .sort((a, b) => a.orderIndex - b.orderIndex);

      initialSigners =
        loadedSigners.length > 0
          ? loadedSigners
          : [
              {
                roleKey: "volunteer",
                label: "Volunteer",
                required: true,
                orderIndex: 0,
              },
            ];
      initialMappings = reconcileDetectedMappings(
        existingDraftDefinition.fields?.detected ?? {},
        detectedFields,
      );
      initialCustomPlacements = (
        existingDraftDefinition.fields?.custom ?? []
      ).map((placement) => ({
        ...placement,
        fieldKey: placement.fieldKey || placement.id,
        fieldType: normalizeCustomPlacementFieldType(placement.fieldType),
      }));
    } else if (existingDefinition) {
      const loadedSigners = existingDefinition.signers
        .map((s) => ({
          roleKey: s.role_key,
          label: s.label,
          required: s.required,
          orderIndex: s.order_index,
        }))
        .sort((a, b) => a.orderIndex - b.orderIndex);

      initialSigners =
        loadedSigners.length > 0
          ? loadedSigners
          : [
              {
                roleKey: "volunteer",
                label: "Volunteer",
                required: true,
                orderIndex: 0,
              },
            ];

      const mappings: Record<string, FieldMapping> = {};
      const custom: CustomPlacement[] = [];

      if (
        existingDefinition.fields &&
        Array.isArray(existingDefinition.fields)
      ) {
        existingDefinition.fields.forEach((f) => {
          if (f.source === "pdf_widget" && f.pdf_field_name) {
            mappings[f.pdf_field_name] = {
              fieldKey: f.pdf_field_name,
              signerRoleKey: f.signer_role_key || undefined,
              required: f.required,
              fieldType: f.field_type,
              pageIndex: f.page_index,
              rect: f.rect,
              pdfFieldName: f.pdf_field_name,
              meta: f.meta ?? null,
            };
          } else if (f.source === "custom_overlay" && f.signer_role_key) {
            custom.push({
              id: f.field_key,
              fieldKey: f.field_key,
              label: f.label,
              signerRoleKey: f.signer_role_key,
              fieldType: normalizeCustomPlacementFieldType(f.field_type),
              required: f.required,
              pageIndex: f.page_index,
              rect: f.rect,
              meta: f.meta ?? null,
            });
          }
        });
      }

      initialMappings = mappings;
      initialCustomPlacements = custom;
    }

    setSigners(initialSigners);
    setFieldMappings(initialMappings);
    setCustomPlacements(initialCustomPlacements);

    lastSavedSnapshotRef.current = JSON.stringify(
      buildDefinitionPayload(
        initialSigners,
        initialMappings,
        initialCustomPlacements,
        detectedFields,
      ),
    );
  }, [open, existingDefinition, existingDraftDefinition, detectedFields]);

  // Keyboard shortcut: Delete/Backspace removes the selected custom placement.
  // This makes manual configuration much faster.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedPlacementId) return;
      if (viewerMode !== "edit") return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tag === "input" ||
        tag === "textarea" ||
        target?.getAttribute?.("role") === "textbox" ||
        !!target?.isContentEditable;
      if (isTypingTarget) return;

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      const exists = customPlacements.some((p) => p.id === selectedPlacementId);
      if (!exists) return;

      e.preventDefault();
      setCustomPlacements((prev) =>
        prev.filter((p) => p.id !== selectedPlacementId),
      );
      setSelectedPlacementId(undefined);
      toast.success("Placement removed");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, selectedPlacementId, viewerMode, customPlacements]);

  const handleRequestClose = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      if (isSaving || isScanning || isAutoSaving) {
        return;
      }

      if (!autoSaveDraft) {
        onOpenChange(false);
        return;
      }

      void persistDefinition("auto", true);
    },
    [
      autoSaveDraft,
      isSaving,
      isScanning,
      isAutoSaving,
      onOpenChange,
      persistDefinition,
    ],
  );

  const handleSave = async () => {
    await persistDefinition("manual", true);
  };

  const handleAddPlacement = (placement: Partial<CustomPlacement>) => {
    if (!placement.rect || placement.pageIndex === undefined) return;

    // Default to first signer
    const defaultSigner = signers[0]?.roleKey || "volunteer";

    const placementId = `custom_${Date.now()}`;
    const newPlacement: CustomPlacement = {
      id: placementId,
      fieldKey: placementId,
      label: "New Field Label",
      signerRoleKey: defaultSigner,
      fieldType: "text",
      required: false,
      pageIndex: placement.pageIndex,
      rect: resizeRectToFieldType(placement.rect, "text"),
      meta: {
        helpText: "",
        signingPurpose: "",
      },
    };

    setCustomPlacements([...customPlacements, newPlacement]);
    setViewerMode("edit"); // Exit add mode into edit mode
    setSelectedPlacementId(newPlacement.id);
    setActiveTab("fields"); // Replaced "placements" with "fields" for unified view
  };

  const { detectedFieldRoleMap, sampleValueLayer } = useWaiverSampleValues({
    fieldMappings,
    signers,
    detectedFields,
    customPlacements,
  });

  const viewerPanel = (
    <WaiverBuilderPdfPanel
      pdfUrl={effectivePdfUrl}
      detectedFields={detectedFields}
      customPlacements={customPlacements}
      setCustomPlacements={setCustomPlacements}
      detectedFieldRoleMap={
        showSamplePreview ? detectedFieldRoleMap : undefined
      }
      selectedPlacementId={selectedPlacementId}
      setSelectedPlacementId={setSelectedPlacementId}
      setActiveTab={setActiveTab}
      highlightedField={highlightedField}
      setHighlightedField={setHighlightedField}
      onAddPlacement={handleAddPlacement}
      viewerMode={viewerMode}
      setViewerMode={setViewerMode}
      valueLayer={showSamplePreview ? sampleValueLayer : undefined}
    />
  );
  const sidebarPanel = (
    <WaiverBuilderSidebar
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      detectedFields={detectedFields}
      fieldMappings={fieldMappings}
      setFieldMappings={setFieldMappings}
      signers={signers}
      setSigners={setSigners}
      customPlacements={customPlacements}
      setCustomPlacements={setCustomPlacements}
      highlightedField={highlightedField}
      setHighlightedField={setHighlightedField}
      selectedPlacementId={selectedPlacementId}
      setSelectedPlacementId={setSelectedPlacementId}
      viewerMode={viewerMode}
      setViewerMode={setViewerMode}
    />
  );

  return (
    <div>
      <Dialog open={open} onOpenChange={handleRequestClose}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:w-[96vw] lg:w-[95vw] xl:w-[92vw] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] lg:max-w-[95vw] xl:max-w-[92vw] 2xl:max-w-425 h-dvh sm:h-[94vh] flex flex-col p-0 gap-0 overflow-hidden rounded-lg sm:rounded-xl">
          <DialogHeader className="px-3 sm:px-5 lg:px-6 py-3 sm:py-4 border-b shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base sm:text-lg lg:text-xl">
                  Configure Waiver
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm mt-1">
                  Define who needs to sign and where.
                </DialogDescription>
              </div>

              <Button
                onClick={() => setShowSamplePreview((previous) => !previous)}
                variant={showSamplePreview ? "default" : "outline"}
                size="sm"
                className="gap-2 shrink-0"
                disabled={!effectivePdfUrl}
              >
                <span>
                  {showSamplePreview
                    ? "Hide Sample Preview"
                    : isPhone
                      ? "Preview"
                      : "Preview Sample Data"}
                </span>
              </Button>

              <Button
                onClick={handleAIScan}
                disabled={isScanning || !pdfFile}
                variant="outline"
                size="sm"
                className="gap-2 mr-6 shrink-0"
                data-testid="waiver-ai-scan-button"
              >
                {isScanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>{isPhone ? "AI" : "AI Scan"}</span>
              </Button>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-hidden min-h-0">
            {isCompactLayout ? (
              <div className="h-full flex flex-col min-h-0">
                <div className="min-h-65 h-[44dvh] sm:h-[50dvh] border-b">
                  {viewerPanel}
                </div>
                <div className="flex-1 min-h-0">{sidebarPanel}</div>
              </div>
            ) : (
              <ResizablePanelGroup orientation="horizontal" className="h-full">
                {/* Main Area: PDF Viewer (Left/Center) */}
                <ResizablePanel
                  defaultSize="62%"
                  minSize="38%"
                  maxSize="76%"
                  className="p-0 min-w-0"
                >
                  {viewerPanel}
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Sidebar: Configuration (Right) */}
                <ResizablePanel
                  defaultSize="38%"
                  minSize="24%"
                  maxSize="62%"
                  className="p-0 min-w-0"
                >
                  {sidebarPanel}
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>

          <DialogFooter className="px-3 sm:px-5 lg:px-6 py-3 sm:py-4 border-t bg-background shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => handleRequestClose(false)}
              disabled={isSaving || isAutoSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || isAutoSaving}
              className="w-full sm:w-auto"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
