/**
 * Delays an irreversible action behind a visible countdown that can be
 * cancelled at any point before it commits.
 *
 * Every run owns a token. `cancel` retires the token and clears the pending
 * timer, and each timer callback compares its token again immediately before
 * it ticks or commits, so a callback that was already queued when the user
 * backed out can never reach `commit`.
 */
export function createDeletionCountdown(options: {
  seconds: number;
  schedule: (callback: () => void, milliseconds: number) => unknown;
  cancel: (handle: unknown) => void;
  onTick: (remainingSeconds: number) => void;
  commit: () => void;
}) {
  let activeRun: object | null = null;
  let timer: unknown;

  const clear = () => {
    if (timer !== undefined) options.cancel(timer);
    timer = undefined;
  };

  return {
    /** Starts a fresh countdown. Returns false while one is already running. */
    start(): boolean {
      if (activeRun) return false;
      const run = {};
      activeRun = run;
      let remaining = options.seconds;
      options.onTick(remaining);

      const tick = () => {
        timer = undefined;
        if (activeRun !== run) return;
        remaining -= 1;
        options.onTick(remaining);
        if (remaining > 0) {
          timer = options.schedule(tick, 1000);
          return;
        }
        // Last check before the irreversible call.
        if (activeRun !== run) return;
        activeRun = null;
        options.commit();
      };
      timer = options.schedule(tick, 1000);
      return true;
    },
    /** Stops the countdown. Safe to call when nothing is running. */
    cancel(): void {
      activeRun = null;
      clear();
    },
    isCounting(): boolean {
      return activeRun !== null;
    },
  };
}

export type DeletionCountdown = ReturnType<typeof createDeletionCountdown>;
