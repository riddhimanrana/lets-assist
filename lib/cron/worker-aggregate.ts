export function workerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_response");
  return value as Record<string, unknown>;
}

export function workerCount(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 1_000_000
  )
    throw new Error("invalid_response");
  return Number(value);
}

export function workerSum(...values: unknown[]) {
  return workerCount(
    values.reduce<number>((total, value) => total + workerCount(value), 0),
  );
}

export function workerArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1_000_000)
    throw new Error("invalid_response");
  return value;
}
