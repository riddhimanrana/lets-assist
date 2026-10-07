"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { EventFormState } from "@/hooks/use-event-form";

/** Hydrates the form from a saved draft once. Moved out of ProjectCreator unchanged. */
export function useRestoreDraft(
  initialDraftData: Partial<EventFormState> | undefined,
  loadDraftState: (draft: Partial<EventFormState>) => void,
) {
  // Load draft data on mount if provided
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    // Guard to prevent infinite update loops when hydrating draft state
    if (initialDraftData && loadDraftState && !draftLoadedRef.current) {
      draftLoadedRef.current = true;
      loadDraftState(initialDraftData);
      // Show success toast after a brief delay to ensure UI is ready
      setTimeout(() => {
        toast.success("Draft restored!", {
          description:
            "Your previous progress has been loaded. Continue where you left off!",
        });
      }, 500);
    }
  }, [initialDraftData, loadDraftState]);
}

/**
 * Whether to remind the user that a restored draft kept its waiver setup but
 * not the PDF itself. Moved out of ProjectCreator unchanged.
 */
export function useWaiverReuploadNotice(
  initialDraftData: Partial<EventFormState> | undefined,
  state: EventFormState,
) {
  const shouldPromptWaiverReuploadFromDraft = useMemo(
    () =>
      Boolean(
        initialDraftData?.waiverRequired &&
        (initialDraftData?.waiverDefinition ||
          initialDraftData?.detectedFields ||
          initialDraftData?.waiverPdfFile ||
          initialDraftData?.waiverPdfUrl ||
          initialDraftData?.waiverPdfValidation),
      ),
    [initialDraftData],
  );
  const [showWaiverReuploadNotice, setShowWaiverReuploadNotice] = useState(
    shouldPromptWaiverReuploadFromDraft,
  );

  useEffect(() => {
    if (shouldPromptWaiverReuploadFromDraft) {
      setShowWaiverReuploadNotice(true);
    }
  }, [shouldPromptWaiverReuploadFromDraft]);

  useEffect(() => {
    if (state.waiverPdfFile || state.waiverPdfUrl) {
      setShowWaiverReuploadNotice(false);
    }
  }, [state.waiverPdfFile, state.waiverPdfUrl]);

  return showWaiverReuploadNotice;
}
