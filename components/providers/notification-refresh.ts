/** Combine realtime row bursts into one refresh without overlapping reads. */
export function createNotificationRefreshScheduler(
  refresh: () => Promise<void>,
  delayMs = 100,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let disposed = false;

  const schedule = () => {
    if (disposed) return;
    pending = true;
    if (timer !== null || running) return;
    timer = setTimeout(async () => {
      timer = null;
      if (disposed) return;
      pending = false;
      running = true;
      try {
        await refresh();
      } finally {
        running = false;
        if (pending && !disposed) schedule();
      }
    }, delayMs);
  };

  return {
    schedule,
    dispose() {
      disposed = true;
      pending = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
