// Finalize.tsx - Final review step for project creation

"use client";

import { useState, useCallback, useEffect } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { FinalizeSummary, type FinalizeState } from "./FinalizeSummary";
import { CoverImageUpload, DocumentsUpload } from "./FinalizeUploads";
import { FormGroup, StepSection } from "./form-parts";

// Maximum file sizes
const MAX_COVER_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DOCUMENTS_COUNT = 5;

// Allowed file types
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];
const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];

interface FinalizeProps {
  state: FinalizeState;
  setCoverImageAction: (file: File | null) => void;
  setDocumentsAction: (docs: File[]) => void;
  hasProfanity: boolean;
  coverImageUploadState?:
    "idle" | "uploading" | "processing" | "error" | "done";
  documentUploadStates?: Record<
    string,
    "idle" | "uploading" | "processing" | "error" | "done"
  >;
  getUploadKey?: (file: File) => string;
}

export default function Finalize({
  state,
  setCoverImageAction,
  setDocumentsAction,
  hasProfanity,
  coverImageUploadState = "idle",
  documentUploadStates = {},
  getUploadKey = (file) => `${file.name}-${file.size}-${file.lastModified}`,
}: FinalizeProps) {
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(
    null,
  );
  const [localDocuments, setLocalDocuments] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState<"cover" | "docs" | null>(null);
  const [totalDocumentsSize, setTotalDocumentsSize] = useState<number>(0);

  // Calculate total documents size whenever localDocuments change
  useEffect(() => {
    const totalSize = localDocuments.reduce((sum, doc) => sum + doc.size, 0);
    setTotalDocumentsSize(totalSize);
  }, [localDocuments]);

  // File validation helpers
  const validateImage = (file: File): boolean => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid file type");
      return false;
    }

    if (file.size > MAX_COVER_IMAGE_SIZE) {
      toast.error("File too large. Cover image must be less than 5MB.");
      return false;
    }

    return true;
  };

  const validateDocument = (
    file: File,
    existingFiles: File[] = [],
  ): boolean => {
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      toast.error("Invalid file type.");
      return false;
    }

    if (file.size > MAX_DOCUMENT_SIZE) {
      toast.error("File too large, each document must be less than 10MB");
      return false;
    }

    // Check if adding this file would exceed the total documents size limit
    const currentTotalSize = existingFiles.reduce(
      (sum, doc) => sum + doc.size,
      0,
    );
    if (currentTotalSize + file.size > MAX_DOCUMENT_SIZE) {
      toast.error("Total documents size must not exceed 10MB");
      return false;
    }

    // Check if adding this file would exceed the max count
    if (existingFiles.length >= MAX_DOCUMENTS_COUNT) {
      toast.error(
        "Maximum files reached. You can upload a maximum of 5 documents",
      );
      return false;
    }

    return true;
  };

  // File handlers
  const handleCoverImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      if (validateImage(file)) {
        setCoverImageAction(file);
        const fileReader = new FileReader();
        fileReader.onload = (e) => {
          if (e.target?.result) {
            setCoverImagePreview(e.target.result as string);
          }
        };
        fileReader.readAsDataURL(file);
      }
    }
  };

  const handleDocumentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);

      // Check if adding these files would exceed the max count
      if (localDocuments.length + newFiles.length > MAX_DOCUMENTS_COUNT) {
        toast.error("Maximum files reached");
        return;
      }

      // Validate each file individually
      const validFiles: File[] = [];

      for (const file of newFiles) {
        if (validateDocument(file, [...localDocuments, ...validFiles])) {
          validFiles.push(file);
        }
      }

      if (validFiles.length > 0) {
        const updatedDocs = [...localDocuments, ...validFiles];
        setLocalDocuments(updatedDocs);
        setDocumentsAction(updatedDocs);
      }
    }
  };

  const removeDocument = (index: number) => {
    const updatedDocs = localDocuments.filter((_, i) => i !== index);
    setLocalDocuments(updatedDocs);
    setDocumentsAction(updatedDocs);
  };

  const removeCoverImage = () => {
    setCoverImageAction(null);
    setCoverImagePreview(null);
  };

  // Drag and drop handlers
  const handleDragOver = useCallback(
    (e: React.DragEvent, dropZone: "cover" | "docs") => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(dropZone);
    },
    [],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(null);
  }, []);

  const handleCoverImageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(null);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];

        if (validateImage(file)) {
          setCoverImageAction(file);
          const fileReader = new FileReader();
          fileReader.onload = (e) => {
            if (e.target?.result) {
              setCoverImagePreview(e.target.result as string);
            }
          };
          fileReader.readAsDataURL(file);
        }
      }
    },
    [setCoverImageAction],
  );

  const handleDocumentsDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(null);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const newFiles = Array.from(e.dataTransfer.files);

        // Check if adding these files would exceed the max count
        if (localDocuments.length + newFiles.length > MAX_DOCUMENTS_COUNT) {
          toast.error("Maximum files reached");
          return;
        }

        // Validate each file individually
        const validFiles: File[] = [];

        for (const file of newFiles) {
          if (validateDocument(file, [...localDocuments, ...validFiles])) {
            validFiles.push(file);
          }
        }

        if (validFiles.length > 0) {
          const updatedDocs = [...localDocuments, ...validFiles];
          setLocalDocuments(updatedDocs);
          setDocumentsAction(updatedDocs);
        }
      }
    },
    [localDocuments, setDocumentsAction],
  );

  return (
    <StepSection
      title="Review your project"
      description="Please review your project details before creating"
    >
      {/* File Upload Sections */}
      <CoverImageUpload
        preview={coverImagePreview}
        uploadState={coverImageUploadState}
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        dragActive={dragActive === "cover"}
        onDragOver={(e) => handleDragOver(e, "cover")}
        onDragLeave={handleDragLeave}
        onDrop={handleCoverImageDrop}
        onChange={handleCoverImageChange}
        onRemove={removeCoverImage}
      />

      <DocumentsUpload
        documents={localDocuments}
        totalSize={totalDocumentsSize}
        maxCount={MAX_DOCUMENTS_COUNT}
        maxSize={MAX_DOCUMENT_SIZE}
        uploadStates={documentUploadStates}
        getUploadKey={getUploadKey}
        accept={ALLOWED_DOCUMENT_TYPES.join(",")}
        dragActive={dragActive === "docs"}
        onDragOver={(e) => handleDragOver(e, "docs")}
        onDragLeave={handleDragLeave}
        onDrop={handleDocumentsDrop}
        onChange={handleDocumentsChange}
        onRemove={removeDocument}
      />

      <FinalizeSummary state={state} />

      <FormGroup>
        {/* Show the last submit-time profanity result from parent state */}
        {hasProfanity ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Content warning</AlertTitle>
            <AlertDescription>
              <p>
                We detected potentially inappropriate content when you clicked
                create. Please revise your title, location, or description and
                try again.
              </p>
              <p>We only run this check during submission.</p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CheckCircle2 aria-hidden="true" />
            <AlertTitle>Ready to create your project</AlertTitle>
            <AlertDescription>
              Click the &quot;Create project&quot; button below to publish this
              project and start accepting volunteers. We&apos;ll run one
              profanity check right before submission.
            </AlertDescription>
          </Alert>
        )}

        {/* AI moderation notice */}
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">
            Content moderation notice.
          </span>{" "}
          All projects are reviewed by our AI moderation system. Projects
          identified as spam or potentially malicious may be automatically
          flagged or removed to maintain platform safety.
        </p>
      </FormGroup>
    </StepSection>
  );
}
