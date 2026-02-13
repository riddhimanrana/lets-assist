"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Sparkles } from "lucide-react";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import { PdfViewerWithOverlay, CustomPlacement } from "./PdfViewerWithOverlay";
import { SignerRolesEditor, WaiverDefinitionSignerInput } from "./SignerRolesEditor";
import { FieldListPanel, FieldMapping } from "./FieldListPanel";
import { SignaturePlacementsEditor } from "./SignaturePlacementsEditor";
import { toast } from "sonner";
import { WaiverDefinitionFull } from "@/types/waiver-definitions";

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
}

export function WaiverBuilderDialog({
  open,
  onOpenChange,
  pdfFile,
  pdfUrl,
  detectedFields,
  onSave,
  existingDefinition
}: WaiverBuilderDialogProps) {
  const [activeTab, setActiveTab] = useState("signers");
  const [isSaving, setIsSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // State
  const [signers, setSigners] = useState<WaiverDefinitionSignerInput[]>([
    { roleKey: "volunteer", label: "Volunteer", required: true, orderIndex: 0 }
  ]);
  
  const [fieldMappings, setFieldMappings] = useState<Record<string, FieldMapping>>({});
  const [customPlacements, setCustomPlacements] = useState<CustomPlacement[]>([]);
  
  // Selection state
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | undefined>();
  const [highlightedField, setHighlightedField] = useState<DetectedPdfField | null>(null);
  
  // Mode
  const [viewerMode, setViewerMode] = useState<'view' | 'add-signature' | 'edit'>('view');

  // Initialize state
  useEffect(() => {
    if (open) {
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
              if (f.source === 'pdf_widget' && f.pdf_field_name && f.signer_role_key) {
                 mappings[f.pdf_field_name] = {
                   fieldKey: f.pdf_field_name,
                   signerRoleKey: f.signer_role_key!,
                   required: f.required
                 };
              } else if (f.source === 'custom_overlay' && f.signer_role_key) {
                 custom.push({
                   id: f.field_key,
                   label: f.label,
                   signerRoleKey: f.signer_role_key,
                   required: f.required,
                   pageIndex: f.page_index,
                   rect: f.rect
                 });
              }
            });
         }
         
         setFieldMappings(mappings);
         setCustomPlacements(custom);
      }
    }
  }, [open, existingDefinition]);

  // Handle PDF URL
  const [effectivePdfUrl, setEffectivePdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (pdfUrl) {
      setEffectivePdfUrl(pdfUrl);
    } else if (pdfFile) {
      const url = URL.createObjectURL(pdfFile);
      setEffectivePdfUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [pdfUrl, pdfFile]);

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

    // Warn if roles are unused? No, that's fine.
    
    setIsSaving(true);
    try {
      await onSave({
        signers,
        fields: {
          detected: fieldMappings,
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

    const newPlacement: CustomPlacement = {
      id: `custom_${Date.now()}`,
      label: "Signature",
      signerRoleKey: defaultSigner,
      required: true,
      pageIndex: placement.pageIndex,
      rect: placement.rect
    };
    
    setCustomPlacements([...customPlacements, newPlacement]);
    setViewerMode('view'); // Exit add mode
    setSelectedPlacementId(newPlacement.id);
    setActiveTab("placements");
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
      }, index: number) => ({
        id: `ai_${Date.now()}_${index}`,
        label: field.label,
        signerRoleKey: field.signerRole,
        required: field.required,
        pageIndex: field.pageIndex, // Already 0-indexed from API
        rect: {
          x: field.boundingBox.x,
          y: field.boundingBox.y,
          width: field.boundingBox.width,
          height: field.boundingBox.height
        }
      }));

      setCustomPlacements(aiPlacements);
      setActiveTab("placements");

      toast.success("AI scan complete!", {
        description: `Detected ${analysis.signerRoles.length} signer role(s) and ${analysis.fields.length} field(s) across ${analysis.pageCount} page(s).`,
        duration: 6000
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

  return (
    <Dialog open={open} onOpenChange={(val) => !isSaving && !isScanning && onOpenChange(val)}>
      <DialogContent className="max-w-[98vw] md:max-w-[95vw] lg:max-w-350 h-[95vh] md:h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 md:px-6 py-3 border-b shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg md:text-xl">Configure Waiver</DialogTitle>
              <DialogDescription className="text-xs md:text-sm mt-1">
                Define who needs to sign and where. <span className="md:hidden text-warning">Desktop recommended.</span>
              </DialogDescription>
            </div>
            <Button 
              onClick={handleAIScan}
              disabled={isScanning || !pdfFile}
              variant="outline"
              size="sm"
              className="shrink-0 gap-2"
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">AI Scan</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* Main Area: PDF Viewer (Left/Center) */}
          <div className="flex-1 bg-muted/20 p-4 md:border-r relative flex flex-col min-w-0 min-h-[50vh] md:min-h-0">
            {effectivePdfUrl ? (
              <PdfViewerWithOverlay
                pdfUrl={effectivePdfUrl}
                detectedFields={detectedFields}
                customPlacements={customPlacements}
                selectedPlacementId={selectedPlacementId}
                onPlacementClick={(id) => {
                   setSelectedPlacementId(id);
                   setActiveTab("placements");
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
              />
            ) : (
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
            )}
             
             {viewerMode === 'add-signature' && (
               <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-xs md:text-sm font-medium animate-in fade-in slide-in-from-top-4 z-30">
                 Click on document to place signature box
                 <Button 
                   variant="ghost" 
                   size="sm" 
                   className="ml-2 h-6 text-primary-foreground hover:text-primary-foreground/80 hover:bg-primary-foreground/20"
                   onClick={() => setViewerMode('view')}
                 >
                   Cancel
                 </Button>
               </div>
             )}
          </div>
          
          {/* Sidebar: Configuration (Right) */}
          <div className="w-full md:w-87.5 lg:w-100 flex flex-col bg-background shrink-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full justify-start h-auto p-1 bg-muted/50 rounded-none border-b">
                <TabsTrigger 
                  value="signers" 
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs md:text-sm"
                >
                  Signers
                </TabsTrigger>
                <TabsTrigger 
                  value="fields" 
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs md:text-sm"
                >
                  Fields
                </TabsTrigger>
                <TabsTrigger 
                  value="placements" 
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs md:text-sm"
                >
                  Custom
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-hidden">
                <TabsContent value="signers" className="h-full m-0 p-4 overflow-auto">
                  <div className="text-xs md:text-sm text-muted-foreground mb-3 pb-3 border-b">
                     Define roles that must sign this waiver (e.g., Volunteer, Parent, Guardian).
                  </div>
                  <SignerRolesEditor
                    signers={signers}
                    onSignersChange={setSigners}
                  />
                </TabsContent>

                <TabsContent value="fields" className="h-full m-0 p-4 overflow-auto">
                   <div className="text-xs md:text-sm text-muted-foreground mb-3 pb-3 border-b">
                     {detectedFields.length > 0 
                       ? `Map ${detectedFields.length} detected PDF field${detectedFields.length !== 1 ? 's' : ''} to signer roles.`
                       : "No PDF fields detected. Use AI Scan or add custom fields."}
                  </div>
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
                </TabsContent>

                <TabsContent value="placements" className="h-full m-0 p-4 overflow-auto">
                   <div className="text-xs md:text-sm text-muted-foreground mb-3 pb-3 border-b">
                     {customPlacements.length > 0
                       ? `${customPlacements.length} custom signature box${customPlacements.length !== 1 ? 'es' : ''}. Drag to move, resize by handles.`
                       : "Add custom signature boxes that signers will fill in."}
                  </div>
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
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
