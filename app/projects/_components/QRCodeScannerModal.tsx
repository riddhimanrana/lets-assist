"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
// Import Scanner, TrackFunction and necessary types
import { Scanner, TrackFunction, IDetectedBarcode, boundingBox } from "@yudiel/react-qr-scanner";
import { toast } from "sonner";
import { AlertCircle, ScanLine } from "lucide-react";

interface QRCodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  expectedScheduleId: string | null; // The schedule ID we expect to scan for
}

export function QRCodeScannerModal({
  isOpen,
  onClose,
  projectId,
  expectedScheduleId,
}: QRCodeScannerModalProps) {
  const router = useRouter();
  const [scanError, setScanError] = useState<string | null>(null);

  // Updated handler for onScan prop
  const handleScan = (detectedCodes: IDetectedBarcode[]) => {
    if (detectedCodes && detectedCodes.length > 0) {
      const result = detectedCodes[0].rawValue;
      console.log("QR Scanned:", result);
      setScanError(null);

      if (result.includes(projectId)) {
        toast.success("QR Code Valid! Redirecting...");
        onClose();
        router.push(result);
      } else {
        const errorMessage = `Invalid QR code for project ${projectId}`;
        setScanError(errorMessage);
        toast.error(errorMessage, { duration: 5000 });
      }
    }
  };

  const handleError = (error: unknown) => {
    console.error("QR Scanner Error:", error);
    let friendlyMessage = "Could not start camera. ";

    // Check if the error is an instance of Error to safely access properties
    if (error instanceof Error) {
      if (error.name === "NotAllowedError") {
        friendlyMessage += "Please grant camera permission in your browser settings.";
      } else if (error.name === "NotFoundError") {
        friendlyMessage += "No camera found. Ensure a camera is connected and enabled.";
      } else {
        friendlyMessage += `An unexpected error occurred: ${error.message}. Please ensure your browser supports camera access.`;
      }
    } else {
      // Handle cases where the error might not be an Error object
      friendlyMessage += "An unknown error occurred. Please ensure your browser supports camera access and permissions are granted.";
      console.error("Received non-Error object:", error);
    }

    setScanError(friendlyMessage);
    toast.error(friendlyMessage, { duration: 5000 });
  };

  // Close handler ensures error is cleared when manually closing
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setScanError(null);
      onClose();
    }
  };
  

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Scan Check-in QR Code
          </DialogTitle>
          <DialogDescription>
            Point your camera at the QR code provided by the organizer for session check-in.
          </DialogDescription>
        </DialogHeader>
        <div className="p-6 pt-2 relative">
          {/* Error Display */}
          {scanError && (
            <div
              role="alert"
              className="absolute top-8 left-6 right-6 z-10 bg-destructive/90 text-destructive-foreground p-3 rounded-md text-sm flex items-center gap-2 shadow-lg"
            >
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          {/* Scanner Component with corrected props */}
          <div className="overflow-hidden rounded-lg border relative aspect-square max-h-[400px] mx-auto w-full">
            {isOpen && (
              <Scanner
                onScan={handleScan}
                onError={handleError}
                constraints={{ facingMode: "environment" }}
                scanDelay={500}
                formats={["qr_code"]}
                // Add the track prop here
                components={{
                  tracker: boundingBox,
                }}
                styles={{
                  container: { width: "100%", height: "100%", paddingTop: "0" },
                  video: { width: "100%", height: "100%", objectFit: "cover" },
                }}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            Ensure the QR code is well-lit and centered.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
