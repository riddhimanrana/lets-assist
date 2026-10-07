"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState } from "react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";

import { linkProjectUploadedAssets } from "./actions";

export type UploadStatus =
  "idle" | "uploading" | "processing" | "error" | "done";

type UploadedProjectDocument = {
  name: string;
  originalName: string;
  type: string;
  size: number;
  url: string;
};

/**
 * The cover image and supporting documents picked on the last step, and the
 * direct-to-storage upload that runs after the project row exists. Moved out
 * of ProjectCreator unchanged.
 */
export function useProjectFileUploads() {
  // File handling states
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [documents, setDocuments] = useState<File[]>([]);
  const [coverImageUploadState, setCoverImageUploadState] =
    useState<UploadStatus>("idle");
  const [documentUploadStates, setDocumentUploadStates] = useState<
    Record<string, UploadStatus>
  >({});

  // Improved function to check file sizes before upload
  const validateFileSize = (file: File, maxSize: number): boolean => {
    if (file.size > maxSize) {
      toast.error(`File ${file.name} exceeds the maximum size limit`);
      return false;
    }
    return true;
  };

  const getUploadKey = (file: File) =>
    `${file.name}-${file.size}-${file.lastModified}`;

  const getSafeExtension = (file: File) => {
    const extensionFromName = file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const extensionFromType = file.type
      .split("/")[1]
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return extensionFromName || extensionFromType || "file";
  };

  const uploadProjectFiles = async (projectId: string) => {
    if (!coverImage && documents.length === 0) {
      return { hasErrors: false };
    }

    const supabase = createBrowserSupabaseClient();
    let hasErrors = false;
    let coverImageUrl: string | undefined;
    const uploadedDocuments: UploadedProjectDocument[] = [];
    const uploadedPaths: { bucket: string; path: string }[] = [];

    setCoverImageUploadState(coverImage ? "idle" : "idle");
    setDocumentUploadStates(
      Object.fromEntries(
        documents.map((document) => [
          getUploadKey(document),
          "idle" as UploadStatus,
        ]),
      ),
    );

    if (coverImage) {
      if (validateFileSize(coverImage, 5 * 1024 * 1024)) {
        setCoverImageUploadState("uploading");
        try {
          const filePath = `project_${projectId}_cover_${Date.now()}.${getSafeExtension(coverImage)}`;
          const { error: uploadError } = await supabase.storage
            .from("project-images")
            .upload(filePath, coverImage, {
              contentType: coverImage.type,
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;
          uploadedPaths.push({ bucket: "project-images", path: filePath });

          const { data: publicUrlData } = supabase.storage
            .from("project-images")
            .getPublicUrl(filePath);

          coverImageUrl = publicUrlData.publicUrl;
          setCoverImageUploadState("processing");
        } catch (error) {
          safeConsole.error("Cover image upload failed:", error);
          setCoverImageUploadState("error");
          hasErrors = true;
        }
      } else {
        setCoverImageUploadState("error");
        hasErrors = true;
      }
    }

    for (const document of documents) {
      const uploadKey = getUploadKey(document);

      if (!validateFileSize(document, 10 * 1024 * 1024)) {
        setDocumentUploadStates((current) => ({
          ...current,
          [uploadKey]: "error",
        }));
        hasErrors = true;
        continue;
      }

      setDocumentUploadStates((current) => ({
        ...current,
        [uploadKey]: "uploading",
      }));

      try {
        const filePath = `project_${projectId}_${uuidv4().slice(0, 8)}_${Date.now()}.${getSafeExtension(document)}`;
        const { error: uploadError } = await supabase.storage
          .from("project-documents")
          .upload(filePath, document, {
            contentType: document.type,
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) throw uploadError;
        uploadedPaths.push({ bucket: "project-documents", path: filePath });

        const { data: publicUrlData } = supabase.storage
          .from("project-documents")
          .getPublicUrl(filePath);

        uploadedDocuments.push({
          name: document.name,
          originalName: document.name,
          type: document.type,
          size: document.size,
          url: publicUrlData.publicUrl,
        });

        setDocumentUploadStates((current) => ({
          ...current,
          [uploadKey]: "processing",
        }));
      } catch (error) {
        safeConsole.error(
          `Document upload failed for ${document.name}:`,
          error,
        );
        setDocumentUploadStates((current) => ({
          ...current,
          [uploadKey]: "error",
        }));
        hasErrors = true;
      }
    }

    if (coverImageUrl || uploadedDocuments.length > 0) {
      const linkResult = await linkProjectUploadedAssets(projectId, {
        coverImageUrl,
        documents: uploadedDocuments,
      });

      if ("error" in linkResult && linkResult.error) {
        hasErrors = true;
        if (coverImageUrl) setCoverImageUploadState("error");
        setDocumentUploadStates((current) => {
          const next = { ...current };
          for (const document of uploadedDocuments) {
            const matchingFile = documents.find(
              (file) =>
                file.name === document.name && file.size === document.size,
            );
            if (matchingFile) next[getUploadKey(matchingFile)] = "error";
          }
          return next;
        });

        await Promise.allSettled(
          uploadedPaths.map((item) =>
            supabase.storage.from(item.bucket).remove([item.path]),
          ),
        );
      } else {
        if (coverImageUrl) setCoverImageUploadState("done");
        setDocumentUploadStates((current) => {
          const next = { ...current };
          for (const document of uploadedDocuments) {
            const matchingFile = documents.find(
              (file) =>
                file.name === document.name && file.size === document.size,
            );
            if (matchingFile) next[getUploadKey(matchingFile)] = "done";
          }
          return next;
        });
      }
    }

    return { hasErrors };
  };

  return {
    setCoverImage,
    setDocuments,
    coverImageUploadState,
    setCoverImageUploadState,
    documentUploadStates,
    setDocumentUploadStates,
    getUploadKey,
    uploadProjectFiles,
  };
}
