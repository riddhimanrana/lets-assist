"use client";

import { useState, useMemo, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogPortal,
  DialogOverlay
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SignerData, SignaturePayload, WaiverDefinitionSigner, WaiverDefinitionFull, WaiverDefinitionField } from "@/types/waiver-definitions";
import { WaiverTemplate, WaiverSignatureInput } from "@/types/waiver";
import { SignatureCapture } from "./SignatureCapture";
import { WaiverSigningPdfPane } from "./WaiverSigningPdfPane";
import { PdfViewerWithOverlay, CustomPlacement } from "./PdfViewerWithOverlay";
import { WaiverFieldForm } from "./WaiverFieldForm";
import { WaiverConsentStep } from "./WaiverConsentStep";
import { cn } from "@/lib/utils";
import { Loader2, ArrowLeft, ArrowRight, CheckCircle, Upload, PenTool, ExternalLink } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface WaiverSigningDialogProps {
  isOpen: boolean;
  onClose: (open: boolean) => void;
  waiverDefinition?: WaiverDefinitionFull | null;
  waiverPdfUrl?: string | null;
  waiverTemplate?: WaiverTemplate | null;
  onComplete: (payload: WaiverSignatureInput) => Promise<void>;
  defaultSignerName?: string;
  defaultSignerEmail?: string;
  allowUpload?: boolean; // Print/upload backup enabled
  disableEsignature?: boolean; // Print/upload only mode
}

type StepType = 'review' | 'fields' | 'sign' | 'confirm';

interface WizardStep {
  id: string;
  type: StepType;
  title: string;
  description?: string;
  signer?: WaiverDefinitionSigner;
  isLast?: boolean;
}

export function WaiverSigningDialog({
  isOpen,
  onClose,
  waiverDefinition,
  waiverPdfUrl,
  waiverTemplate,
  onComplete,
  defaultSignerName,
  defaultSignerEmail,
  allowUpload = true,
  disableEsignature = false
}: WaiverSigningDialogProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [consented, setConsented] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean | number>>({});
  const [signatures, setSignatures] = useState<Record<string, SignerData>>({});
  const [skippedSigners, setSkippedSigners] = useState<Set<string>>(new Set());
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
      setConsented(false);
      setFieldValues({});
      setSignatures({});
      setSkippedSigners(new Set());
      setSelectedFieldKey(null);
    }
  }, [isOpen]);

  // Construct effective definition (Legacy support)
  const effectiveDefinition = useMemo(() => {
    if (waiverDefinition) return waiverDefinition;

    // Fallback for legacy waivers
    const dummySigner: WaiverDefinitionSigner = {
      id: "legacy-signer",
      waiver_definition_id: "legacy",
      role_key: "volunteer",
      label: "Volunteer",
      required: true,
      order_index: 0,
      rules: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return {
      id: "legacy",
      scope: "project",
      project_id: null,
      title: "Waiver",
      version: 1,
      active: true,
      pdf_storage_path: null,
      pdf_public_url: waiverPdfUrl || null,
      source: "project_pdf",
      created_by: null,
      created_at: "",
      updated_at: "",
      signers: [dummySigner],
      fields: []
    } as WaiverDefinitionFull;
  }, [waiverDefinition, waiverPdfUrl]);

  // Sort signers ensure correct order
  const sortedSigners = useMemo(() => {
     if (effectiveDefinition.signers.length > 0) {
        return [...effectiveDefinition.signers].sort((a, b) => a.order_index - b.order_index);
     }
     // Legacy check: if no signers defined but we have legacy mode, create one
     return [{
        id: "legacy-signer",
        waiver_definition_id: "legacy",
        role_key: "volunteer",
        label: "Volunteer",
        required: true,
        order_index: 0,
        rules: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
     }];
  }, [effectiveDefinition.signers]);

  // Build Wizard Steps
  const steps = useMemo<WizardStep[]>(() => {
    const s: WizardStep[] = [];

    // Step 1: Review/Consent
    s.push({
      id: 'review',
      type: 'review',
      title: 'Review Waiver',
      description: 'Please review the waiver document.'
    });

    // Global/Common Fields (fields with no signer_role_key)
    const globalFields = effectiveDefinition.fields.filter(
      (f) => f.field_type !== 'signature' && !f.signer_role_key
    );

    if (globalFields.length > 0) {
      s.push({
        id: 'global-fields',
        type: 'fields',
        title: 'Your Information',
        description: 'Please provide your details.',
        // No signer attached
      });
    }

    // Per-signer steps
    sortedSigners.forEach((signer) => {
      // Check if this signer has any fields
      const signerFields = effectiveDefinition.fields.filter(f => 
        f.signer_role_key === signer.role_key && f.field_type !== 'signature'
      );

      if (signerFields.length > 0) {
        s.push({
          id: `fields-${signer.role_key}`,
          type: 'fields',
          title: `${signer.label} Information`,
          description: `Please fill in the required fields for ${signer.label}.`,
          signer: signer
        });
      }

      s.push({
        id: `sign-${signer.role_key}`,
        type: 'sign',
        title: `Sign as ${signer.label}`,
        description: `Please provide your signature for ${signer.label}.`,
        signer: signer
      });
    });

    if (s.length > 0) {
        s[s.length - 1].isLast = true;
    }

    return s;
  }, [effectiveDefinition, sortedSigners]);

  const currentStep = steps[currentStepIndex];

  // Filter signature fields for current signer (for tap-to-place overlays)
  const currentSignerFields = useMemo(() => {
    if (currentStep?.type !== 'sign' || !currentStep.signer) return [];
    return effectiveDefinition.fields.filter(
      f => f.field_type === 'signature' && f.signer_role_key === currentStep.signer?.role_key
    );
  }, [currentStep, effectiveDefinition.fields]);

  // Convert definition fields to CustomPlacement format for overlay
  const customPlacements = useMemo<CustomPlacement[]>(() => {
    return currentSignerFields.map(field => ({
      id: field.id,
      label: field.label,
      signerRoleKey: field.signer_role_key || 'volunteer',
      fieldType: field.field_type,
      required: field.required,
      pageIndex: field.page_index,
      rect: field.rect
    }));
  }, [currentSignerFields]);

  // Logic to determine if current step is valid
  const isStepValid = useMemo(() => {
    if (!currentStep) return false;

    if (currentStep.type === 'review') {
      return consented;
    }

    if (currentStep.type === 'fields') {
        let stepFields: WaiverDefinitionField[] = [];
        if (currentStep.signer) {
           stepFields = effectiveDefinition.fields.filter(f => 
              f.signer_role_key === currentStep.signer?.role_key && 
              f.field_type !== 'signature'
           );
        } else if (currentStep.id === 'global-fields') {
           stepFields = effectiveDefinition.fields.filter(f => 
              !f.signer_role_key && 
              f.field_type !== 'signature'
           );
        }

        const required = stepFields.filter(f => f.required);
        
        // Check if all required fields have values
        return required.every(f => {
            const val = fieldValues[f.field_key];
            // For checkboxes, must be explicitly true
            if (f.field_type === 'checkbox') {
               return val === true;
            }
            return val !== undefined && val !== "" && val !== null;
        });
    }

    if (currentStep.type === 'sign' && currentStep.signer) {
         // Optional signers can be skipped (valid without signature)
         if (!currentStep.signer.required) {
           return true;
         }
         return !!signatures[currentStep.signer.role_key];
    }

    return true;
  }, [currentStep, consented, fieldValues, signatures, effectiveDefinition.fields]);


  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    }
  };

  const handleSkipOptionalSigner = () => {
    if (currentStep?.type === 'sign' && currentStep.signer && !currentStep.signer.required) {
      setSkippedSigners(prev => new Set(prev).add(currentStep.signer!.role_key));
      handleNext();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  const handleSignatureComplete = (roleKey: string, sig: SignerData | null) => {
    setSignatures(prev => {
      const next = { ...prev };
      if (sig) {
        next[roleKey] = sig;
      } else {
        delete next[roleKey];
      }
      return next;
    });
  };

  const handleFieldChange = (key: string, value: string | boolean | number) => {
      setFieldValues(prev => ({
          ...prev,
          [key]: value
      }));
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      
      // Filter out skipped signers from payload
      const activeSigners = Object.values(signatures).filter(
        sig => !skippedSigners.has(sig.role_key)
      );
      
      const payload: SignaturePayload = {
        signers: activeSigners,
        fields: fieldValues as unknown as Record<string, string | boolean | string[]>,
      };

      // Convert to WaiverSignatureInput
      const input: WaiverSignatureInput = {
        templateId: waiverTemplate?.id || "project-pdf",
        definitionId: waiverDefinition?.id,
        signatureType: "multi-signer",
        payload: payload,
        signerName: defaultSignerName,
        signerEmail: defaultSignerEmail,
        waiverPdfUrl: waiverPdfUrl || undefined
      };

      await onComplete(input);
      onClose(false);
      toast.success('Waiver signed successfully!');
    } catch (error) {
      console.error("Submission failed", error);
      toast.error('Failed to sign waiver', {
        description: error instanceof Error ? error.message : 'Please try again.',
        action: {
          label: 'Retry',
          onClick: () => handleSubmit(),
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleDownload = () => {
      if (!waiverPdfUrl) return;
      const link = document.createElement('a');
      link.href = waiverPdfUrl;
      link.download = `waiver-document.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handlePrint = () => {
      if (!waiverPdfUrl) return;
      window.open(waiverPdfUrl, '_blank');
  };

  // Offline Upload Handling (Phase 4 Requirement)
  // This essentially bypasses the wizard and uploads a file
  const handleOfflineUpload = () => {
      // Create a hidden file input and click it
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf,image/*';
      input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          // Convert to base64 data url for submission
          const reader = new FileReader();
          reader.onload = async (item) => {
             const dataUrl = item.target?.result as string;
             
             setIsSubmitting(true);
             try {
                // This is SINGLE-SIGNATURE offline upload mode
                // Not multi-signer! Use WaiverSignatureInput format
                const uploadInput: WaiverSignatureInput = {
                  templateId: waiverTemplate?.id || "project-pdf",
                  definitionId: waiverDefinition?.id,
                  signatureType: 'upload', // Single upload type
                  uploadFileDataUrl: dataUrl,
                  uploadFileName: file.name,
                  uploadFileType: file.type,
                  waiverPdfUrl: waiverPdfUrl || undefined,
                  signerName: defaultSignerName,
                  signerEmail: defaultSignerEmail,
                };
                
                await onComplete(uploadInput);
                onClose(false);
                toast.success('Waiver uploaded successfully!');
             } catch (err) {
                 console.error("Upload failed", err);
                 toast.error('Failed to upload waiver', {
                   description: 'Please check your file and try again.',
                 });
             } finally {
                 setIsSubmitting(false);
             }
          };
          reader.readAsDataURL(file);
      };
      input.click();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(val) => !isSubmitting && onClose(val)} modal={true}>
      <DialogPortal>
        <DialogOverlay className="z-9998" />
        <DialogContent 
          data-testid="waiver-signer-dialog" 
          className="w-[95vw] max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] xl:max-w-[75vw] 2xl:max-w-7xl h-[90vh] sm:h-[85vh] p-0 gap-0 overflow-hidden flex flex-col fixed! top-[5vh]! left-1/2! -translate-x-1/2! translate-y-0! z-9999"
          showCloseButton={false}
        >
        {/* Loading Overlay During Submission */}
        {isSubmitting && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center">
            <div className="bg-background rounded-lg p-6 shadow-xl">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-sm font-medium">Adding your e-signature...</p>
            </div>
          </div>
        )}
        
        <DialogHeader className="p-4 border-b shrink-0 bg-background z-20">
            <div className="flex items-center justify-between">
                <div>
                    <DialogTitle>{effectiveDefinition?.title || "Review & Sign Waiver"}</DialogTitle>
                    <DialogDescription className="hidden sm:block">
                        {currentStep?.title}
                    </DialogDescription>
                </div>
                {/* Global Progress Indicator (Desktop) */}
                {isDesktop && (
                  <div className="text-sm text-muted-foreground mr-8">
                     Step {currentStepIndex + 1} of {steps.length}
                  </div>
                )}
            </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* PDF Panel - Left Side on Desktop */}
          <div className={cn(
             "flex-1 bg-muted/20 min-h-0 flex flex-col border-r h-full relative",
             !isDesktop && "hidden" // Hide completely on mobile, use step-based view instead
          )}>
               {/* On mobile, ONLY show this pane if step is review */}
             <div className={cn(
                 "absolute inset-0 z-10 bg-background lg:static lg:bg-transparent lg:h-full lg:w-full",
                 !isDesktop && currentStep?.type !== 'review' && "hidden"
             )}>
                 {waiverPdfUrl ? (
                   /* Use PdfViewerWithOverlay for signature steps with field overlays */
                   currentStep?.type === 'sign' && customPlacements.length > 0 ? (
                     <PdfViewerWithOverlay
                        pdfUrl={waiverPdfUrl}
                        detectedFields={[]}
                        customPlacements={customPlacements}
                        selectedPlacementId={selectedFieldKey || undefined}
                        onPlacementClick={(placementId) => {
                          setSelectedFieldKey(placementId);
                          // Open signature capture for this field
                          // For now, we'll just highlight it. Full integration would show a modal.
                        }}
                        onDetectedFieldClick={undefined}
                        onAddPlacement={() => {}}
                        onPlacementResize={undefined}
                        mode="view"
                        highlightedField={null}
                     />
                   ) : (
                     <WaiverSigningPdfPane
                        pdfUrl={waiverPdfUrl}
                        onDownload={handleDownload}
                        onPrint={handlePrint}
                        className="h-full w-full border-none rounded-none"
                     />
                   )
                ) : (
                   <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground group">
                      <p>No PDF Document Available</p>
                      {allowUpload && (
                          <Button variant="outline" className="mt-4" onClick={handleOfflineUpload}>
                              <Upload className="mr-2 h-4 w-4" /> Upload Signed Copy Instead
                          </Button>
                      )}
                   </div>
                )}
             </div>
          </div>


          {/* Right Panel / Steps Container */}
          <div className={cn(
             "w-full lg:w-md xl:w-lg flex flex-col bg-background shrink-0 h-full overflow-hidden transition-all relative z-10",
             isDesktop ? "border-l shadow-sm" : "absolute inset-0" // Mobile: take full screen over PDF
          )}>
             {/* Mobile Header (since global header might be covered or we want context) */}
             {!isDesktop && (
                 <div className="bg-muted/10 p-2 text-center text-xs font-medium border-b flex justify-between px-4 items-center">
                    <span>Step {currentStepIndex + 1} of {steps.length}</span>
                    <span className="text-muted-foreground">{currentStep?.title}</span>
                 </div>
             )}

             <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
                {/* Step Content */}
                <div className="space-y-6">
                    {/* Review Consent Step */}
                    {currentStep?.type === 'review' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                           {isDesktop && (
                           <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 text-sm mb-4">
                                   Please review the waiver document on the left carefully.
                               </div>
                           )}
                           
                           {!isDesktop && waiverPdfUrl && (
                               // Mobile: Button to open PDF in new tab
                               <div className="mb-6">
                                   <Button 
                                       variant="outline" 
                                       className="w-full" 
                                       onClick={() => window.open(waiverPdfUrl, '_blank')}
                                   >
                                       <ExternalLink className="h-4 w-4 mr-2" />
                                       View Waiver Document (opens in new tab)
                                   </Button>
                               </div>
                           )}

                           <WaiverConsentStep 
                               consented={consented}
                               onConsent={setConsented}
                               waiverTitle={effectiveDefinition.title}
                           />
                           
                           {/* Choice between E-Sign and Print/Upload */}
                           {!disableEsignature && (
                               <div className="pt-6 mt-6 border-t">
                                   <h4 className="font-semibold text-sm mb-4">How would you like to sign?</h4>
                                   <div className="grid gap-3">
                                       <div className="p-4 border-2 border-primary rounded-lg bg-primary/5">
                                           <div className="flex items-start gap-3">
                                               <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                   <PenTool className="h-5 w-5 text-primary" />
                                               </div>
                                               <div className="flex-1">
                                                   <h5 className="font-medium text-sm mb-1">Sign Electronically (Recommended)</h5>
                                                   <p className="text-xs text-muted-foreground mb-3">
                                                       Complete your signature directly in your browser. Fast and secure.
                                                   </p>
                                                   <Button variant="default" size="sm" onClick={handleNext} disabled={!consented} className="w-full">
                                                       Continue to E-Sign
                                                   </Button>
                                               </div>
                                           </div>
                                       </div>
                                       
                                       {allowUpload && (
                                           <div className="p-4 border rounded-lg">
                                               <div className="flex items-start gap-3">
                                                   <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                                                       <Upload className="h-5 w-5 text-muted-foreground" />
                                                   </div>
                                                   <div className="flex-1">
                                                       <h5 className="font-medium text-sm mb-1">Print, Sign & Upload</h5>
                                                       <p className="text-xs text-muted-foreground mb-3">
                                                           Download the waiver, print it, sign manually, and upload a photo or scan.
                                                       </p>
                                                       <Button variant="outline" size="sm" onClick={handleOfflineUpload} className="w-full">
                                                           <Upload className="mr-2 h-4 w-4" /> Upload Signed Copy
                                                       </Button>
                                                   </div>
                                               </div>
                                           </div>
                                       )}
                                   </div>
                               </div>
                           )}
                           
                           {/* Print/Upload only mode */}
                           {disableEsignature && allowUpload && (
                               <div className="pt-8 mt-8 border-t">
                                   <div className="text-center">
                                       <p className="text-sm text-muted-foreground mb-3">This waiver requires a printed and signed copy.</p>
                                       <Button variant="default" size="sm" onClick={handleOfflineUpload} className="w-full">
                                            <Upload className="mr-2 h-4 w-4" /> Upload Signed Waiver
                                       </Button>
                                   </div>
                               </div>
                           )}
                        </div>
                    )}

                    {/* Fields Step */}
                    {currentStep?.type === 'fields' && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                            {currentStep.signer ? (
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">
                                        {sortedSigners.indexOf(currentStep.signer) + 1}
                                    </span>
                                    {currentStep.signer.label} Details
                                </h3>
                            ) : (
                                <h3 className="text-lg font-semibold mb-4">
                                    Your Information
                                </h3>
                            )}
                            <WaiverFieldForm
                                fields={
                                    currentStep.signer 
                                      ? effectiveDefinition.fields.filter(f => f.signer_role_key === currentStep.signer?.role_key)
                                      : effectiveDefinition.fields.filter(f => !f.signer_role_key)
                                }
                                values={fieldValues}
                                onChange={handleFieldChange}
                                signerRoleKey={currentStep.signer?.role_key} 
                                showErrors={false} // Could enable this on "next" attempt
                                className="pb-4"
                            />
                        </div>
                    )}

                    {/* Signature Step */}
                    {currentStep?.type === 'sign' && currentStep.signer && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                             {disableEsignature && (
                                <Alert className="mb-4 border-warning/40 bg-warning/10 text-warning">
                                  <AlertDescription className="text-sm">
                                    ⚠️ This waiver requires a printed, signed, and uploaded copy. E-signatures are not available.
                                  </AlertDescription>
                                </Alert>
                             )}
                             
                             <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">
                                    {sortedSigners.indexOf(currentStep.signer) + 1}
                                </span>
                                Sign as {currentStep.signer.label}
                            </h3>
                            
                            {disableEsignature ? (
                                <div className="space-y-4">
                                  <div className="p-6 border-2 border-dashed rounded-lg text-center">
                                    <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                                    <p className="text-sm font-medium mb-2">Print and Upload Required</p>
                                    <p className="text-xs text-muted-foreground mb-4">
                                      Please download the waiver, print it, sign it, and upload a scanned copy.
                                    </p>
                                    <div className="flex flex-col gap-2">
                                      <Button variant="outline" onClick={handleDownload}>
                                        Download Waiver PDF
                                      </Button>
                                      <Button onClick={handleOfflineUpload}>
                                        <Upload className="mr-2 h-4 w-4" /> Upload Signed Copy
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                            ) : (
                                <SignatureCapture 
                                    signerRole={currentStep.signer}
                                    onSignatureComplete={(sig) => handleSignatureComplete(currentStep.signer!.role_key, sig)}
                                    existingSignature={signatures[currentStep.signer.role_key]}
                                    userName={defaultSignerName}
                                    allowUpload={false} // Only draw/type allowed here. Full upload handled separately.
                                />
                            )}
                        </div>
                    )}
                </div>
             </div>

             {/* Footer Controls */}
             <div className="p-4 border-t bg-background shrink-0 flex items-center justify-between gap-4 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                {currentStep?.type === 'review' && !disableEsignature ? (
                  // Special footer for review step with choice - no nav buttons
                  <div className="w-full text-center text-xs text-muted-foreground">
                    Choose your signing method above to continue
                  </div>
                ) : (
                  <>
                    <Button 
                        variant="outline" 
                        onClick={handleBack} 
                        disabled={isSubmitting || currentStepIndex === 0}
                      data-testid="waiver-signer-back"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" /> Back
                    </Button>

                    <div className="flex gap-2">
                      {/* Skip button for optional signers */}
                      {currentStep?.type === 'sign' && currentStep.signer && !currentStep.signer.required && (
                        <Button 
                            variant="outline"
                            onClick={handleSkipOptionalSigner} 
                            disabled={isSubmitting}
                            className="shadow-sm"
                          data-testid="waiver-signer-skip-optional"
                        >
                            Skip (Optional)
                        </Button>
                      )}

                      {currentStep?.isLast ? (
                          <Button 
                              onClick={handleSubmit} 
                              disabled={!isStepValid || isSubmitting}
                              className="w-32 shadow-md"
                              variant="default" // Primary action
                              data-testid="waiver-signer-complete"
                          >
                              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                                  <>Complete <CheckCircle className="h-4 w-4 ml-2" /></>
                              )}
                          </Button>
                      ) : (
                          <Button 
                              onClick={handleNext} 
                              disabled={!isStepValid || (currentStep?.type === 'review' && !consented)}
                              className="shadow-sm"
                              data-testid="waiver-signer-next"
                          >
                              Next <ArrowRight className="h-4 w-4 ml-2" />
                          </Button>
                      )}
                    </div>
                  </>
                )}
             </div>
          </div>
        </div>
      </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
