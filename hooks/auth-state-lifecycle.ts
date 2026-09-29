type AuthStateLifecycleOptions<T> = {
  resolve: (isCurrent: () => boolean) => Promise<T>;
  onStart: () => void;
  onResolved: (value: T) => void;
  onSignedOut: () => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
};

export function createAuthStateLifecycle<T>(
  options: AuthStateLifecycleOptions<T>,
) {
  let revision = 0;
  let disposed = false;
  let scheduled: ReturnType<typeof setTimeout> | undefined;

  const invalidate = () => {
    revision++;
    if (scheduled !== undefined) clearTimeout(scheduled);
    scheduled = undefined;
  };

  return {
    refresh(defer = false) {
      if (disposed) return;
      invalidate();
      const requestRevision = revision;
      const isCurrent = () => !disposed && revision === requestRevision;
      options.onStart();
      const run = async () => {
        if (!isCurrent()) return;
        try {
          const value = await options.resolve(isCurrent);
          if (isCurrent()) options.onResolved(value);
        } catch (error) {
          if (isCurrent()) options.onError(error);
        } finally {
          if (isCurrent()) options.onSettled();
        }
      };
      if (!defer) return run();
      scheduled = setTimeout(() => {
        scheduled = undefined;
        void run();
      }, 0);
    },
    signedOut() {
      if (disposed) return;
      invalidate();
      options.onSignedOut();
      options.onSettled();
    },
    dispose() {
      disposed = true;
      invalidate();
    },
  };
}
