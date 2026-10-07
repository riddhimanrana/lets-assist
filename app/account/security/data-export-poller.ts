/** Coalesces reads and drops a response that predates a recorded request. */
export function createExportPoller<T>(options: {
  read: () => Promise<T>;
  apply: (value: T) => boolean;
  onError: () => void;
  visible: () => boolean;
  schedule: (callback: () => void, milliseconds: number) => unknown;
  cancel: (handle: unknown) => void;
}) {
  let stopped = false;
  let running = false;
  let queued = false;
  let generation = 0;
  let timer: unknown;
  const clear = () => {
    if (timer !== undefined) options.cancel(timer);
    timer = undefined;
  };
  const refresh = async (): Promise<void> => {
    clear();
    if (stopped || !options.visible()) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    const current = generation;
    let poll = false;
    try {
      const value = await options.read();
      if (!stopped && current === generation) poll = options.apply(value);
    } catch {
      if (!stopped && current === generation) options.onError();
    } finally {
      running = false;
      if (!stopped && options.visible()) {
        if (queued || current !== generation) {
          queued = false;
          void refresh();
        } else if (poll) {
          timer = options.schedule(() => {
            timer = undefined;
            void refresh();
          }, 10_000);
        }
      }
    }
  };
  return {
    refresh,
    invalidate: () => {
      generation += 1;
      void refresh();
    },
    visibilityChanged: () => {
      clear();
      if (options.visible()) {
        generation += 1;
        void refresh();
      }
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
}
