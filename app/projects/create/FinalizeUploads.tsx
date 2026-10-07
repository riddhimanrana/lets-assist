"use client";

import Image from "next/image";
import { FileText, FileType, Image as ImageIcon, X } from "lucide-react";

import { UploadIcon, useAnimatedIcon } from "@/components/icons/animated";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";

import { FormGroup } from "./form-parts";

type UploadState = "idle" | "uploading" | "processing" | "error" | "done";

interface DropHandlers {
  dragActive: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Get file icon based on type
const getFileIcon = (fileType: string) => {
  if (fileType.includes("pdf")) {
    return <FileText />;
  } else if (fileType.includes("word") || fileType.includes("doc")) {
    return <FileText />;
  } else if (fileType.includes("text")) {
    return <FileText />;
  } else if (fileType.includes("image")) {
    return <ImageIcon />;
  } else {
    return <FileType />;
  }
};

// Helper function to format file size
const formatFileSize = (bytes: number | undefined | null): string => {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  else return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};

const getAttachmentDescription = (file: File, state: UploadState) => {
  if (state === "uploading") return "Uploading...";
  if (state === "processing") return "Saving to project...";
  if (state === "error") return "Upload failed";
  if (state === "done") return "Uploaded";
  return `${file.type.split("/").pop()?.toUpperCase() || "File"} · ${formatFileSize(file.size)}`;
};

/**
 * A dashed target you can drop files on or press to browse. The file input
 * covers the whole target, so a click, a drop and the keyboard all reach it.
 */
function DropZone({
  inputId,
  inputLabel,
  accept,
  multiple,
  disabled,
  title,
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onChange,
}: DropHandlers & {
  inputId: string;
  inputLabel: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  title: string;
}) {
  const icon = useAnimatedIcon();

  return (
    <div
      className={cn(
        "has-focus-visible:border-ring has-focus-visible:ring-ring/50 relative flex min-h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center transition-colors has-focus-visible:ring-[3px]",
        dragActive ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        disabled && "pointer-events-none opacity-50",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={icon.triggerProps.onMouseEnter}
      onMouseLeave={icon.triggerProps.onMouseLeave}
    >
      <UploadIcon
        ref={icon.ref}
        size={20}
        aria-hidden="true"
        className="text-muted-foreground"
      />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-xs">or click to browse</p>
      {!disabled && (
        <input
          type="file"
          id={inputId}
          aria-label={inputLabel}
          multiple={multiple}
          accept={accept}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          onChange={onChange}
          onFocus={icon.triggerProps.onFocus}
          onBlur={icon.triggerProps.onBlur}
        />
      )}
    </div>
  );
}

export function CoverImageUpload({
  preview,
  uploadState,
  accept,
  onRemove,
  ...drop
}: DropHandlers & {
  preview: string | null;
  uploadState: UploadState;
  accept: string;
  onRemove: () => void;
}) {
  return (
    <FormGroup
      title="Cover image"
      description="Upload a cover image for your project (JPEG, JPG, PNG, WebP, max 5MB)"
    >
      {preview ? (
        <div
          className="grid max-w-md gap-3"
          onDragOver={drop.onDragOver}
          onDragLeave={drop.onDragLeave}
          onDrop={drop.onDrop}
        >
          <AspectRatio
            ratio={4 / 3}
            className="bg-muted overflow-hidden rounded-lg"
          >
            <Image
              src={preview}
              alt="Cover image preview"
              fill
              className="object-cover"
            />
          </AspectRatio>
          <Attachment state={uploadState} className="w-full">
            <AttachmentMedia variant="image">
              <Image
                src={preview}
                alt=""
                width={40}
                height={40}
                className="object-cover"
              />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>Cover image ready</AttachmentTitle>
              <AttachmentDescription>
                {uploadState === "uploading" && "Uploading..."}
                {uploadState === "processing" && "Saving to project..."}
                {uploadState === "error" && "Upload failed"}
                {uploadState === "done" && "Uploaded"}
                {uploadState === "idle" &&
                  "Will be uploaded after project creation"}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                type="button"
                variant="ghost"
                aria-label="Remove cover image"
                title="Remove cover image"
                disabled={
                  uploadState === "uploading" || uploadState === "processing"
                }
                onClick={onRemove}
              >
                <X />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        </div>
      ) : (
        <DropZone
          inputId="coverImage"
          inputLabel="Cover image"
          accept={accept}
          title="Drag & drop your cover image here"
          {...drop}
        />
      )}
      <p className="text-muted-foreground text-sm">
        Cover images are optional, but if you have an image feel free to show
        it!
      </p>
    </FormGroup>
  );
}

export function DocumentsUpload({
  documents,
  totalSize,
  maxCount,
  maxSize,
  uploadStates,
  getUploadKey,
  accept,
  onRemove,
  ...drop
}: DropHandlers & {
  documents: File[];
  totalSize: number;
  maxCount: number;
  maxSize: number;
  uploadStates: Record<string, UploadState>;
  getUploadKey: (file: File) => string;
  accept: string;
  onRemove: (index: number) => void;
}) {
  return (
    <FormGroup
      title="Supporting documents"
      description="Upload permission slips, waivers, instructions or images (PDF, Word, Text, Images, max 10MB total)"
      aside={
        <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {documents.length}/{maxCount} files • {formatFileSize(totalSize)}/
          {formatFileSize(maxSize)}
        </p>
      }
    >
      <DropZone
        inputId="documents"
        inputLabel="Supporting documents"
        accept={accept}
        multiple
        disabled={documents.length >= maxCount}
        title="Drag & drop files here"
        {...drop}
      />

      {documents.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Selected documents</p>
          <AttachmentGroup
            role="group"
            aria-label="Uploaded project documents"
            tabIndex={0}
            className="grid gap-2 overflow-visible py-0 sm:grid-cols-2"
          >
            {documents.map((doc, index) => {
              const uploadState = uploadStates[getUploadKey(doc)] ?? "idle";

              return (
                <Attachment
                  key={`${doc.name}-${doc.lastModified}`}
                  state={uploadState}
                  className="w-full"
                >
                  <AttachmentMedia>{getFileIcon(doc.type)}</AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{doc.name}</AttachmentTitle>
                    <AttachmentDescription>
                      {getAttachmentDescription(doc, uploadState)}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${doc.name}`}
                      title={`Remove ${doc.name}`}
                      disabled={
                        uploadState === "uploading" ||
                        uploadState === "processing"
                      }
                      onClick={() => onRemove(index)}
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              );
            })}
          </AttachmentGroup>
        </div>
      )}

      {!documents.length && (
        <p className="text-muted-foreground text-sm">
          Documents are optional but recommended for projects requiring
          additional information
        </p>
      )}
    </FormGroup>
  );
}
