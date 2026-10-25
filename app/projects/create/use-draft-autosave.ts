"use client";
import { safeConsole } from "@/lib/safe-console";

import { useEffect, useRef, useState } from "react";

import type { EventFormState } from "@/hooks/use-event-form";

import type { createProjectDraftSession } from "@/lib/projects/draft-session";
import type { AutosaveStatus } from "./CreateActionBar";

/**
 * Debounced, change-based autosave of the create form to a draft row. Moved
 * through the same serialized session used by copying and publication.
 */
export function useDraftAutosave({
  draftSession,
  updateDraftUrl,
  state,
  stateSnapshot,
  initialDraftId,
  isSubmitting,
  isSavingDraft,
  getDraftSafeState,
}: {
  draftSession: ReturnType<typeof createProjectDraftSession>;
  updateDraftUrl: (id?: string) => void;
  state: EventFormState;
  stateSnapshot: string;
  initialDraftId?: string | null;
  isSubmitting: boolean;
  isSavingDraft: boolean;
  getDraftSafeState: () => Partial<EventFormState>;
}) {
  // Autosave state - initialize with loaded draft ID if available
  const [autosaveDraftId, setAutosaveDraftId] = useState<string | undefined>(
    initialDraftId || undefined,
  );
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [_lastAutosaveTime, setLastAutosaveTime] = useState<Date | null>(null);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousStateRef = useRef<string>("");

  // Autosave to database on state changes (debounced and change-based)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!state) return;

    // Waiver-enabled projects currently can't be autosaved as drafts because the
    // draft payload intentionally strips file objects/URLs. Keep the workflow
    // explicit so users don't end up with incomplete drafts.
    if (state.waiverRequired) {
      return;
    }

    // Don't autosave while submitting/saving to avoid recreating drafts during publish flow
    if (isSubmitting || isSavingDraft) {
      return;
    }

    // Skip autosave if there's no title
    if (!state.basicInfo.title || state.basicInfo.title.trim() === "") {
      return;
    }

    // Only autosave if state has actually changed
    if (previousStateRef.current === stateSnapshot) {
      return;
    }

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    // Debounce autosave by 3 seconds
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setAutosaveStatus("saving");

        const result = await draftSession.save(getDraftSafeState());

        if (result.autosaved && result.id) {
          previousStateRef.current = stateSnapshot;
          setAutosaveDraftId(draftSession.id);
          updateDraftUrl(draftSession.id);

          setAutosaveStatus("saved");
          setLastAutosaveTime(new Date());

          // Clear saved status after 3 seconds
          setTimeout(() => {
            setAutosaveStatus((prev) => (prev === "saved" ? "idle" : prev));
          }, 3000);
        } else if (result.error) {
          setAutosaveStatus("error");
          safeConsole.warn("Autosave error:", result.error);

          // Clear error status after 5 seconds
          setTimeout(() => {
            setAutosaveStatus((prev) => (prev === "error" ? "idle" : prev));
          }, 5000);
        }
      } catch (err) {
        safeConsole.error("Failed to autosave draft", err);
        setAutosaveStatus("error");
        setTimeout(() => {
          setAutosaveStatus((prev) => (prev === "error" ? "idle" : prev));
        }, 5000);
      }
    }, 3000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    stateSnapshot,
    state,
    autosaveDraftId,
    isSubmitting,
    isSavingDraft,
    getDraftSafeState,
    draftSession,
    updateDraftUrl,
  ]);

  return {
    autosaveDraftId,
    setAutosaveDraftId,
    autosaveStatus,
    setAutosaveStatus,
    autosaveTimerRef,
    previousStateRef,
  };
}
