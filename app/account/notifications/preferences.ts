export type NotificationPreferences = {
  email_notifications: boolean;
  project_updates: boolean;
  feedback_requests: boolean;
  organization_updates: boolean;
  general: boolean;
};

export function readNotificationPreferences(
  row: Record<string, unknown>,
): NotificationPreferences {
  return {
    email_notifications: row.email_notifications !== false,
    project_updates: row.project_updates !== false,
    feedback_requests:
      row.feedback_requests == null
        ? row.project_updates !== false
        : row.feedback_requests !== false,
    organization_updates: row.organization_updates !== false,
    general: row.general !== false,
  };
}

export function notificationPreferencesChanged(
  original: NotificationPreferences | null,
  current: NotificationPreferences | null,
): boolean {
  return Boolean(
    original &&
    current &&
    (Object.keys(original) as (keyof NotificationPreferences)[]).some(
      (key) => original[key] !== current[key],
    ),
  );
}
