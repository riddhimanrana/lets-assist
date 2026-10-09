import { formatDistanceToNow } from "date-fns";

export type NotificationSeverity = "info" | "warning" | "success";

export type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  severity: NotificationSeverity;
  read: boolean;
  created_at: string;
  action_url?: string | null;
  data?: Record<string, unknown> | null;
};

export function formatTimeAgo(dateString: string) {
  try {
    const date = new Date(dateString);
    const formatted = formatDistanceToNow(date, { addSuffix: true });
    return formatted
      .replace(/about /g, "")
      .replace(/less than a minute ago/g, "just now")
      .replace(/ minutes? ago/g, "m ago")
      .replace(/ hours? ago/g, "h ago")
      .replace(/ days? ago/g, "d ago")
      .replace(/ weeks? ago/g, "w ago")
      .replace(/ months? ago/g, "mo ago")
      .replace(/ years? ago/g, "y ago");
  } catch {
    return "recently";
  }
}
