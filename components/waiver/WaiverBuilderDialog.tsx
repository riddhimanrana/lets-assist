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
import { WaiverDefinitionFull, WaiverFieldType } from "@/types/waiver-definitions";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Separator } from "@/components/ui/separator";

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
  const isMobile = useMediaQuery("(max-width: 640px)");
  
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
                   pdfFieldName: f.pdf_field_name
                 };
              } else if (f.source === 'custom_overlay' && f.signer_role_key) {
                 custom.push({
                   id: f.field_key,
                   label: f.label,
                   signerRoleKey: f.signer_role_key,
                   fieldType: f.field_type,
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
          pdfFieldName: field.fieldName
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

    const newPlacement: CustomPlacement = {
      id: `custom_${Date.now()}`,
      label: "Signature",
      signerRoleKey: defaultSigner,
      fieldType: 'signature',
      required: true,
      pageIndex: placement.pageIndex,
      rect: placement.rect
    };
    
    setCustomPlacements([...customPlacements, newPlacement]);
    setViewerMode('view'); // Exit add mode
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
      }, index: number) => ({
        id: `ai_${Date.now()}_${index}`,
        label: field.label,
        signerRoleKey: field.signerRole,
        fieldType: (['signature', 'name', 'date', 'email', 'phone', 'address', 'text', 'checkbox', 'radio', 'dropdown', 'initial'].includes(field.fieldType) 
          ? field.fieldType 
          : 'text') as WaiverFieldType,
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
      setActiveTab("fields");

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

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Waiver Builder</DialogTitle>
            <DialogDescription>
              For the best experience, please use a desktop or tablet device to configure waivers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">
              The waiver builder requires a larger screen for proper PDF viewing, field mapping, and signature placement.
            </p>
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div>
    <Dialog open={open} onOpenChange={(val) => !isSaving && !isScanning && onOpenChange(val)}>
      <DialogContent className="max-w-[98vw] md:max-w-[95vw] lg:max-w-7xl h-[95vh] md:h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 md:px-6 py-3 border-b shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg md:text-xl">Configure Waiver</DialogTitle>
              <DialogDescription className="text-xs md:text-sm mt-1">
                Define who needs to sign and where.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
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
                   setActiveTab("fields"); // Switch to fields tab
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
          <div className="w-full md:w-87.5 lg:w-100 flex flex-col bg-background shrink-0 border-t md:border-t-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full justify-start h-auto p-1 bg-muted/50 rounded-none border-b">
                <TabsTrigger 
                  value="signers" 
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs md:text-sm py-2"
                >
                  1. Signers
                </TabsTrigger>
                <TabsTrigger 
                  value="fields" 
                  className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs md:text-sm py-2"
                >
                  2. Fields & Signatures
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
                  <div className="mt-6 pt-4 border-t">
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
                   <div className="p-4 space-y-6">
                      
                      {/* Section 1: Detected Fields */}
                      <div>
                        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">Detected PDF Fields
                           <span className="text-xs font-normal text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">
                              {detectedFields.length}
                           </span>
                        </h3>
                        <p className="text-xs text-muted-foreground mb-4">
                          These are interactive form fields detected in your PDF. Map signature fields to roles.
                        </p>
                        
                        {detectedFields.length > 0 ? (
                          <div className="border rounded-md max-h-75 overflow-auto">
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
                             No PDF form fields detected. <br/>
                             Use "Custom Signatures" below.
                          </div>
                        )}
                      </div>
                      
                      <Separator />
                      
                      {/* Section 2: Custom Placements */}
                      <div>
                        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">Custom Signature Placements
                           <span className="text-xs font-normal text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">
                              {customPlacements.length}
                           </span>
                        </h3>
                        <p className="text-xs text-muted-foreground mb-4">
                          Draw custom signature boxes where signers should sign.
                        </p>
                        
                        <div className="border rounded-md max-h-100 overflow-auto p-2">
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
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-background shrink-0 flex flex-row items-center justify-between gap-3">
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
    </div>
  );
}
