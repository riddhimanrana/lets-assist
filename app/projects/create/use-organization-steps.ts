"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import type { EventFormState } from "@/hooks/use-event-form";
import type { createProjectDraftSession } from "@/lib/projects/draft-session";

/**
 * Reloads the organization's own create steps when "Create project as"
 * changes.
 *
 * The steps are resolved on the server: from the saved draft's organization
 * when the project has a draft, otherwise from the `org` query parameter. So a
 * change saves the draft first when there is one, then replaces the URL with
 * the same creation session. The session id keys the editor, which keeps
 * everything already typed while the server sends the new steps.
 */
export function useOrganizationSteps({
  organizationId,
  resolvedOrganizationId,
  creationSessionId,
  draftSession,
  getDraftSafeState,
}: {
  /** The organization selected in the form, or null for a personal project. */
  organizationId: string | null;
  /** The organization the server resolved the current steps for. */
  resolvedOrganizationId: string | null;
  creationSessionId: string;
  draftSession: ReturnType<typeof createProjectDraftSession>;
  getDraftSafeState: () => Partial<EventFormState>;
}) {
  const router = useRouter();
  const resolvedRef = useRef(resolvedOrganizationId);
  const latestState = useRef(getDraftSafeState);

  useEffect(() => {
    latestState.current = getDraftSafeState;
  }, [getDraftSafeState]);

  useEffect(() => {
    if (organizationId === resolvedRef.current) return;
    resolvedRef.current = organizationId;

    let cancelled = false;
    void (async () => {
      if (draftSession.id) {
        await draftSession.save(latestState.current());
      }
      if (cancelled) return;

      const url = new URL(window.location.href);
      if (url.pathname !== "/projects/create") return;
      if (organizationId) url.searchParams.set("org", organizationId);
      else url.searchParams.delete("org");
      url.searchParams.set("creation", creationSessionId);
      if (draftSession.id) url.searchParams.set("draft", draftSession.id);
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, creationSessionId, draftSession, router]);
}
