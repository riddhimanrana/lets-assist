"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Sparkles, AlertCircle } from "lucide-react";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import { PdfViewerWithOverlay, CustomPlacement } from "./PdfViewerWithOverlay";
import { SignerRolesEditor, WaiverDefinitionSignerInput } from "./SignerRolesEditor";
import { FieldListPanel, FieldMapping } from "./FieldListPanel";
import { SignaturePlacementsEditor } from "./SignaturePlacementsEditor";
import { toast } from "sonner";
import { SignerData, WaiverDefinitionFull, WaiverFieldType } from "@/types/waiver-definitions";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Separator } from "@/components/ui/separator";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

const SUPPORTED_CUSTOM_FIELD_TYPES: ReadonlyArray<WaiverFieldType> = [
  'signature',
  'initial',
  'name',
  'date',
  'email',
  'phone',
  'address',
  'checkbox',
  'text',
  'radio',
  'dropdown',
];

const SAMPLE_FIELD_TEXT: Record<WaiverFieldType, string | boolean> = {
  signature: 'Alex Johnson',
  initial: 'AJ',
  name: 'Alex Johnson',
  date: new Date().toISOString().slice(0, 10),
  email: 'alex@example.com',
  phone: '123-456-7890',
  address: '123 Main St, Springfield, IL 62701',
  checkbox: true,
  text: 'Sample value',
  radio: 'Option A',
  dropdown: 'Option A',
};

function normalizeCustomFieldType(fieldType: string): WaiverFieldType {
  return SUPPORTED_CUSTOM_FIELD_TYPES.includes(fieldType as WaiverFieldType)
    ? (fieldType as WaiverFieldType)
    : 'text';
}

function hydrateMappingForDetectedField(
  detectedField: DetectedPdfField,
  savedMapping: FieldMapping
): FieldMapping {
  return {
    ...savedMapping,
    fieldKey: detectedField.fieldName,
    fieldType: detectedField.fieldType,
    pageIndex: detectedField.pageIndex,
    rect: detectedField.rect,
    pdfFieldName: detectedField.fieldName,
    required: savedMapping.required ?? detectedField.required ?? false,
  };
}

function rectSimilarityScore(a: CustomPlacement['rect'], b: CustomPlacement['rect']): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y) +
    Math.abs(a.width - b.width) +
    Math.abs(a.height - b.height)
  );
}

function reconcileDetectedMappings(
  savedMappings: Record<string, FieldMapping>,
  detected: DetectedPdfField[]
): Record<string, FieldMapping> {
  if (!savedMappings || Object.keys(savedMappings).length === 0 || detected.length === 0) {
    return savedMappings ?? {};
  }

  const reconciled: Record<string, FieldMapping> = {};
  const remaining = new Map<string, FieldMapping>(Object.entries(savedMappings));
  const unmatchedDetected: DetectedPdfField[] = [];

  // Pass 1: direct name-based matches (field key / pdf field name)
  detected.forEach((field) => {
    const direct = remaining.get(field.fieldName);
    if (direct) {
      reconciled[field.fieldName] = hydrateMappingForDetectedField(field, direct);
      remaining.delete(field.fieldName);
      return;
    }

    const aliasMatch = Array.from(remaining.entries()).find(([, mapping]) => {
      return mapping.pdfFieldName === field.fieldName || mapping.fieldKey === field.fieldName;
    });

    if (aliasMatch) {
      const [matchedKey, matchedMapping] = aliasMatch;
      reconciled[field.fieldName] = hydrateMappingForDetectedField(field, matchedMapping);
      remaining.delete(matchedKey);
      return;
    }

    unmatchedDetected.push(field);
  });

  // Pass 2: geometry/page/type-based fallback for legacy random keys
  unmatchedDetected.forEach((field) => {
    let bestKey: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const [savedKey, savedMapping] of remaining.entries()) {
      if (savedMapping.pageIndex !== field.pageIndex) continue;
      if (savedMapping.fieldType !== field.fieldType) continue;

      const score = rectSimilarityScore(savedMapping.rect, field.rect);
      if (score < bestScore) {
        bestScore = score;
        bestKey = savedKey;
      }
    }

    // Geometry is in PDF points. <= 24 allows slight parser drift while preventing bad matches.
    if (bestKey && bestScore <= 24) {
      const bestMapping = remaining.get(bestKey);
      if (bestMapping) {
        reconciled[field.fieldName] = hydrateMappingForDetectedField(field, bestMapping);
        remaining.delete(bestKey);
      }
    }
  });

  return reconciled;
}

export interface WaiverDefinitionInput {
  signers: WaiverDefinitionSignerInput[];
  // Map both detected fields and custom placements
  fields: {
    detected: Record<string, FieldMapping>;
    custom: CustomPlacement[];
  };
}

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
}: WaiverBuilderDialogProps) {
  const [activeTab, setActiveTab] = useState("signers");
  const [isSaving, setIsSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const isPhone = useMediaQuery("(max-width: 640px)");
  const isCompactLayout = useMediaQuery("(max-width: 1024px)");
  
  // State
  const [signers, setSigners] = useState<WaiverDefinitionSignerInput[]>([
    { roleKey: "volunteer", label: "Volunteer", required: true, orderIndex: 0 }
  ]);
  
  const [fieldMappings, setFieldMappings] = useState<Record<string, FieldMapping>>({});
  const [customPlacements, setCustomPlacements] = useState<CustomPlacement[]>([]);
  const [showSamplePreview, setShowSamplePreview] = useState(false);
  
  // Selection state
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | undefined>();
  const [highlightedField, setHighlightedField] = useState<DetectedPdfField | null>(null);
  
  // Mode
  // In the builder we want placements to be draggable/resizable by default.
  const [viewerMode, setViewerMode] = useState<'view' | 'add-signature' | 'edit'>('edit');

  // Handle PDF URL and load existing definition PDF (Task 3)
  const [effectivePdfUrl, setEffectivePdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (pdfUrl) {
      setEffectivePdfUrl(pdfUrl);
    } else if (pdfFile && pdfFile instanceof Blob) {
      try {
        const url = URL.createObjectURL(pdfFile);
        setEffectivePdfUrl(url);
        return () => URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Failed to create object URL for PDF:', error);
        toast.error('Error loading PDF file');
      }
    } else if (existingDefinition?.pdf_public_url) {
      // Logic handled below in initialization effect for URL setting,
      // but here we ensure state is sync
      if (!effectivePdfUrl) {
        setEffectivePdfUrl(existingDefinition.pdf_public_url);
      }
    }
  }, [pdfUrl, pdfFile, existingDefinition]);

  // Initialize state
  useEffect(() => {
    if (open) {
      setShowSamplePreview(false);
      if (existingDraftDefinition) {
        const loadedSigners = existingDraftDefinition.signers
          .map((signer) => ({
            roleKey: signer.roleKey,
            label: signer.label,
            required: signer.required,
            orderIndex: signer.orderIndex,
          }))
          .sort((a, b) => a.orderIndex - b.orderIndex);

        setSigners(
          loadedSigners.length > 0
            ? loadedSigners
            : [{ roleKey: "volunteer", label: "Volunteer", required: true, orderIndex: 0 }]
        );

        const savedDetectedMappings = existingDraftDefinition.fields?.detected ?? {};
        setFieldMappings(reconcileDetectedMappings(savedDetectedMappings, detectedFields));
        setCustomPlacements(
          (existingDraftDefinition.fields?.custom ?? []).map((placement) => ({
            ...placement,
            fieldKey: placement.fieldKey || placement.id,
            fieldType: normalizeCustomFieldType(placement.fieldType),
          }))
        );
        return;
      }

      // If we have an existing definition, load it
      if (!existingDefinition) {
         setSigners([{ roleKey: "volunteer", label: "Volunteer", required: true, orderIndex: 0 }]);
         setFieldMappings({});
         setCustomPlacements([]);
      } else {
         // Load signers
         const loadedSigners = existingDefinition.signers.map(s => ({
            roleKey: s.role_key,
            label: s.label,
            required: s.required,
            orderIndex: s.order_index
         })).sort((a, b) => a.orderIndex - b.orderIndex);
         
         setSigners(loadedSigners.length > 0 ? loadedSigners : [{ roleKey: "volunteer", label: "Volunteer", required: true, orderIndex: 0 }]);
         
         // Load fields
         const mappings: Record<string, FieldMapping> = {};
         const custom: CustomPlacement[] = [];
         
         if (existingDefinition.fields && Array.isArray(existingDefinition.fields)) {
            existingDefinition.fields.forEach(f => {
              if (f.source === 'pdf_widget' && f.pdf_field_name) {
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
              } else if (f.source === 'custom_overlay' && f.signer_role_key) {
                 custom.push({
                   id: f.field_key,
                   fieldKey: f.field_key,
                   label: f.label,
                   signerRoleKey: f.signer_role_key,
                   fieldType: normalizeCustomFieldType(f.field_type),
                   required: f.required,
                   pageIndex: f.page_index,
                   rect: f.rect,
                   meta: f.meta ?? null,
                 });
              }
            });
         }
         
         setFieldMappings(mappings);
         setCustomPlacements(custom);
      }
    }
  }, [open, existingDefinition, existingDraftDefinition, detectedFields]);

  // Keyboard shortcut: Delete/Backspace removes the selected custom placement.
  // This makes manual configuration much faster.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedPlacementId) return;
      if (viewerMode !== 'edit') return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        (target?.getAttribute?.('role') === 'textbox') ||
        !!target?.isContentEditable;
      if (isTypingTarget) return;

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      const exists = customPlacements.some((p) => p.id === selectedPlacementId);
      if (!exists) return;

      e.preventDefault();
      setCustomPlacements((prev) => prev.filter((p) => p.id !== selectedPlacementId));
      setSelectedPlacementId(undefined);
      toast.success('Placement removed');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, selectedPlacementId, viewerMode, customPlacements]);

  const handleSave = async () => {
    // Validate
    if (signers.length === 0) {
      toast.error("At least one signer role is required.");
      return;
    }

    // Check if signers are used
    const usedSigners = new Set<string>();
    
    // Check detected signature fields assignments
    detectedFields.forEach(f => {
      if (f.fieldType === 'signature') {
        const mapping = fieldMappings[f.fieldName];
        if (mapping?.signerRoleKey) {
          usedSigners.add(mapping.signerRoleKey);
        }
      }
    });

    // Check custom placements assignments
    customPlacements.forEach(p => {
      if (p.signerRoleKey) {
        usedSigners.add(p.signerRoleKey);
      }
    });

    // Validating Task 2: Ensure complete data persistence
    // We construct the payload, ensuring detected fields carry their metadata (rect, pageIndex)
    
    const completeDetectedMappings: Record<string, FieldMapping> = {};
    
    detectedFields.forEach(field => {
       const userMapping = fieldMappings[field.fieldName];
       completeDetectedMappings[field.fieldName] = {
          fieldKey: field.fieldName,
          signerRoleKey: userMapping?.signerRoleKey || undefined,
          required: userMapping?.required ?? field.required ?? false,
          label: userMapping?.label || field.fieldName,
          fieldType: field.fieldType,
          pageIndex: field.pageIndex,
          rect: field.rect,
         pdfFieldName: field.fieldName,
         meta: userMapping?.meta ?? null,
       };
    });
    
    setIsSaving(true);
    try {
      await onSave({
        signers,
        fields: {
          detected: completeDetectedMappings,
          custom: customPlacements
        }
      });
      onOpenChange(false);
      toast.success("Waiver configuration saved!");
    } catch (error) {
      console.error(error);
      toast.error("Failed to save waiver configuration.");
    } finally {
      setIsSaving(false);
    }
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
      fieldType: 'text',
      required: false,
      pageIndex: placement.pageIndex,
      rect: placement.rect,
      meta: {
        helpText: '',
        signingPurpose: '',
      },
    };
    
    setCustomPlacements([...customPlacements, newPlacement]);
    setViewerMode('edit'); // Exit add mode into edit mode
    setSelectedPlacementId(newPlacement.id);
    setActiveTab("fields"); // Replaced "placements" with "fields" for unified view
  };

  const handleAIScan = async () => {
    if (!pdfFile) {
      toast.error("No PDF file available");
      return;
    }

    setIsScanning(true);
    const loadingToast = toast.loading("Analyzing waiver with AI...", {
      description: "This may take a few moments"
    });

    try {
      const formData = new FormData();
      formData.append('file', pdfFile);

      const response = await fetch('/api/ai/analyze-waiver', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      toast.dismiss(loadingToast);

      if (!response.ok) {
        // Handle specific error cases
        if (data.error?.includes('inappropriate') || data.error?.includes('explicit')) {
          toast.error("PDF content appears inappropriate", {
            description: "Please upload a valid waiver document.",
            duration: 6000
          });
        } else if (data.error?.includes('not a waiver') || data.error?.includes('cannot analyze')) {
          toast.error("Couldn't recognize this as a waiver", {
            description: "Please configure fields manually.",
            duration: 6000
          });
        } else {
          toast.error("AI analysis failed", {
            description: data.error || 'Please try again or configure manually.',
            duration: 6000
          });
        }
        return;
      }

      const { analysis } = data;

      // Validate analysis structure
      if (!analysis || (!analysis.signerRoles?.length && !analysis.fields?.length)) {
        toast.error("No recognizable fields found", {
          description: "AI couldn't detect any fields. Please configure manually.",
          duration: 6000
        });
        return;
      }

      // Apply AI-detected signer roles
      if (analysis.signerRoles && analysis.signerRoles.length > 0) {
        const aiSigners = analysis.signerRoles.map((role: { roleKey: string; label: string; required: boolean }, index: number) => ({
          roleKey: role.roleKey,
          label: role.label,
          required: role.required,
          orderIndex: index
        }));
        setSigners(aiSigners);
      }

      // Convert AI-detected fields to custom placements with PRECISE bounding boxes
      const aiPlacements: CustomPlacement[] = analysis.fields.map((field: {
        fieldType: string;
        label: string;
        signerRole: string;
        pageIndex: number;
        boundingBox: { x: number; y: number; width: number; height: number };
        required: boolean;
      }, index: number) => {
        const placementId = `ai_${Date.now()}_${index}`;
        return {
          id: placementId,
          fieldKey: placementId,
          label: field.label,
          signerRoleKey: field.signerRole,
          fieldType: normalizeCustomFieldType(field.fieldType),
          required: field.required,
          pageIndex: field.pageIndex, // Already 0-indexed from API
          rect: {
            x: field.boundingBox.x,
            y: field.boundingBox.y,
            width: field.fieldType === 'signature' ? Math.max(field.boundingBox.width, 180) : field.boundingBox.width,
            height: field.fieldType === 'signature' ? Math.max(field.boundingBox.height, 50) : field.boundingBox.height
          },
          meta: {
            helpText: '',
            signingPurpose: '',
          },
        };
      });

      setCustomPlacements(aiPlacements);
      setActiveTab("fields");

      toast.success("AI scan complete!", {
        description: `Detected ${analysis.signerRoles.length} signer role(s) and ${analysis.fields.length} field(s) across ${analysis.pageCount} page(s).`,
        duration: 6000
      });

      // Show best-effort warning
      toast.warning("AI placements are best-effort", {
        description: "Please verify every box and adjust manually before saving.",
        duration: 8000
      });

    } catch (error) {
      console.error('AI scan error:', error);
      toast.error("Network error during analysis", {
        description: "Please try again or configure manually.",
        duration: 6000
      });
    } finally {
      setIsScanning(false);
    }
  };

  const detectedFieldRoleMap = useMemo<Record<string, string | undefined>>(() => {
    return Object.fromEntries(
      Object.entries(fieldMappings).map(([fieldName, mapping]) => [fieldName, mapping?.signerRoleKey])
    );
  }, [fieldMappings]);

  const sampleSignatures = useMemo<Record<string, SignerData>>(() => {
    const timestamp = new Date().toISOString();
    return signers.reduce<Record<string, SignerData>>((accumulator, signer) => {
      accumulator[signer.roleKey] = {
        role_key: signer.roleKey,
        method: 'typed',
        data: signer.label || 'Sample Signer',
        timestamp,
        signer_name: signer.label || 'Sample Signer',
      };
      return accumulator;
    }, {});
  }, [signers]);

  const sampleFieldValues = useMemo<Record<string, string | boolean | number | null | undefined>>(() => {
    const values: Record<string, string | boolean | number | null | undefined> = {};

    detectedFields.forEach((field) => {
      const fieldType = normalizeCustomFieldType(field.fieldType);
      if (fieldType === 'signature') return;
      values[field.fieldName] = SAMPLE_FIELD_TEXT[fieldType];
    });

    customPlacements.forEach((placement) => {
      if (placement.fieldType === 'signature') return;
      const key = placement.fieldKey || placement.id;
      values[key] = SAMPLE_FIELD_TEXT[placement.fieldType] ?? SAMPLE_FIELD_TEXT.text;
    });

    return values;
  }, [detectedFields, customPlacements]);

  const sampleValueLayer = useMemo(() => {
    return {
      fieldValues: sampleFieldValues,
      signatures: sampleSignatures,
    };
  }, [sampleFieldValues, sampleSignatures]);

  const viewerPanel = (
    <div className="h-full bg-muted/20 relative flex flex-col">
      {effectivePdfUrl ? (
        <PdfViewerWithOverlay
          pdfUrl={effectivePdfUrl}
          detectedFields={detectedFields}
          customPlacements={customPlacements}
          detectedFieldRoleMap={showSamplePreview ? detectedFieldRoleMap : undefined}
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
          onAddPlacement={handleAddPlacement}
          onPlacementResize={(placementId, newRect) => {
            setCustomPlacements(prev =>
              prev.map(p => p.id === placementId ? { ...p, rect: newRect } : p)
            );
          }}
          mode={viewerMode}
          highlightedField={highlightedField}
          valueLayer={showSamplePreview ? sampleValueLayer : undefined}
        />
      ) : (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}

      {viewerMode === 'add-signature' && (
        <div className="absolute top-3 sm:top-6 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 sm:px-4 py-2 rounded-full shadow-lg text-[11px] sm:text-sm font-medium animate-in fade-in slide-in-from-top-4 z-30 max-w-[95%] sm:max-w-none">
          <span className="text-center">Tap/click on document to place a new field label</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-6 text-primary-foreground hover:text-primary-foreground/80 hover:bg-primary-foreground/20"
            onClick={() => setViewerMode('edit')}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );

  const sidebarPanel = (
    <div className="h-full flex flex-col bg-background min-h-0">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start h-auto px-2 py-1.5 sm:p-1 bg-muted/50 rounded-none border-b gap-1">
          <TabsTrigger
            value="signers"
            className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-[11px] sm:text-sm py-2 sm:py-2.5"
          >
            1. Signers
          </TabsTrigger>
          <TabsTrigger
            value="fields"
            className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-[11px] sm:text-sm py-2 sm:py-2.5"
          >
            2. Fields & Signatures
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden min-h-0">
          <TabsContent value="signers" className="h-full m-0 p-3 sm:p-4 md:p-5 overflow-auto">
            <div className="text-xs sm:text-sm text-muted-foreground mb-3 pb-3 border-b">
              Define roles that must sign this waiver (e.g., Volunteer, Parent, Guardian).
            </div>
            <SignerRolesEditor
              signers={signers}
              onSignersChange={setSigners}
            />
            <div className="mt-5 pt-4 border-t">
              <Button
                className="w-full"
                onClick={() => setActiveTab("fields")}
                variant="outline"
              >
                Next: Configure Fields
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="fields" className="h-full m-0 overflow-auto">
            <div className="p-3 sm:p-4 md:p-5 space-y-5 sm:space-y-6">

              {/* Section 1: Detected Fields */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">Detected PDF Fields
                  <span className="text-xs font-normal text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">
                    {detectedFields.length}
                  </span>
                </h3>

                {/* Detection Summary Block */}
                <div className="bg-muted/30 p-3 rounded-md mb-4 text-xs border">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Signer Roles</span>
                      <span className="font-medium" data-testid="waiver-summary-signer-roles">{signers.length}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Signature Fields</span>
                      <span className="font-medium" data-testid="waiver-summary-signature-fields">{detectedFields.filter(f => f.fieldType === 'signature').length}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Other Fields</span>
                      <span className="font-medium" data-testid="waiver-summary-other-fields">{detectedFields.filter(f => f.fieldType !== 'signature').length}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Custom Placements</span>
                      <span className="font-medium" data-testid="waiver-summary-custom-placements">{customPlacements.length}</span>
                    </div>
                  </div>

                  {/* Warning States */}
                  {(detectedFields.filter(f => f.fieldType === 'signature').length === 0) && (
                    <div className="flex items-start gap-2 text-warning bg-warning/10 border border-warning/40 p-2 rounded mt-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>No signature fields detected. Please use "Custom Field Placements" below.</span>
                    </div>
                  )}

                  {(detectedFields.filter(f => f.fieldType === 'signature').length > 0 &&
                    detectedFields.filter(f => f.fieldType === 'signature').length < signers.length) && (
                    <div className="flex items-start gap-2 text-info bg-info/10 border border-info/40 p-2 rounded mt-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Fewer signature fields than signer roles. You may need custom placements.</span>
                    </div>
                  )}

                  {/* Parent/Guardian heuristic warning */}
                  {(signers.some(s => s.roleKey.toLowerCase().includes('parent') || s.roleKey.toLowerCase().includes('guardian')) &&
                    !detectedFields.some(f =>
                      (f.fieldType === 'text' || f.fieldType === 'unknown') &&
                      (f.fieldName.toLowerCase().includes('email') || f.fieldName.toLowerCase().includes('phone'))
                    )) && (
                      <div className="flex items-start gap-2 text-warning bg-warning/10 border border-warning/40 p-2 rounded mt-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>Guardian role detected but no contact fields found. Ensure you collect email/phone.</span>
                      </div>
                    )}
                </div>

                <p className="text-xs text-muted-foreground mb-4">
                  These are interactive form fields detected in your PDF. Map signature fields to roles.
                </p>

                {detectedFields.length > 0 ? (
                  <div className="border rounded-md max-h-88 sm:max-h-96 overflow-auto">
                    <FieldListPanel
                      detectedFields={detectedFields}
                      fieldMappings={fieldMappings}
                      signers={signers}
                      onFieldMappingChange={(key, mapping) => setFieldMappings(prev => ({ ...prev, [key]: mapping }))}
                      onFieldClick={(field) => {
                        setHighlightedField(field);
                      }}
                      highlightedField={highlightedField}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground border rounded-md p-4 text-center bg-muted/20">
                    No PDF form fields detected. <br />
                    Use "Custom Fields" below.
                  </div>
                )}
              </div>

              <Separator />

              {/* Section 2: Custom Placements */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">Custom Field Placements
                  <span className="text-xs font-normal text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">
                    {customPlacements.length}
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Place labeled boxes, then choose type, signer, and e-sign details.
                </p>

                <div className="border rounded-md max-h-96 sm:max-h-112 overflow-auto p-2">
                  <SignaturePlacementsEditor
                    placements={customPlacements}
                    signers={signers}
                    onPlacementsChange={setCustomPlacements}
                    onAddPlacement={() => setViewerMode('add-signature')}
                    selectedPlacementId={selectedPlacementId}
                    onSelectPlacement={(id) => {
                      setSelectedPlacementId(id);
                      setHighlightedField(null);
                    }}
                    isAddingPlacement={viewerMode === 'add-signature'}
                  />
                </div>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );

  return (
    <div>
    <Dialog open={open} onOpenChange={(val) => !isSaving && !isScanning && onOpenChange(val)}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[96vw] lg:w-[95vw] xl:w-[92vw] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] lg:max-w-[95vw] xl:max-w-[92vw] 2xl:max-w-425 h-dvh sm:h-[94vh] flex flex-col p-0 gap-0 overflow-hidden rounded-lg sm:rounded-xl">
        <DialogHeader className="px-3 sm:px-5 lg:px-6 py-3 sm:py-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base sm:text-lg lg:text-xl">Configure Waiver</DialogTitle>
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
              <span>{showSamplePreview ? "Hide Sample Preview" : (isPhone ? "Preview" : "Preview Sample Data")}</span>
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
              <div className="flex-1 min-h-0">
                {sidebarPanel}
              </div>
            </div>
          ) : (
            <ResizablePanelGroup orientation="horizontal" className="h-full">
              {/* Main Area: PDF Viewer (Left/Center) */}
              <ResizablePanel defaultSize="62%" minSize="38%" maxSize="76%" className="p-0 min-w-0">
                {viewerPanel}
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Sidebar: Configuration (Right) */}
              <ResizablePanel defaultSize="38%" minSize="24%" maxSize="62%" className="p-0 min-w-0">
                {sidebarPanel}
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>

        <DialogFooter className="px-3 sm:px-5 lg:px-6 py-3 sm:py-4 border-t bg-background shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}
