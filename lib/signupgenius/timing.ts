/** Explicit ISO minute-resolution timestamps only; never infer dates from prose. */
export function readSourceDateTime(input: unknown): {
  date: string;
  time: string;
  offset: string | null;
  instant: number | null;
} | null {
  if (typeof input !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::00(?:\.0{1,3})?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/u.exec(
      input,
    );
  if (!match) return null;
  const day = new Date(`${match[1]}T12:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== match[1]
  )
    return null;
  const offset =
    match[3] === "Z"
      ? "+00:00"
      : match[3] === "-00:00"
        ? null
        : (match[3] ?? null);
  if (offset?.startsWith("+14:") || offset?.startsWith("-14:")) {
    if (!offset.endsWith(":00")) return null;
  }
  return {
    date: match[1],
    time: match[2],
    offset,
    instant: offset ? Date.parse(`${match[1]}T${match[2]}:00${offset}`) : null,
  };
}
