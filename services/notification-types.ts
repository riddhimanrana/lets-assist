/**
 * Notification shapes shared by the browser service and the server service.
 *
 * These live apart from either implementation so a server-only module can
 * describe a notification without importing the browser service, which pulls in
 * the browser Supabase client and sonner.
 */

export type NotificationType =
  | "email_notifications"
  | "project_updates"
  | "general";

export type NotificationSeverity = "info" | "warning" | "success";

export interface NotificationData {
  title: string;
  body: string;
  type: NotificationType;
  severity?: NotificationSeverity;
  actionUrl?: string;
  data?: Record<string, unknown>;
}
