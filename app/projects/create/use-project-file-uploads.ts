"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState } from "react";
import { toast } from "sonner";

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
 * Files the server has confirmed as attached, and the project they belong to.
 * A retry of the same attempt skips them without sending their bytes again.
 * Keyed by the File object, so a file picked again is a new entry.
 */
const confirmedAttachments = new WeakMap<File, string>();

/**
 * Names the stored object after the file itself: its name, type and bytes.
 * The same file always lands on the same key for a project, so a retry (even
 * after a reload) reuses the object and the link action can tell it is already
 * attached. A changed file with the same name gets a different key.
 */
const fingerprintFile = async (file: File) => {
  const identity = new Blob([file.name, "\0", file.type, "\0", file]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await identity.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 32);
};

/** Storage refused the upload because this exact key is already stored. */
const isAlreadyStored = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const storageError = error as {
    statusCode?: unknown;
    status?: unknown;
    error?: unknown;
    message?: unknown;
  };
  return (
    String(storageError.statusCode) === "409" ||
    storageError.status === 409 ||
    storageError.error === "Duplicate" ||
    /already exists/i.test(String(storageError.message ?? ""))
  );
};

/**
 * The cover image and supporting documents picked on the last step, and the
 * direct-to-storage upload that runs after the project row exists.
 *
 * The upload can be run again for the same project. Files already attached are
 * left alone, files already stored are not stored twice, and nothing is removed
 * from storage here, because a link whose answer was lost may have succeeded.
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
    const isAttached = (file: File) =>
      confirmedAttachments.get(file) === projectId;
    let hasErrors = false;
    let coverImageUrl: string | undefined;
    const uploadedDocuments: UploadedProjectDocument[] = [];
    const pendingDocumentFiles: File[] = [];

    const setDocumentStates = (files: File[], status: UploadStatus) =>
      setDocumentUploadStates((current) => {
        const next = { ...current };
        for (const file of files) next[getUploadKey(file)] = status;
        return next;
      });

    /** Stores the file under its own key. A key that is already stored is reused. */
    const storeFile = async (bucket: string, path: string, file: File) => {
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
          contentType: file.type,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError && !isAlreadyStored(uploadError)) throw uploadError;

      return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    };

    const coverAttached = coverImage ? isAttached(coverImage) : false;
    setCoverImageUploadState(coverAttached ? "done" : "idle");
    setDocumentUploadStates(
      Object.fromEntries(
        documents.map((document) => [
          getUploadKey(document),
          (isAttached(document) ? "done" : "idle") as UploadStatus,
        ]),
      ),
    );

    if (coverImage && !coverAttached) {
      if (validateFileSize(coverImage, 5 * 1024 * 1024)) {
        setCoverImageUploadState("uploading");
        try {
          const filePath = `project_${projectId}_cover_${await fingerprintFile(coverImage)}.${getSafeExtension(coverImage)}`;
          coverImageUrl = await storeFile(
            "project-images",
            filePath,
            coverImage,
          );
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
      if (isAttached(document)) continue;

      if (!validateFileSize(document, 10 * 1024 * 1024)) {
        setDocumentStates([document], "error");
        hasErrors = true;
        continue;
      }

      setDocumentStates([document], "uploading");

      try {
        const filePath = `project_${projectId}_${await fingerprintFile(document)}.${getSafeExtension(document)}`;
        const url = await storeFile("project-documents", filePath, document);

        uploadedDocuments.push({
          name: document.name,
          originalName: document.name,
          type: document.type,
          size: document.size,
          url,
        });
        pendingDocumentFiles.push(document);

        setDocumentStates([document], "processing");
      } catch (error) {
        safeConsole.error(
          `Document upload failed for ${document.name}:`,
          error,
        );
        setDocumentStates([document], "error");
        hasErrors = true;
      }
    }

    if (coverImageUrl || uploadedDocuments.length > 0) {
      const markLinkFailed = () => {
        if (coverImageUrl) setCoverImageUploadState("error");
        setDocumentStates(pendingDocumentFiles, "error");
      };

      let linkResult: Awaited<ReturnType<typeof linkProjectUploadedAssets>>;
      try {
        linkResult = await linkProjectUploadedAssets(projectId, {
          coverImageUrl,
          documents: uploadedDocuments,
        });
      } catch (error) {
        // No answer does not mean nothing was attached. The stored files stay,
        // and the next attempt finds them under the same keys.
        markLinkFailed();
        throw error;
      }

      if ("error" in linkResult && linkResult.error) {
        hasErrors = true;
        markLinkFailed();
      } else {
        if (coverImage && coverImageUrl) {
          confirmedAttachments.set(coverImage, projectId);
          setCoverImageUploadState("done");
        }
        for (const file of pendingDocumentFiles) {
          confirmedAttachments.set(file, projectId);
        }
        setDocumentStates(pendingDocumentFiles, "done");
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
