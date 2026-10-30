"use client";

import { useEffect, useRef } from "react";

import { safeConsole } from "@/lib/safe-console";

export const AUTO_LINK_SUCCESS_MESSAGE =
  "Account linked. Your signups are now in your Let's Assist account.";
export const AUTO_LINK_FAILURE_MESSAGE =
  "Failed to link account automatically. You can still finish linking below.";

type AutoLinkDeps = {
  getUser: () => Promise<{ id: string } | null>;
  link: (
    anonymousId: string,
    anonymousToken: string,
  ) => Promise<{ error?: string }>;
};

/**
 * After a guest returns signed in with `link=1`, link this profile to that
 * account once.
 *
 * The attempt is owned by a ref keyed to the profile and token, not by state
 * in the effect's own dependencies, so starting it never cleans itself up.
 * Each effect run has its own `ignore` flag (React's documented pattern for
 * async effects): a run that was cleaned up, or a scope the page has left,
 * never starts the link write and never updates the page. A cleanup after
 * the write was sent only stops local updates; it does not undo the server
 * result.
 */
export function useAnonymousAutoLink({
  anonymousId,
  anonymousToken,
  enabled,
  deps,
  onLinked,
  onError,
}: {
  anonymousId: string;
  anonymousToken: string;
  /** `link=1` is present and the profile is not linked yet. */
  enabled: boolean;
  deps: AutoLinkDeps;
  onLinked: () => void;
  onError: (message: string) => void;
}) {
  const attemptedScope = useRef<string | null>(null);
  // Callbacks are read at call time so a new closure never restarts the run.
  const latest = useRef({ deps, onLinked, onError });
  latest.current = { deps, onLinked, onError };

  useEffect(() => {
    const scope = `${anonymousId}\u0000${anonymousToken}`;
    if (!enabled || attemptedScope.current === scope) return;
    attemptedScope.current = scope;
    let ignore = false;
    let sent = false;

    const run = async () => {
      try {
        const user = await latest.current.deps.getUser();
        // Not signed in, or this run was cleaned up before the write.
        if (!user || ignore) return;
        sent = true;
        const result = await latest.current.deps.link(
          anonymousId,
          anonymousToken,
        );
        if (ignore) return;
        if (result.error) {
          latest.current.onError(result.error);
          return;
        }
        latest.current.onLinked();
      } catch (error) {
        safeConsole.error("Error auto-linking account:", error);
        if (!ignore) latest.current.onError(AUTO_LINK_FAILURE_MESSAGE);
      }
    };
    void run();

    return () => {
      ignore = true;
      // Cleaned up before the write was sent (React StrictMode runs setup,
      // cleanup, setup): release the attempt so the next setup can make it.
      // Once sent, the attempt stays used, so the link is never sent twice.
      if (!sent && attemptedScope.current === scope) {
        attemptedScope.current = null;
      }
    };
  }, [anonymousId, anonymousToken, enabled]);
}
