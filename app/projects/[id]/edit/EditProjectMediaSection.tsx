"use client";

import { useRef } from "react";
import Image from "next/image";
import { Eye, File, FileImage, FileText, Trash2, Upload } from "lucide-react";

import { FormGroup, StepSection } from "@/app/projects/create/form-parts";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/utils";
import type { Project } from "@/types";
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  MAX_COVER_IMAGE_SIZE,
  MAX_DOCUMENTS_COUNT,
  MAX_DOCUMENT_SIZE,
} from "./edit-project-form";
import type { EditProjectMedia } from "./useEditProjectMedia";

function FileTypeIcon({ type }: { type: string }) {
  const Icon = type.includes("image")
    ? FileImage
    : type.includes("pdf") || type.includes("text") || type.includes("word")
      ? FileText
      : File;
  return (
    <Icon
      className="text-muted-foreground size-4 shrink-0"
      aria-hidden="true"
    />
  );
}

/** The cover image and supporting documents. These save as soon as they upload. */
export function EditProjectMediaSection({
  project,
  media,
}: {
  project: Project;
  media: EditProjectMedia;
}) {
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const documentsInputRef = useRef<HTMLInputElement | null>(null);
  const documents = project.documents || [];
  const documentsFull = documents.length >= MAX_DOCUMENTS_COUNT;

  return (
    <StepSection
      title="Media & documents"
      description="Uploads and removals here are saved right away."
    >
      <FormGroup
        title="Cover image"
        description={`Upload a cover image for your project (JPEG, PNG, WebP, max ${formatBytes(MAX_COVER_IMAGE_SIZE)})`}
      >
        <input
          ref={coverInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={media.handleCoverImageChange}
          disabled={media.uploadingCoverImage}
        />
        {project.cover_image_url ? (
          <div className="grid max-w-md gap-3">
            <AspectRatio
              ratio={16 / 9}
              className="bg-muted overflow-hidden rounded-lg border"
            >
              <Image
                src={project.cover_image_url}
                alt="Cover image"
                fill
                className="object-cover"
              />
            </AspectRatio>
            <Button
              type="button"
              variant="destructive-ghost"
              className="justify-self-start"
              onClick={media.removeCoverImage}
              disabled={media.uploadingCoverImage}
            >
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              Remove cover image
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={() => coverInputRef.current?.click()}
            disabled={media.uploadingCoverImage}
          >
            {media.uploadingCoverImage ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Upload data-icon="inline-start" aria-hidden="true" />
            )}
            {media.uploadingCoverImage
              ? "Uploading..."
              : "Click to upload cover image"}
          </Button>
        )}
      </FormGroup>

      <FormGroup
        title="Supporting documents"
        description="Upload non-waiver materials like instructions or reference docs (PDF, Word, Text, Images)"
        aside={
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {documents.length}/{MAX_DOCUMENTS_COUNT} files ·{" "}
            {formatBytes(media.totalDocumentsSize)}/
            {formatBytes(MAX_DOCUMENT_SIZE)}
          </span>
        }
      >
        <input
          ref={documentsInputRef}
          type="file"
          multiple
          accept={ALLOWED_DOCUMENT_TYPES.join(",")}
          className="hidden"
          onChange={media.handleDocumentUpload}
          disabled={media.uploadingDocuments || documentsFull}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => documentsInputRef.current?.click()}
            disabled={media.uploadingDocuments || documentsFull}
          >
            {media.uploadingDocuments ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Upload data-icon="inline-start" aria-hidden="true" />
            )}
            {documentsFull
              ? "Maximum files reached"
              : media.uploadingDocuments
                ? "Uploading..."
                : "Click to upload documents"}
          </Button>
          <span className="text-muted-foreground text-sm">
            {documentsFull
              ? `Limit of ${MAX_DOCUMENTS_COUNT} files reached`
              : "Multiple files allowed"}
          </span>
        </div>

        {documents.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {documents.map((doc, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <FileTypeIcon type={doc.type} />
                  <div className="grid min-w-0">
                    <p className="truncate text-sm font-medium">{doc.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {formatBytes(doc.size)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {media.isPreviewable(doc.type) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Preview ${doc.name}`}
                      onClick={() =>
                        media.openPreview(doc.url, doc.name, doc.type)
                      }
                    >
                      <Eye aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    size="icon"
                    aria-label={`Delete ${doc.name}`}
                    onClick={() => media.handleDeleteDocument(doc.url)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </FormGroup>
    </StepSection>
  );
}
