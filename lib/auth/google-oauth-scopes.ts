export const GOOGLE_CALENDAR_APP_CREATED_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

export const GOOGLE_CALENDAR_LEGACY_FULL_SCOPE =
  "https://www.googleapis.com/auth/calendar";

export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export function parseGoogleGrantedScopes(
  grantedScopes: string | null | undefined,
): ReadonlySet<string> {
  return new Set(
    (grantedScopes ?? "")
      .split(/\s+/u)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

export function hasGoogleCalendarWriteScope(
  grantedScopes: string | null | undefined,
): boolean {
  const scopes = parseGoogleGrantedScopes(grantedScopes);
  return (
    scopes.has(GOOGLE_CALENDAR_APP_CREATED_SCOPE) ||
    scopes.has(GOOGLE_CALENDAR_LEGACY_FULL_SCOPE)
  );
}

export function hasGoogleDriveFileScope(
  grantedScopes: string | null | undefined,
): boolean {
  return parseGoogleGrantedScopes(grantedScopes).has(GOOGLE_DRIVE_FILE_SCOPE);
}
