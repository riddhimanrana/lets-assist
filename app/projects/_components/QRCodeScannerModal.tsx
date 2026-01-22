"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
// Import Scanner and necessary types
import { Scanner, IDetectedBarcode, boundingBox } from "@yudiel/react-qr-scanner";
import { toast } from "sonner";
import { AlertCircle, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  expectedScheduleId: _expectedScheduleId,
}: QRCodeScannerModalProps) {
  const router = useRouter();
  const [scanError, setScanError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Sound synthesizer for a "modern" beep
  const playScanSound = useCallback(() => {
    try {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioCtx = new AudioContextConstructor();
      
      const playTone = (freq: number, startTime: number, duration: number, volume: number) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, startTime);
        g.gain.setValueAtTime(volume, startTime);
        g.gain.exponentialRampToValueAtTime(0.00001, startTime + duration);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      // A simple, modern double-beep (bright and clean)
      playTone(880, audioCtx.currentTime, 0.1, 0.1); // A5
      playTone(1318.51, audioCtx.currentTime + 0.07, 0.15, 0.1); // E6
    } catch (err) {
      console.warn("Audio feedback failed:", err);
    }
  }, []);

  // Updated handler for onScan prop
  const handleScan = (detectedCodes: IDetectedBarcode[]) => {
    if (detectedCodes && detectedCodes.length > 0 && !isPaused) {
      const result = detectedCodes[0].rawValue;
      console.log("QR Scanned:", result);
      setScanError(null);

      if (result.includes(projectId)) {
        setIsPaused(true); // Pause to prevent multiple scans
        playScanSound();
        toast.success("QR Code Valid! Redirecting...");
        onClose();
        router.push(result);
      } else {
        const errorMessage = `Invalid QR code for this project`;
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
      setIsPaused(false);
      onClose();
    }
  };
  

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[450px] w-[92vw] md:w-full p-0 overflow-hidden rounded-[2rem] sm:rounded-3xl border-none shadow-2xl">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <ScanLine className="h-6 w-6 text-primary" /> Scan Check-in QR Code
          </DialogTitle>
          <DialogDescription className="text-sm">
            Point your camera at the QR code for session check-in.
          </DialogDescription>
        </DialogHeader>
        <div className="p-5 sm:p-8 pt-4 relative">
          {/* Error Display */}
          {scanError && (
            <div
              role="alert"
              className="absolute top-6 left-6 right-6 z-20 bg-destructive/95 text-destructive-foreground p-4 rounded-2xl text-sm flex items-center gap-3 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-4"
            >
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          {/* Scanner Component with corrected props */}
          <div className="overflow-hidden rounded-[2rem] border-4 border-muted/50 relative aspect-square max-h-[340px] mx-auto w-full group shadow-inner bg-black/5">
            {isOpen && (
              <Scanner
                onScan={handleScan}
                onError={handleError}
                constraints={{ facingMode: "environment" }}
                scanDelay={500}
                formats={["qr_code"]}
                paused={isPaused}
                sound={false}
                components={{
                  tracker: boundingBox,
                  torch: true,
                }}
                styles={{
                  container: { width: "100%", height: "100%", paddingTop: "0" },
                  video: { width: "100%", height: "100%", objectFit: "cover" },
                }}
              />
            )}
            
            {/* Scanner Frame/Overlay */}
            <div className="absolute inset-0 pointer-events-none border-[3px] border-primary/30 rounded-[1.8rem]" />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-48 h-48 border-2 border-dashed border-primary/40 rounded-3xl animate-pulse" />
            </div>
          </div>
          
          <p className="text-xs font-medium text-muted-foreground text-center mt-6 flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-ping" />
            Ensure the QR code is well-lit and centered.
          </p>
        </div>
        <DialogFooter className="p-4 bg-muted/20 border-t sm:hidden">
          <Button variant="ghost" onClick={onClose} className="w-full h-12 rounded-xl text-base font-semibold">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
