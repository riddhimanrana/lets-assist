"use client";

import { useState, useMemo } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SignerData, SignaturePayload, WaiverDefinitionSigner, WaiverDefinitionFull } from "@/types/waiver-definitions";
import { WaiverTemplate, WaiverSignatureInput } from "@/types/waiver";
import { SignatureCapture } from "./SignatureCapture";
import { WaiverReviewPanel } from "./WaiverReviewPanel";
import { SigningProgressTracker } from "./SigningProgressTracker";
import { cn } from "@/lib/utils";
import { Loader2, ArrowLeft, ArrowRight, CheckCircle } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";

interface WaiverSigningDialogProps {
  isOpen: boolean;
  onClose: (open: boolean) => void;
  waiverDefinition?: WaiverDefinitionFull | null;
  waiverPdfUrl?: string | null;
  waiverTemplate?: WaiverTemplate | null;
  onComplete: (payload: WaiverSignatureInput) => Promise<void>;
  defaultSignerName?: string;
  defaultSignerEmail?: string;
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
}: WaiverSigningDialogProps) {
  const [step, setStep] = useState<"review" | string>("review"); // 'review' or role_key
  const [reviewed, setReviewed] = useState(false);
  const [signatures, setSignatures] = useState<Record<string, SignerData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

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
  const sortedSigners = useMemo(() => 
    [...effectiveDefinition.signers].sort((a, b) => a.order_index - b.order_index),
  [effectiveDefinition.signers]);

  const currentSignerIndex = sortedSigners.findIndex(s => s.role_key === step);
  const currentSigner = sortedSigners[currentSignerIndex];
  
  // Calculate progress
  const completedSignerKeys = Object.keys(signatures);
  const allRequiredSigned = sortedSigners
    .filter(s => s.required)
    .every(s => signatures[s.role_key]);
  
  // Check if current signer is ready (review done)
  // If no PDF url, skip review?
  const isReviewRequired = !!waiverPdfUrl;
  const reviewStepComplete = !isReviewRequired || reviewed;

  const handleNext = () => {
    if (step === "review") {
      if (sortedSigners.length > 0) {
        setStep(sortedSigners[0].role_key);
      }
    } else {
      const nextIndex = currentSignerIndex + 1;
      if (nextIndex < sortedSigners.length) {
        setStep(sortedSigners[nextIndex].role_key);
      }
    }
  };

  const handleBack = () => {
    if (currentSignerIndex === 0) {
      if (isReviewRequired) setStep("review");
    } else if (currentSignerIndex > 0) {
      setStep(sortedSigners[currentSignerIndex - 1].role_key);
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

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      
      const payload: SignaturePayload = {
        signers: Object.values(signatures),
        // TODO(Phase 4): Collect non-signature fields from UI
        // Currently submits empty fields; Phase 3 added server-side stamping capability
        // Phase 4 will wire up the UI to populate this with user-entered field values
        fields: {},
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
      // Don't close here, parent handles it via success? Or close.
      // onComplete is promise, so after await.
      onClose(false);
    } catch (error) {
      console.error("Submission failed", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    if (step === "review") return reviewStepComplete;
    
    // Check if current signer is valid
    const sig = signatures[step];
    if (currentSigner?.required && !sig) return false;
    
    return true;
  };

  const isLastStep = step !== "review" && currentSignerIndex === sortedSigners.length - 1;

  // Initialize step if no review required
  // Use effect to skip review if needed?
  // Or just render correctly.
  
  return (
    <Dialog open={isOpen} onOpenChange={(val) => !isSubmitting && onClose(val)}>
      <DialogContent className="max-w-6xl w-full h-[95vh] sm:h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-4 border-b shrink-0">
          <DialogTitle>Review & Sign Waiver</DialogTitle>
          <DialogDescription className="hidden sm:block">
            {step === "review" ? "Please review the waiver document." : `Signing as: ${currentSigner?.label}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* PDF Panel */}
          <div className={cn(
             "flex-1 bg-muted/20 min-h-0 flex flex-col border-r h-full",
             !isDesktop && step !== "review" && "hidden"
          )}>
             <div className="flex-1 min-h-0 relative p-4 flex flex-col items-center justify-center">
                {waiverPdfUrl ? (
                   <WaiverReviewPanel 
                      pdfUrl={waiverPdfUrl}
                      reviewed={reviewed}
                      onReviewComplete={setReviewed}
                      className="h-full w-full"
                   />
                ) : (
                   <div className="text-muted-foreground p-8 text-center">
                      <p>No PDF Review Available</p>
                      {!waiverDefinition && <p className="text-xs">Using legacy waiver template.</p>}
                   </div>
                )}
             </div>
          </div>

          {/* Right Panel / Steps */}
          <div className={cn(
             "w-full lg:w-[450px] xl:w-[500px] flex flex-col bg-background shrink-0 h-full overflow-hidden",
             !isDesktop && step === "review" && "hidden" // Hide on mobile during review if we want review to be full screen
             // Wait, if mobile review, PDF is full screen (left panel). So this right panel should be hidden?
             // But the "buttons" are in footer inside this right panel structure?
             // Let's adjust structure. The footer should be global or responsive.
          )}>
            {/* On mobile, if step is Review, we want the footer controls visible. 
                My structure puts footer inside "Right Panel". 
                I should move footer out or ensure Right Panel is visible but EMPTY in body during review on mobile?
                Actually, simpler: split body and footer.
            */}
            
             <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
                {step === "review" && isDesktop && (
                    <div className="space-y-6">
                        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-200">
                            Please review the waiver document on the left.
                        </div>
                        <SigningProgressTracker 
                           signers={sortedSigners}
                           completedSigners={completedSignerKeys}
                           currentSigner={undefined}
                        />
                    </div>
                )}
                
                {step !== "review" && currentSigner && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                        <SigningProgressTracker 
                           signers={sortedSigners}
                           completedSigners={completedSignerKeys}
                           currentSigner={currentSigner.role_key}
                        />
                        
                        <div className="pt-4 border-t">
                            {/* Phase 1: Multi-signer mode restricts uploads to signature images only */}
                            {/* Offline full-waiver upload will be added in Phase 4 */}
                            <SignatureCapture 
                                signerRole={currentSigner}
                                onSignatureComplete={(sig) => handleSignatureComplete(currentSigner.role_key, sig)}
                                existingSignature={signatures[currentSigner.role_key]}
                                userName={defaultSignerName}
                                allowUpload={false}
                            />
                        </div>
                    </div>
                )}
             </div>

             {/* Footer Controls */}
             <div className="p-4 border-t bg-background shrink-0 flex items-center justify-between gap-4">
                {step !== "review" ? (
                    <Button variant="outline" onClick={handleBack} disabled={isSubmitting}>
                        <ArrowLeft className="h-4 w-4 mr-2" /> Back
                    </Button>
                ) : (
                    <div /> // Spacer
                )}

                {isLastStep && step !== "review" ? (
                    <Button 
                        onClick={handleSubmit} 
                        disabled={!canProceed() || isSubmitting || !allRequiredSigned}
                        className="w-32"
                    >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                            <>Complete <CheckCircle className="h-4 w-4 ml-2" /></>
                        )}
                    </Button>
                ) : (
                    <Button onClick={handleNext} disabled={!canProceed()}>
                        Next <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                )}
             </div>
          </div>
          
           {/* Mobile Footer Overlay for Review Step */}
          {!isDesktop && step === "review" && (
             <div className="lg:hidden absolute bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t flex flex-col gap-3">
                 <div className="flex items-center gap-2">
                     <input 
                        type="checkbox" 
                        id="mobile-reviewed" 
                        checked={reviewed} 
                        onChange={(e) => setReviewed(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                     />
                     <label htmlFor="mobile-reviewed" className="text-sm font-medium">
                         I have reviewed the waiver
                     </label>
                 </div>
                 <Button className="w-full" disabled={isReviewRequired && !reviewed} onClick={handleNext}>
                     Continue to Sign <ArrowRight className="h-4 w-4 ml-2" />
                 </Button>
             </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
