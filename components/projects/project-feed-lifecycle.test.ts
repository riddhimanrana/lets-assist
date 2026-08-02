import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  observeProjectFeedPageLifecycle,
  PROJECT_FEED_TEARDOWN_ABORT_REASON,
  shouldReportProjectFeedFailure,
} from "./project-feed-lifecycle";

class PageTransition extends Event {
  readonly persisted: boolean;

  constructor(type: "pagehide" | "pageshow", persisted = false) {
    super(type);
    this.persisted = persisted;
  }
}

type ProbeResponse = { ok: boolean; status: number; payload?: unknown[] };

type FetchAttempt = {
  signal: AbortSignal;
  resolve: (response: ProbeResponse) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
};

/**
 * A minimal stand-in for the feed's request routine that consumes the same two
 * lifecycle helpers `ProjectsInfiniteScroll` consumes. The browser cancels an
 * in-flight request during a cross-document navigation with a plain
 * `TypeError: Failed to fetch` rather than an `AbortError`, so this probe
 * rejects the same way: classification must come from the feed's own abort and
 * teardown state, never from the rejection's shape.
 */
function createFeedProbe() {
  const attempts: FetchAttempt[] = [];
  const logged: unknown[] = [];
  const abortedAtRejection: boolean[] = [];

  let activeRequest: AbortController | null = null;
  let latestRequestId = 0;
  let pageTearingDown = false;
  let loading = true;
  let renderedError: string | null = null;

  function load(): Promise<void> {
    const requestId = ++latestRequestId;
    activeRequest?.abort();
    pageTearingDown = false;
    const controller = new AbortController();
    activeRequest = controller;

    renderedError = null;
    loading = true;

    const attempt: FetchAttempt = {
      signal: controller.signal,
      resolve: () => {},
      reject: () => {},
      settled: false,
    };
    const pending = new Promise<ProbeResponse>((resolve, reject) => {
      attempt.resolve = (response) => {
        attempt.settled = true;
        resolve(response);
      };
      attempt.reject = (reason) => {
        attempt.settled = true;
        reject(reason);
      };
    });
    controller.signal.addEventListener("abort", () => {
      if (attempt.settled) return;
      // Mirrors Chromium's net::ERR_ABORTED surface for a cancelled fetch.
      attempt.reject(new TypeError("Failed to fetch"));
    });
    attempts.push(attempt);

    return (async () => {
      try {
        const response = await pending;
        if (!response.ok) {
          throw new Error(`Failed to load projects (${response.status})`);
        }
      } catch (fetchError) {
        abortedAtRejection.push(controller.signal.aborted);
        if (
          !shouldReportProjectFeedFailure({
            signalAborted: controller.signal.aborted,
            pageTearingDown,
            isLatestRequest: requestId === latestRequestId,
          })
        ) {
          return;
        }

        logged.push(fetchError);
        renderedError =
          fetchError instanceof Error ? fetchError.message : "Failed to load projects";
      } finally {
        if (activeRequest === controller) {
          activeRequest = null;
        }
        if (requestId === latestRequestId) {
          loading = false;
        }
      }
    })();
  }

  const target = new EventTarget();
  const unobserve = observeProjectFeedPageLifecycle({
    target,
    getActiveRequest: () => activeRequest,
    onTeardown: () => {
      pageTearingDown = true;
      latestRequestId += 1;
      activeRequest = null;
    },
    onPersistedRestore: () => {
      pageTearingDown = false;
      void load();
    },
  });

  return {
    attempts,
    logged,
    abortedAtRejection,
    load,
    unobserve,
    dispatch: (type: "pagehide" | "pageshow", persisted = false) =>
      target.dispatchEvent(new PageTransition(type, persisted)),
    state: () => ({ loading, renderedError }),
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("project feed page lifecycle", () => {
  test("aborts the in-flight request on page teardown before its rejection is logged", async () => {
    const probe = createFeedProbe();
    const inFlight = probe.load();

    expect(probe.attempts).toHaveLength(1);
    expect(probe.attempts[0].signal.aborted).toBe(false);

    probe.dispatch("pagehide");

    expect(probe.attempts[0].signal.aborted).toBe(true);
    // The feed owns the cancellation; it is not the browser's opaque teardown.
    expect(probe.attempts[0].signal.reason).toBe(
      PROJECT_FEED_TEARDOWN_ABORT_REASON,
    );
    await inFlight;

    // The rejection was observed only after the feed had already aborted, so it
    // is lifecycle noise and never reaches the console or the error state.
    expect(probe.abortedAtRejection).toEqual([true]);
    expect(probe.logged).toEqual([]);
    expect(probe.state().renderedError).toBeNull();
  });

  test("a persisted pageshow refetches after a bfcache pagehide", async () => {
    const probe = createFeedProbe();
    const inFlight = probe.load();

    probe.dispatch("pagehide", true);
    await inFlight;

    expect(probe.attempts).toHaveLength(1);
    expect(probe.state().loading).toBe(true);

    probe.dispatch("pageshow", true);

    expect(probe.attempts).toHaveLength(2);
    expect(probe.attempts[1].signal.aborted).toBe(false);

    probe.attempts[1].resolve({ ok: true, status: 200, payload: [] });
    await flush();

    expect(probe.logged).toEqual([]);
    expect(probe.state()).toEqual({ loading: false, renderedError: null });
  });

  test("a fresh, non-persisted pageshow does not duplicate the mount request", async () => {
    const probe = createFeedProbe();
    const inFlight = probe.load();

    probe.dispatch("pageshow", false);
    expect(probe.attempts).toHaveLength(1);

    probe.attempts[0].resolve({ ok: true, status: 200, payload: [] });
    await inFlight;
    expect(probe.logged).toEqual([]);
  });

  test("a genuine in-page network failure stays logged and visible", async () => {
    const probe = createFeedProbe();
    const inFlight = probe.load();

    probe.attempts[0].reject(new TypeError("Failed to fetch"));
    await inFlight;

    expect(probe.abortedAtRejection).toEqual([false]);
    expect(probe.logged).toHaveLength(1);
    expect(probe.state()).toEqual({
      loading: false,
      renderedError: "Failed to fetch",
    });
  });

  test("a genuine HTTP failure stays logged and visible", async () => {
    const probe = createFeedProbe();
    const inFlight = probe.load();

    probe.attempts[0].resolve({ ok: false, status: 503 });
    await inFlight;

    expect(probe.logged).toHaveLength(1);
    expect(probe.state().renderedError).toBe("Failed to load projects (503)");
  });

  test("stops aborting once the observer is removed", async () => {
    const probe = createFeedProbe();
    const inFlight = probe.load();

    probe.unobserve();
    probe.dispatch("pagehide");

    expect(probe.attempts[0].signal.aborted).toBe(false);

    probe.attempts[0].reject(new TypeError("Failed to fetch"));
    await inFlight;
    expect(probe.logged).toHaveLength(1);
  });
});

describe("project feed failure classification", () => {
  test("suppresses only aborted, torn-down, or superseded requests", () => {
    expect(
      shouldReportProjectFeedFailure({
        signalAborted: false,
        pageTearingDown: false,
        isLatestRequest: true,
      }),
    ).toBe(true);
    expect(
      shouldReportProjectFeedFailure({
        signalAborted: true,
        pageTearingDown: false,
        isLatestRequest: true,
      }),
    ).toBe(false);
    expect(
      shouldReportProjectFeedFailure({
        signalAborted: false,
        pageTearingDown: true,
        isLatestRequest: true,
      }),
    ).toBe(false);
    expect(
      shouldReportProjectFeedFailure({
        signalAborted: false,
        pageTearingDown: false,
        isLatestRequest: false,
      }),
    ).toBe(false);
  });
});

describe("project feed component wiring", () => {
  const source = readFileSync(
    new URL("./ProjectsInfiniteScroll.tsx", import.meta.url),
    "utf8",
  );

  test("routes every feed rejection through the shared classifier", () => {
    expect(source).toContain("shouldReportProjectFeedFailure({");
    expect(source).toContain("signalAborted: abortController.signal.aborted,");
    expect(source).toContain("pageTearingDown: pageTeardownRef.current,");
    expect(source).toContain(
      "isLatestRequest: requestId === latestRequestIdRef.current,",
    );
    // The bare abort check can no longer stand alone; a browser-cancelled fetch
    // leaves the controller untouched.
    expect(source).not.toContain("if (abortController.signal.aborted) {");
  });

  test("observes document teardown and bfcache restore", () => {
    expect(source).toContain("observeProjectFeedPageLifecycle({");
    expect(source).toContain("target: window,");
    expect(source).toContain(
      "getActiveRequest: () => activeRequestAbortRef.current,",
    );
    expect(source).toContain("pageTeardownRef.current = true;");
    expect(source).toContain('void fetchProjectsPage(0, "replace");');
  });
});
