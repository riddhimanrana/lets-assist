export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer");
  }

  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const noFailure = Symbol("no failure");
  const failures = new Array<unknown>(items.length).fill(noFailure);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        // Keep draining work that the caller already claimed. Returning as soon
        // as one mapper rejects can leave sibling side effects running after the
        // caller has torn down its timeout or request-scoped resources.
        failures[index] = error;
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const firstFailureIndex = failures.findIndex(
    (failure) => failure !== noFailure,
  );
  if (firstFailureIndex >= 0) throw failures[firstFailureIndex];
  return results;
}

export function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}
