/**
 * Status tones for admin badges. Statuses are flat tints (success, warning,
 * info, destructive). A closed, neutral state has no tint of its own, so it
 * falls back to the quiet outline label.
 */
export type AdminStatusTone =
  "success" | "warning" | "info" | "destructive" | "outline";

const STATUS_TONES: Record<string, AdminStatusTone> = {
  pending: "warning",
  under_review: "info",
  migration_pending: "info",
  resolved: "success",
  approved: "success",
  active: "success",
  confirmed: "info",
  flagged: "destructive",
  blocked: "destructive",
  denied: "destructive",
  banned: "destructive",
  dismissed: "outline",
  archived: "outline",
  inactive: "outline",
};

export function statusTone(status?: string | null): AdminStatusTone {
  return STATUS_TONES[(status || "pending").toLowerCase()] ?? "outline";
}

/** Severity and priority share one scale: high is red, medium is amber. */
export function levelTone(level?: string | null): AdminStatusTone {
  switch ((level || "").toLowerCase()) {
    case "critical":
    case "high":
      return "destructive";
    case "medium":
      return "warning";
    default:
      return "outline";
  }
}

export function humanize(value?: string | null, fallback = "") {
  const text = (value || fallback).replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
