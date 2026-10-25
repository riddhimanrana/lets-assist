import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";

import type { OrganizationCalendarSyncResult } from "./calendar-sync";
import {
  ORGANIZATION_SYNC_MAX_BATCH,
  organizationSyncBatchLimit,
  readOrganizationSyncBatch,
  type OrganizationSyncBatch,
} from "./sync-batch";

/**
 * Every organization calendar syncs on this interval. The database applies
 * it: an organization is due when it last synced this long before the run
 * started, or never.
 */
export const ORGANIZATION_CALENDAR_SYNC_INTERVAL_MINUTES = 60;
/** The most organizations the database hands one run. */
export const ORGANIZATION_CALENDAR_SYNC_MAX_BATCH = ORGANIZATION_SYNC_MAX_BATCH;

export type CalendarSyncRunResult =
  | {
      organizationId: string;
      success: true;
      createdCount?: number;
      updatedCount?: number;
      removedCount?: number;
    }
  | { organizationId: string; success: false; error: string };

export type CalendarSyncRunBody = {
  processed: number;
  results: CalendarSyncRunResult[];
  /** Due organizations this run did not attempt. Zero when that is unknown. */
  deferredOrganizations: number;
  /** True only when the database gave an exact count of due organizations. */
  discoveryCounted: boolean;
  /** True when the due organizations could not be read or made no sense. */
  discoveryIncomplete: boolean;
};

export type CalendarSyncRun = {
  status: 200 | 500 | 503;
  body: CalendarSyncRunBody;
};

/** The one database call this module makes. */
export type CalendarSyncQueueClient = {
  rpc: (
    name: "claim_organization_calendar_sync_batch",
    args: { p_limit: number; p_run_started_at: string },
  ) => PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal: (
      signal: AbortSignal,
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

export type CalendarSyncQueueOptions = {
  supabase: CalendarSyncQueueClient;
  sync: (
    organizationId: string,
    options: { signal: AbortSignal },
  ) => Promise<OrganizationCalendarSyncResult>;
  limits: {
    maxOrganizations: number;
    concurrency: number;
    /** No query runs and no organization starts after this much of the run. */
    runBudgetMs: number;
    /** No organization starts with less than this much of the run left. */
    minimumStartBudgetMs: number;
    organizationBudgetMs: number;
    /** How long a slot waits for timed-out work to end before it is reused. */
    settleGraceMs: number;
  };
  /** Called with a failure the sync threw rather than returned. */
  onThrown?: (organizationId: string, error: unknown) => void;
  now?: () => number;
  /** Schedules a callback and returns its cancel function. */
  setTimer?: (callback: () => void, delayMs: number) => () => void;
};

const TIMED_OUT = Symbol("organization budget spent");

const defaultSetTimer = (callback: () => void, delayMs: number) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/**
 * Runs one bounded pass over the organizations whose calendar sync is due.
 *
 * One database call counts the due organizations exactly and selects this
 * run's batch from the same snapshot. The batch continues in organization id
 * order from where the last one ended and wraps around. That position is
 * saved when the batch is selected, whatever the syncs then do, so
 * organizations that keep failing cannot hold the front of every run. At
 * most `maxOrganizations` are attempted. Everything else that was due is
 * reported as deferred. An answer that could not be read, or that does not
 * add up, is an incomplete inventory with no count, never an empty queue.
 */
export async function runOrganizationCalendarSyncQueue({
  supabase,
  sync,
  limits,
  onThrown,
  now = Date.now,
  setTimer = defaultSetTimer,
}: CalendarSyncQueueOptions): Promise<CalendarSyncRun> {
  const startedAt = now();
  const run = new AbortController();
  const cancelRunTimer = setTimer(() => run.abort(), limits.runBudgetMs);
  const limit = organizationSyncBatchLimit(limits.maxOrganizations);
  // The inventory is unknown. No number of waiting organizations is invented.
  const unread: CalendarSyncRun = {
    status: 500,
    body: {
      processed: 0,
      results: [],
      deferredOrganizations: 0,
      discoveryCounted: false,
      discoveryIncomplete: true,
    },
  };

  try {
    let batch: OrganizationSyncBatch | null;
    try {
      const answer = await supabase
        .rpc("claim_organization_calendar_sync_batch", {
          p_limit: limit,
          p_run_started_at: new Date(startedAt).toISOString(),
        })
        .abortSignal(run.signal);
      batch = answer.error
        ? null
        : readOrganizationSyncBatch(answer.data, limit);
    } catch {
      batch = null;
    }
    if (!batch) return unread;
    const { dueCount, organizationIds } = batch;
    if (dueCount === 0) {
      return {
        status: 200,
        body: {
          processed: 0,
          results: [],
          deferredOrganizations: 0,
          discoveryCounted: true,
          discoveryIncomplete: false,
        },
      };
    }

    const attempt = async (
      organizationId: string,
      signal: AbortSignal,
    ): Promise<CalendarSyncRunResult> => {
      try {
        const result = await sync(organizationId, { signal });
        return result.success
          ? {
              organizationId,
              success: true,
              createdCount: result.createdCount,
              updatedCount: result.updatedCount,
              removedCount: result.removedCount,
            }
          : {
              organizationId,
              success: false,
              error: result.error || "Unknown error",
            };
      } catch (error) {
        onThrown?.(organizationId, error);
        return {
          organizationId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    };

    const outcomes = await mapWithConcurrency(
      organizationIds,
      limits.concurrency,
      async (organizationId): Promise<CalendarSyncRunResult | null> => {
        const remaining = limits.runBudgetMs - (now() - startedAt);
        // Too little of the run is left to start another organization.
        if (run.signal.aborted || remaining < limits.minimumStartBudgetMs)
          return null;

        const deadline = new AbortController();
        let cancelGrace = () => {};
        const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
          deadline.signal.addEventListener("abort", () => resolve(TIMED_OUT), {
            once: true,
          });
        });
        const cancelDeadline = setTimer(
          () => deadline.abort(),
          Math.min(limits.organizationBudgetMs, remaining),
        );
        // The slot stays taken until this organization's work has ended or
        // the grace has passed, so a timed-out sync is not left running
        // beside the next one for longer than that.
        const work = attempt(organizationId, deadline.signal);
        try {
          const first = await Promise.race([work, timedOut]);
          if (first !== TIMED_OUT) return first;
          await Promise.race([
            work,
            new Promise<void>((resolve) => {
              cancelGrace = setTimer(resolve, limits.settleGraceMs);
            }),
          ]);
          return {
            organizationId,
            success: false,
            // Stopping starts nothing new. It does not undo a request that
            // Google had already received.
            error:
              "The sync took too long and was stopped. Saved progress continues on the next run.",
          };
        } finally {
          cancelDeadline();
          cancelGrace();
        }
      },
    );
    const results = outcomes.filter(
      (outcome): outcome is CalendarSyncRunResult => outcome !== null,
    );
    // Everything due at the start that was not attempted: past the cap, or
    // not started because the run was near its deadline.
    const deferredOrganizations = Math.max(0, dueCount - results.length);
    return {
      status:
        deferredOrganizations > 0 || results.some((result) => !result.success)
          ? 503
          : 200,
      body: {
        processed: results.length,
        results,
        deferredOrganizations,
        discoveryCounted: true,
        discoveryIncomplete: false,
      },
    };
  } finally {
    cancelRunTimer();
  }
}
