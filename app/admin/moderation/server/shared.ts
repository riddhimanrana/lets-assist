import "server-only";

export function deriveSeverity(confidence: number | string | null | undefined) {
  const value =
    typeof confidence === "string" ? Number(confidence) : (confidence ?? 0);
  if (value >= 0.85) return "critical";
  if (value >= 0.7) return "high";
  if (value >= 0.4) return "medium";
  return "low";
}
