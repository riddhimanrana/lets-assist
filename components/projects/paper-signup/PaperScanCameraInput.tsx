"use client";

import { useRef } from "react";
import { Camera, ImagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

interface PaperScanCameraInputProps {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/**
 * The capture entry point. On mobile there are two separate inputs: one with
 * capture="environment" ("Take photo") and one without ("Choose from
 * library"), because the capture attribute suppresses the gallery picker
 * entirely on Android. Desktop gets the plain picker only.
 */
export function PaperScanCameraInput({
  disabled,
  onFiles,
}: PaperScanCameraInputProps) {
  const isMobile = useIsMobile();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Allow re-selecting the same file after a removal.
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        ref={cameraInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        capture="environment"
        multiple
        hidden
        onChange={handleChange}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        hidden
        onChange={handleChange}
      />

      {isMobile && (
        <Button
          type="button"
          disabled={disabled}
          className="h-12 flex-1"
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera className="size-5" />
          Take photo
        </Button>
      )}
      <Button
        type="button"
        variant={isMobile ? "outline" : "default"}
        disabled={disabled}
        className="h-12 flex-1"
        onClick={() => libraryInputRef.current?.click()}
      >
        <ImagePlus className="size-5" />
        {isMobile ? "Choose from library" : "Choose photos"}
      </Button>
    </div>
  );
}
