"use client";

import { useEffect, useRef, useState } from "react";

import type { EventFormState } from "@/hooks/use-event-form";

import { autoSaveDraft } from "./actions";
import type { AutosaveStatus } from "./CreateActionBar";

/**
 * Debounced, change-based autosave of the create form to a draft row. Moved
 * out of ProjectCreator unchanged; the submit path still clears the timer and
 * the tracked draft id through the values returned here.
 */
export function useDraftAutosave({
  state,
  stateSnapshot,
  initialDraftId,
  isSubmitting,
  isSavingDraft,
  getDraftSafeState,
}: {
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

    // Update previous state reference
    previousStateRef.current = stateSnapshot;

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    // Debounce autosave by 3 seconds
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setAutosaveStatus("saving");

        const result = await autoSaveDraft(
          getDraftSafeState(),
          autosaveDraftId,
        );

        if (result.autosaved && result.id) {
          // Set the draft ID if this is the first autosave
          if (!autosaveDraftId) {
            setAutosaveDraftId(result.id);
          }

          setAutosaveStatus("saved");
          setLastAutosaveTime(new Date());

          // Clear saved status after 3 seconds
          setTimeout(() => {
            setAutosaveStatus((prev) => (prev === "saved" ? "idle" : prev));
          }, 3000);
        } else if (result.error) {
          setAutosaveStatus("error");
          console.warn("Autosave error:", result.error);

          // Clear error status after 5 seconds
          setTimeout(() => {
            setAutosaveStatus((prev) => (prev === "error" ? "idle" : prev));
          }, 5000);
        }
      } catch (err) {
        console.error("Failed to autosave draft", err);
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
