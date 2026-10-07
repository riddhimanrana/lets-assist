"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createProjectDraftSession } from "@/lib/projects/draft-session";
import {
  projectAttemptStorage,
  projectCreationUrl,
} from "@/lib/projects/creation-session";
import { autoSaveDraft, deleteDraft, saveProjectAsNewDraft } from "./actions";

export function useCreationSession(
  creationSessionId: string,
  initialDraftId?: string | null,
) {
  const mounted = useRef(false);
  const [draftSession] = useState(() =>
    createProjectDraftSession(initialDraftId || undefined, {
      save: autoSaveDraft,
      copy: async (data) => {
        const formData = new FormData();
        formData.append("projectData", JSON.stringify(data));
        return saveProjectAsNewDraft(formData);
      },
      remove: deleteDraft,
    }),
  );
  const updateDraftUrl = useCallback(
    (draftId?: string, initialize = false) => {
      const url = new URL(window.location.href);
      if (
        !mounted.current ||
        url.pathname !== "/projects/create" ||
        (!initialize && url.searchParams.get("creation") !== creationSessionId)
      )
        return;
      window.history.replaceState(
        null,
        "",
        projectCreationUrl(window.location.href, creationSessionId, draftId),
      );
    },
    [creationSessionId],
  );
  useEffect(() => {
    mounted.current = true;
    updateDraftUrl(undefined, true);
    return () => {
      mounted.current = false;
    };
  }, [updateDraftUrl]);
  const attemptStorage = () => {
    try {
      return projectAttemptStorage(
        window.localStorage,
        creationSessionId,
        draftSession.id,
      );
    } catch {
      return null;
    }
  };
  return { draftSession, updateDraftUrl, attemptStorage };
}
