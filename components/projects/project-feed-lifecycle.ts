/**
 * Page-lifecycle handling for the public project feed.
 *
 * React effect cleanup does not run when the browser tears the document down,
 * so a cross-document navigation away from the feed leaves the in-flight
 * `/api/projects` request to be cancelled by the browser. That cancellation
 * surfaces as a plain `TypeError: Failed to fetch` on a controller that was
 * never aborted, which is indistinguishable from a real outage unless the feed
 * aborts the request itself first.
 *
 * These helpers make that cancellation intentional: `pagehide` aborts the
 * active request, teardown-aborted rejections are ignored, and a page restored
 * from the back-forward cache starts a fresh request instead of resurrecting a
 * stalled one.
 */

export const PROJECT_FEED_TEARDOWN_ABORT_REASON = "project-feed:page-teardown";

export type PageLifecycleTarget = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export type ProjectFeedPageLifecycleOptions = {
  target: PageLifecycleTarget;
  /** The controller for the request currently in flight, if any. */
  getActiveRequest: () => AbortController | null;
  /** Called once the active request has been aborted for page teardown. */
  onTeardown: () => void;
  /** Called when a persisted page is restored from the back-forward cache. */
  onPersistedRestore: () => void;
};

/**
 * Abort the active feed request on document teardown and refetch when a
 * persisted page comes back. Returns an unsubscribe function.
 */
export function observeProjectFeedPageLifecycle({
  target,
  getActiveRequest,
  onTeardown,
  onPersistedRestore,
}: ProjectFeedPageLifecycleOptions): () => void {
  const handlePageHide = () => {
    getActiveRequest()?.abort(PROJECT_FEED_TEARDOWN_ABORT_REASON);
    onTeardown();
  };

  const handlePageShow = (event: Event) => {
    // A non-persisted `pageshow` belongs to a freshly parsed document, which
    // mounts the feed and fetches on its own. Only a bfcache restore reuses the
    // frozen state whose request we already aborted.
    if (!(event as PageTransitionEvent).persisted) return;
    onPersistedRestore();
  };

  target.addEventListener("pagehide", handlePageHide);
  target.addEventListener("pageshow", handlePageShow);

  return () => {
    target.removeEventListener("pagehide", handlePageHide);
    target.removeEventListener("pageshow", handlePageShow);
  };
}

export type ProjectFeedFailureContext = {
  /** Whether the request's own controller was aborted. */
  signalAborted: boolean;
  /** Whether the document has begun tearing down or is frozen. */
  pageTearingDown: boolean;
  /** Whether this request is still the newest one the feed issued. */
  isLatestRequest: boolean;
};

/**
 * Decide whether a rejected feed request is a product failure worth logging and
 * surfacing, or lifecycle noise that must stay invisible.
 */
export function shouldReportProjectFeedFailure({
  signalAborted,
  pageTearingDown,
  isLatestRequest,
}: ProjectFeedFailureContext): boolean {
  if (signalAborted || pageTearingDown) return false;
  return isLatestRequest;
}
