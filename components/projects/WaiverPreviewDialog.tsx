'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SignaturePayload,
  SignaturePreviewSummary,
  SignerData,
} from '@/types/waiver-definitions';
import { Loader2, Download, Printer } from 'lucide-react';
import { useState, useEffect } from 'react';

type PreviewableSigner = Pick<
  SignerData,
  'role_key' | 'method' | 'timestamp' | 'signer_name'
>;

// Define a compatible type for the signature
export interface WaiverPreviewSignature {
  id: string;
  created_at: string;
  signature_type: string;
  signer_name: string | null;
  signed_at: string | null;
  signature_payload: SignaturePayload | null;
  signature_summary?: SignaturePreviewSummary | null;
  // Legacy fields for backward compatibility/display
  signature_text?: string | null;
  signature_storage_path?: string | null;
  upload_storage_path?: string | null;
}

interface WaiverPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signature: WaiverPreviewSignature | null;
  onDownload: (signatureId: string) => void;
  onPrint?: (signatureId: string) => void;
  isDownloading?: boolean;
  isPrinting?: boolean;
}

export function WaiverPreviewDialog({
  open,
  onOpenChange,
  signature,
  onDownload,
  onPrint,
  isDownloading = false,
  isPrinting = false
}: WaiverPreviewDialogProps) {
  const [iframeLoading, setIframeLoading] = useState(true);

  // Reset iframe loading state when dialog opens or signature changes
  useEffect(() => {
    setIframeLoading(true);
  }, [open, signature?.id]);

  if (!signature) return null;

  const payload = signature.signature_payload;
  const signers: PreviewableSigner[] | null =
    signature.signature_summary?.signers ?? payload?.signers ?? null;

  // Determine standard signer display for legacy or overview
  const mainSignerName = signature.signer_name || 'Volunteer';
  const mainSignedAt = signature.signed_at 
    ? new Date(signature.signed_at).toLocaleString() 
    : new Date(signature.created_at).toLocaleString();

  // Handle print action
  const handlePrint = () => {
    if (onPrint) {
      onPrint(signature.id);
    } else {
      // Fallback: Open preview URL in new window for printing with security attributes
      window.open(`/api/waivers/${signature.id}/preview`, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Signed Waiver</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
          {/* Signer Details Section */}
          <div className="border rounded-lg p-4 bg-muted/20">
            <h3 className="font-semibold mb-3 text-sm">Signer Details</h3>
            
            {signers ? (
              <div className="space-y-2">
                {signers.map((signer, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{signer.signer_name || 'Unnamed'}</span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {signer.role_key.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {signer.method}
                      </Badge>
                      <span>{new Date(signer.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Legacy display
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{mainSignerName}</span>
                  <Badge variant="outline">Signer</Badge>
                </div>
                <div className="text-muted-foreground flex items-center gap-2">
                   <Badge variant="secondary" className="text-[10px] uppercase">
                    {signature.signature_type}
                  </Badge>
                  <span>{mainSignedAt}</span>
                </div>
              </div>
            )}
            
            {/* Show typed signature text if applicable (legacy) */}
            {signature.signature_type === 'typed' && signature.signature_text && (
               <div className="mt-2 text-sm text-muted-foreground bg-background p-2 rounded border">
                 Signature Text: <span className="font-mono">{signature.signature_text}</span>
               </div>
            )}
          </div>
          
          {/* PDF Preview Section */}
          <div className="border rounded-lg overflow-hidden relative bg-muted/10 h-125">
            {/* We will rely on download for now if preview endpoint isn't ready, 
                but ideally we have a preview endpoint. 
                Using the download endpoint for preview might force download on some browsers if Content-Disposition is attachment.
                The prompt suggests an optional Preview API endpoint. 
                For now, let's use the object tag with the legacy URL or new endpoint.
            */}
             
            {iframeLoading && (
               <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                 <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
               </div>
            )}
            
            {/* 
              We need a URL for the iframe. 
              The SignupsClient currently uses `getWaiverDownloadUrl` action which returns a signed URL.
              Ideally, we should refactor to use a route handler that serves the content.
              For this component, we can accept a previewUrl prop, OR construct one if we have the ID.
              Given the instructions, we should implement the Preview API endpoint.
            */}
            <iframe
              src={`/api/waivers/${signature.id}/preview`}
              className="w-full h-full"
              title="Waiver Preview"
              onLoad={() => setIframeLoading(false)}
              onError={() => setIframeLoading(false)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 pt-0 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button 
            variant="outline"
            onClick={handlePrint}
            disabled={isPrinting || iframeLoading}
          >
            {isPrinting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Printing...
              </>
            ) : (
              <>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </>
            )}
          </Button>
          <Button 
            onClick={() => onDownload(signature.id)}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
