"use client";
import { safeConsole } from "@/lib/safe-console";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Avatar as AvatarUI,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ImageCropper from "@/components/shared/ImageCropper";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { completeOnboarding } from "./actions";

interface AvatarFieldProps {
  url: string;
  fullName?: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
}

/**
 * Profile photo with upload and remove. Both save on their own, so the form's
 * save button never has to cover the photo.
 */
export function AvatarField({
  url,
  fullName,
  onUpload,
  onRemove,
}: AvatarFieldProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tempImageUrl, setTempImageUrl] = useState<string>("");
  const [showCropper, setShowCropper] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so picking the same file again still fires a change.
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size exceeds 5 MB. Please upload a smaller file.");
      return;
    }
    const fileUrl = URL.createObjectURL(file);
    setTempImageUrl(fileUrl);
    setShowCropper(true);
  };

  const handleCropComplete = async (croppedImage: string) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatarUrl", croppedImage);
      const result = await completeOnboarding(formData);
      if (result?.error) {
        toast.error("Failed to upload profile picture");
        return;
      }
      onUpload(croppedImage);
      toast.success("Profile picture updated successfully");
      setTimeout(() => {
        router.refresh();
      }, 1000);
    } catch (error) {
      safeConsole.error("Error uploading profile picture:", error);
      toast.error("Failed to upload profile picture");
    } finally {
      setIsUploading(false);
      setShowCropper(false);
      setTempImageUrl("");
    }
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    setTempImageUrl("");
  };

  return (
    <>
      <div className="flex items-center gap-4">
        <AvatarUI className="size-16">
          <AvatarImage src={url || undefined} alt="Profile picture" />
          <AvatarFallback className="text-lg">
            <NoAvatar fullName={fullName} />
          </AvatarFallback>
        </AvatarUI>
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label="Upload profile picture"
              onChange={handleUpload}
              accept="image/jpeg,image/png,image/jpg"
              disabled={isUploading}
            />
            <Button
              type="button"
              variant="outline"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload data-icon="inline-start" />
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
            {url && (
              <Button
                type="button"
                variant="ghost"
                onClick={onRemove}
                disabled={isUploading}
              >
                <Trash2 data-icon="inline-start" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            JPG or PNG, up to 5 MB. Photo changes save right away.
          </p>
        </div>
      </div>
      <Dialog open={showCropper} onOpenChange={setShowCropper}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogTitle className="sr-only">Image Cropper</DialogTitle>
          {showCropper && (
            <ImageCropper
              imageSrc={tempImageUrl}
              onCropComplete={handleCropComplete}
              onCancel={handleCropCancel}
              isUploading={isUploading}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
