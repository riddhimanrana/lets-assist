/** Use event metadata already stored with the recipient's notification. */
export function notificationActionLabel(
  data?: Record<string, unknown> | null,
): string {
  if (data?.pluginKey !== "dvhs-csf") return "Open link";
  switch (data.sourceKind) {
    case "post":
      return "View post";
    case "activity":
      return "View activity";
    case "point_submission":
      return "View point submission";
    case "profile":
      return "View My CSF";
    default:
      return "Open link";
  }
}
