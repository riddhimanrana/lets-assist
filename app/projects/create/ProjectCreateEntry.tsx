"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProjectCreator, { type ProjectCreatorProps } from "./ProjectCreator";
import { readImportPreview } from "@/lib/signupgenius/handoff";
import { importPreviewToDraft } from "@/lib/signupgenius/model";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { TEXT_LINK_CLASS } from "@/lib/text-link";
import type { EventFormState } from "@/hooks/use-event-form";

function ImportedProjectCreator({
  importId,
  ...props
}: ProjectCreatorProps & { importId: string }) {
  const [draft, setDraft] = useState<Partial<EventFormState> | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const preview = readImportPreview(window.sessionStorage, importId);
      setDraft(
        preview
          ? importPreviewToDraft(preview, props.initialOrgId ?? null)
          : null,
      );
    } catch {
      setDraft(null);
    }
    setLoaded(true);
  }, [importId, props.initialOrgId]);
  if (!loaded) return <p role="status">Opening your imported preview…</p>;
  if (!draft)
    return (
      <Alert variant="warning">
        <AlertTitle>Your import preview is unavailable</AlertTitle>
        <AlertDescription>
          It may have expired or been opened in another browser tab.{" "}
          <Link href="/tools/signupgenius" className={TEXT_LINK_CLASS}>
            Return to the importer
          </Link>{" "}
          to try again.
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="space-y-5">
      <Alert variant="info">
        <AlertTitle>Review your imported event</AlertTitle>
        <AlertDescription>
          Verify the original dates and timezone, and review each step before
          creating a project. Existing signups have not been imported.
        </AlertDescription>
      </Alert>
      <ProjectCreator {...props} initialDraftData={draft} />
    </div>
  );
}

export default function ProjectCreateEntry({
  importId,
  ...props
}: ProjectCreatorProps & { importId?: string }) {
  return importId && !props.initialDraftId ? (
    <ImportedProjectCreator
      key={`${importId}:${props.initialOrgId ?? "personal"}`}
      {...props}
      importId={importId}
    />
  ) : (
    <ProjectCreator {...props} />
  );
}
