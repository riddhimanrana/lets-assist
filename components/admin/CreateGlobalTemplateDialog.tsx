'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WaiverBuilderDialog } from '@/components/waiver/WaiverBuilderDialog';
import { usePdfFieldDetection } from '@/hooks/use-pdf-field-detection';
import { createGlobalWaiverTemplate } from '@/app/admin/waivers/actions';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';
import { DetectedPdfField } from '@/lib/waiver/pdf-field-detect';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateGlobalTemplateDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<'metadata' | 'builder'>('metadata');
  const [title, setTitle] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { detectFields, isDetecting } = usePdfFieldDetection();
  const [detectedFields, setDetectedFields] = useState<DetectedPdfField[]>([]);

  const handleNext = async () => {
    if (step === 'metadata' && title && pdfFile) {
      setIsProcessing(true);
      try {
        const result = await detectFields(pdfFile);
        if (result) {
          setDetectedFields(result.fields);
          setStep('builder');
        } else {
          // If detection fails or returns nothing, we can still proceed but with empty fields
          // Or show error. Let's proceed with empty.
           setDetectedFields([]);
           setStep('builder');
        }
      } catch (error) {
        console.error("Field detection error:", error);
        toast.error("Failed to process PDF fields, proceeding without detection.");
        setDetectedFields([]);
        setStep('builder');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleReset = () => {
    setStep('metadata');
    setTitle('');
    setPdfFile(null);
    setDetectedFields([]);
    setIsProcessing(false);
  };

  const handleSave = async (definition: any) => {
    if (!pdfFile) return;

    try {
      const formData = new FormData();
      formData.append('file', pdfFile);

      // We need to pass the builder definition which contains signers and field mappings
      const result = await createGlobalWaiverTemplate(title, formData, definition);

      if (result.success) {
        toast.success("Global waiver template created successfully!");
        onOpenChange(false);
        handleReset();
        window.location.reload();
      } else {
        toast.error(result.error || "Failed to create template");
      }
    } catch (error) {
      console.error("Create template error:", error);
      toast.error("An unexpected error occurred");
    }
  };

  // If dialog is closed, reset state after a delay or immediately?
  // Better to reset when opening again or checking open prop.
  if (!open && step !== 'metadata') {
      // Don't reset immediately to avoid flicker if user accidentally closes? 
      // Actually standard behavior is reset on open or close.
      // Let's reset on next open if needed, but for now just leave it.
  }

  return (
    <>
      <Dialog open={open && step === 'metadata'} onOpenChange={(val) => {
          if (!val) handleReset(); // Reset on close
          onOpenChange(val);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Global Waiver Template</DialogTitle>
             <DialogDescription>
                Upload a PDF to start creating a new organization-wide waiver.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Template Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Standard Volunteer Waiver 2026"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="pdf">Upload PDF Template</Label>
              <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-muted/50 transition-colors relative">
                 <Input
                    id="pdf"
                    type="file"
                    accept=".pdf"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                  />
                  <div className="flex flex-col items-center gap-2 pointer-events-none">
                      <div className="p-2 bg-primary/10 rounded-full">
                          <Upload className="h-6 w-6 text-primary" />
                      </div>
                      <div className="text-sm font-medium">
                          {pdfFile ? pdfFile.name : "Click to upload or drag and drop"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                          PDF files only (max 10MB)
                      </div>
                  </div>
              </div>
            </div>
            
            <div className="flex justify-end pt-4">
                <Button onClick={handleNext} disabled={!title || !pdfFile || isProcessing || isDetecting}>
                {(isProcessing || isDetecting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Next: Configure Fields
                </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Builder Dialog */}
      {step === 'builder' && (
        <WaiverBuilderDialog
          open={open}
          onOpenChange={(val) => {
              if (!val) handleReset();
              onOpenChange(val);
          }}
          pdfFile={pdfFile}
          pdfUrl={pdfFile ? URL.createObjectURL(pdfFile) : null}
          detectedFields={detectedFields}
          onSave={async (definition) => {
            await handleSave(definition);
          }}
        />
      )}
    </>
  );
}
