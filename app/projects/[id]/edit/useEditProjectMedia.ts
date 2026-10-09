"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Project } from "@/types";
import { formatBytes } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  detectPdfWidgets,
  DetectedPdfField,
} from "@/lib/waiver/pdf-field-detect";
import type { WaiverDefinitionInput } from "@/components/waiver/WaiverBuilderDialog";
import { WaiverDefinitionFull } from "@/types/waiver-definitions";
import {
  getWaiverDefinition,
  removeProjectWaiverPdf,
  saveWaiverDefinition,
  updateProject,
  uploadProjectWaiverPdf,
} from "../actions";
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  MAX_COVER_IMAGE_SIZE,
  MAX_DOCUMENTS_COUNT,
  MAX_DOCUMENT_SIZE,
  MAX_WAIVER_PDF_SIZE,
} from "./edit-project-form";

/**
 * Uploads that save immediately, outside the main form: the cover image,
 * supporting documents, and the project's waiver PDF and its field setup.
 */
export function useEditProjectMedia(project: Project) {
  const router = useRouter();
  const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocName, setPreviewDocName] = useState<string>("Document");
  const [previewDocType, setPreviewDocType] = useState<string>("");
  const [totalDocumentsSize, setTotalDocumentsSize] = useState<number>(0);
  const [waiverPdfUploading, setWaiverPdfUploading] = useState(false);
  const [waiverPdfError, setWaiverPdfError] = useState<string | null>(null);
  const [waiverPdfValidation, setWaiverPdfValidation] = useState<{
    hasSignatureFields: boolean;
    warnings: string[];
  } | null>(null);
  const waiverPdfInputRef = useRef<HTMLInputElement | null>(null);

  // Waiver Builder State
  const [waiverBuilderOpen, setWaiverBuilderOpen] = useState(false);
  const [waiverDefinition, setWaiverDefinition] =
    useState<WaiverDefinitionFull | null>(null);
  const [lastDetectedFields, setLastDetectedFields] = useState<
    DetectedPdfField[]
  >([]);
  const [waiverPdfUrl, setWaiverPdfUrl] = useState<string | null>(
    project.waiver_pdf_url ?? null,
  );

  // Fetch waiver definition if exists
  useEffect(() => {
    async function fetchDefinition() {
      if (waiverPdfUrl) {
        try {
          const result = await getWaiverDefinition(project.id);
          if (result.success && result.definition) {
            setWaiverDefinition(result.definition);
          }
        } catch (error) {
          safeConsole.error("Error fetching waiver definition:", error);
        }
      }
    }
    fetchDefinition();
  }, [project.id, waiverPdfUrl]);

  // Handler for saving waiver definition
  const handleWaiverSave = async (definition: WaiverDefinitionInput) => {
    const loadingToast = toast.loading("Saving waiver configuration...");
    try {
      const result = await saveWaiverDefinition(project.id, definition);
      if (result.success) {
        // Fetch the saved definition to update local state
        const updatedResult = await getWaiverDefinition(project.id);
        if (updatedResult.success && updatedResult.definition) {
          setWaiverDefinition(updatedResult.definition);
        }
        setWaiverBuilderOpen(false);
        toast.dismiss(loadingToast);
        toast.success("Waiver configuration saved successfully");
      } else {
        throw new Error(result.error || "Failed to save waiver configuration");
      }
    } catch (error) {
      safeConsole.error("Error saving waiver definition:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to save waiver configuration");
    }
  };

  // Calculate total documents size
  useEffect(() => {
    const totalSize = (project.documents || []).reduce(
      (sum, doc) => sum + (doc.size || 0),
      0,
    );
    setTotalDocumentsSize(totalSize);
  }, [project.documents]);

  // Media & Documents handlers
  const validateImage = (file: File): boolean => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid image type. Please use JPEG, PNG, or WebP");
      return false;
    }
    if (file.size > MAX_COVER_IMAGE_SIZE) {
      toast.error(
        `Image too large. Maximum size is ${formatBytes(MAX_COVER_IMAGE_SIZE)}`,
      );
      return false;
    }
    return true;
  };

  const validateDocument = (file: File): boolean => {
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      toast.error("Invalid file type");
      return false;
    }
    const currentTotalSize = (project.documents || []).reduce(
      (sum, doc) => sum + (doc.size || 0),
      0,
    );
    if (currentTotalSize + file.size > MAX_DOCUMENT_SIZE) {
      toast.error("Total document size limit exceeded");
      return false;
    }
    if ((project.documents || []).length >= MAX_DOCUMENTS_COUNT) {
      toast.error("Maximum number of documents reached");
      return false;
    }
    return true;
  };

  const validateWaiverPdf = async (file: File) => {
    setWaiverPdfError(null);

    if (file.type !== "application/pdf") {
      setWaiverPdfError("Please upload a PDF file.");
      return null;
    }

    if (file.size > MAX_WAIVER_PDF_SIZE) {
      setWaiverPdfError(
        `File size must be less than ${formatBytes(MAX_WAIVER_PDF_SIZE)}.`,
      );
      return null;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const header = String.fromCharCode(...bytes.slice(0, 5));

      if (header !== "%PDF-") {
        setWaiverPdfError("Invalid PDF file.");
        return null;
      }

      // Use PDF.js-based widget detection
      const detectionResult = await detectPdfWidgets(file);

      // Store detected fields for builder
      if (detectionResult.success) {
        setLastDetectedFields(detectionResult.fields);
      } else {
        setLastDetectedFields([]);
      }

      const warnings: string[] = [];

      if (!detectionResult.success) {
        // PDF.js failed, but we have fallback detection result
        warnings.push("Could not fully analyze PDF structure.");
        if (detectionResult.errors) {
          warnings.push(...detectionResult.errors);
        }
      }

      if (!detectionResult.hasSignatureFields) {
        warnings.push(
          "No signature fields detected. Volunteers will sign electronically alongside the PDF.",
        );
      } else if (detectionResult.success && detectionResult.fields.length > 0) {
        const sigFields = detectionResult.fields.filter(
          (f) => f.fieldType === "signature",
        );
        warnings.push(
          `Detected ${sigFields.length} signature field(s) and ${detectionResult.fields.length - sigFields.length} other form field(s) across ${detectionResult.pageCount} page(s).`,
        );
      }

      const validation = {
        hasSignatureFields: detectionResult.hasSignatureFields,
        warnings,
      };
      setWaiverPdfValidation(validation);
      return validation;
    } catch (error) {
      safeConsole.error("Error validating waiver PDF:", error);
      setWaiverPdfError("Error reading PDF file. Please try again.");
      return null;
    }
  };

  const handleCoverImageChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!validateImage(file)) return;

      setUploadingCoverImage(true);
      const loadingToast = toast.loading("Uploading cover image...");

      try {
        const supabase = createClient();
        const fileExt = file.name.split(".").pop();
        const timestamp = Date.now();
        const fileName = `project_${project.id}_cover_${timestamp}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("project-images")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("project-images")
          .getPublicUrl(fileName);

        const result = await updateProject(project.id, {
          cover_image_url: urlData.publicUrl,
        });

        if (result.error) throw new Error(result.error);

        toast.dismiss(loadingToast);
        toast.success("Cover image uploaded successfully");
        router.refresh();
      } catch (error) {
        safeConsole.error("Upload error:", error);
        toast.dismiss(loadingToast);
        toast.error("Failed to upload cover image");
      } finally {
        setUploadingCoverImage(false);
      }
    }
  };

  const removeCoverImage = async () => {
    if (!project.cover_image_url) return;

    try {
      const supabase = createClient();
      const urlParts = new URL(project.cover_image_url);
      const pathParts = urlParts.pathname.split("/");
      const fileName = pathParts[pathParts.length - 1];

      const { error: deleteError } = await supabase.storage
        .from("project-images")
        .remove([fileName]);

      if (deleteError) safeConsole.warn("Storage delete error:", deleteError);

      const result = await updateProject(project.id, {
        cover_image_url: null,
      });

      if (result.error) throw new Error(result.error);

      toast.success("Cover image removed");
      router.refresh();
    } catch (error) {
      safeConsole.error("Delete error:", error);
      toast.error("Failed to remove cover image");
    }
  };

  const handleDocumentUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const files = Array.from(e.target.files);
    const totalFiles = (project.documents || []).length + files.length;

    if (totalFiles > MAX_DOCUMENTS_COUNT) {
      toast.error(`Maximum ${MAX_DOCUMENTS_COUNT} documents allowed`);
      return;
    }

    const currentTotalSize = (project.documents || []).reduce(
      (sum, doc) => sum + (doc.size || 0),
      0,
    );
    const newFilesTotalSize = files.reduce((sum, file) => sum + file.size, 0);

    if (currentTotalSize + newFilesTotalSize > MAX_DOCUMENT_SIZE) {
      toast.error("Total document size limit exceeded");
      return;
    }

    setUploadingDocuments(true);
    const loadingToast = toast.loading(
      `Uploading ${files.length} document(s)...`,
    );

    try {
      const supabase = createClient();
      const uploadedDocs = [];

      for (const file of files) {
        if (!validateDocument(file)) continue;

        const fileExt = file.name.split(".").pop();
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const fileName = `project_${project.id}_doc_${timestamp}_${random}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("project-documents")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("project-documents")
          .getPublicUrl(fileName);

        uploadedDocs.push({
          name: file.name,
          originalName: file.name,
          url: urlData.publicUrl,
          type: file.type,
          size: file.size,
        });
      }

      const updatedDocs = [...(project.documents || []), ...uploadedDocs];
      const result = await updateProject(project.id, {
        documents: updatedDocs,
      });

      if (result.error) throw new Error(result.error);

      toast.dismiss(loadingToast);
      toast.success(`${uploadedDocs.length} document(s) uploaded successfully`);
      router.refresh();
    } catch (error) {
      safeConsole.error("Upload error:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to upload documents");
    } finally {
      setUploadingDocuments(false);
    }
  };

  const handleWaiverPdfUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = await validateWaiverPdf(file);
    if (!validation) return;

    setWaiverPdfUploading(true);
    const loadingToast = toast.loading("Uploading waiver PDF...");

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      const result = await uploadProjectWaiverPdf(
        project.id,
        dataUrl,
        file.name,
      );
      if (result.error) {
        throw new Error(result.error);
      }

      if (result.waiverPdfUrl) {
        setWaiverPdfUrl(result.waiverPdfUrl);
        // Automatically open builder after upload
        setWaiverBuilderOpen(true);
      }

      toast.dismiss(loadingToast);
      toast.success("Waiver PDF uploaded successfully");
      router.refresh();
    } catch (error) {
      safeConsole.error("Upload waiver PDF error:", error);
      toast.dismiss(loadingToast);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to upload waiver PDF",
      );
    } finally {
      setWaiverPdfUploading(false);
      if (waiverPdfInputRef.current) {
        waiverPdfInputRef.current.value = "";
      }
    }
  };

  const handleRemoveWaiverPdf = async () => {
    setWaiverPdfUploading(true);
    const loadingToast = toast.loading("Removing waiver PDF...");

    try {
      const result = await removeProjectWaiverPdf(project.id);
      if (result.error) {
        throw new Error(result.error);
      }

      setWaiverPdfUrl(null);
      setWaiverDefinition(null);
      setLastDetectedFields([]);

      toast.dismiss(loadingToast);
      toast.success("Waiver PDF removed");
      setWaiverPdfValidation(null);
      router.refresh();
    } catch (error) {
      safeConsole.error("Remove waiver PDF error:", error);
      toast.dismiss(loadingToast);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to remove waiver PDF",
      );
    } finally {
      setWaiverPdfUploading(false);
    }
  };

  const handleDeleteDocument = async (docUrl: string) => {
    try {
      const supabase = createClient();
      const urlParts = new URL(docUrl);
      const pathParts = urlParts.pathname.split("/");
      const fileName = pathParts[pathParts.length - 1];

      const { error: storageError } = await supabase.storage
        .from("project-documents")
        .remove([fileName]);

      if (storageError) safeConsole.warn("Storage delete error:", storageError);

      const updatedDocs = (project.documents || []).filter(
        (doc) => doc.url !== docUrl,
      );
      const result = await updateProject(project.id, {
        documents: updatedDocs,
      });

      if (result.error) throw new Error(result.error);

      toast.success("Document deleted");
      router.refresh();
    } catch (error) {
      safeConsole.error("Delete error:", error);
      toast.error("Failed to delete document");
    }
  };

  const openPreview = (
    url: string,
    fileName: string = "Document",
    fileType: string = "",
  ) => {
    setPreviewDoc(url);
    setPreviewDocName(fileName);
    setPreviewDocType(fileType);
    setPreviewOpen(true);
  };

  const isPreviewable = (type: string) => {
    return type.includes("pdf") || type.includes("image");
  };

  return {
    uploadingCoverImage,
    uploadingDocuments,
    previewDoc,
    previewOpen,
    setPreviewOpen,
    previewDocName,
    previewDocType,
    totalDocumentsSize,
    waiverPdfUploading,
    waiverPdfError,
    waiverPdfValidation,
    waiverPdfInputRef,
    waiverBuilderOpen,
    setWaiverBuilderOpen,
    waiverDefinition,
    lastDetectedFields,
    waiverPdfUrl,
    handleWaiverSave,
    handleCoverImageChange,
    removeCoverImage,
    handleDocumentUpload,
    handleWaiverPdfUpload,
    handleRemoveWaiverPdf,
    handleDeleteDocument,
    openPreview,
    isPreviewable,
  };
}

export type EditProjectMedia = ReturnType<typeof useEditProjectMedia>;
