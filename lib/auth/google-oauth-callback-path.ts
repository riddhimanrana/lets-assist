/**
 * Where Google sends the browser back after an authorization attempt.
 *
 * The flow is not calendar-specific — the same connect/callback pair serves
 * personal calendar, organization calendar, organization Sheets, and the
 * DVHS-CSF import surfaces — so the canonical route is provider-scoped rather
 * than feature-scoped.
 *
 * `/api/calendar/google/callback` remains mounted because a redirect URI is
 * registered per environment in the Google Cloud console, and an environment
 * still registered on the old path must keep working until its registration is
 * updated. Both paths run the same handler.
 */
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/google/oauth/callback";
export const GOOGLE_OAUTH_CONNECT_PATH = "/api/google/oauth/connect";

export const LEGACY_GOOGLE_OAUTH_CALLBACK_PATH =
  "/api/calendar/google/callback";
export const LEGACY_GOOGLE_OAUTH_CONNECT_PATH = "/api/calendar/google/connect";

const SUPPORTED_CALLBACK_PATHS = new Set([
  GOOGLE_OAUTH_CALLBACK_PATH,
  LEGACY_GOOGLE_OAUTH_CALLBACK_PATH,
]);

/**
 * The callback path this environment actually redirects to.
 *
 * Derived from `GOOGLE_REDIRECT_URI` so the attempt cookie is scoped to the
 * exact route Google will hit. Deriving it removes the failure mode where a
 * hardcoded cookie path silently stops matching the configured redirect and
 * every attempt loses its cookie.
 *
 * An unparseable or unrecognized value falls back to the canonical path rather
 * than widening the cookie, so a misconfiguration fails closed and visibly
 * instead of attaching the attempt cookie to unrelated API routes.
 */
export function resolveGoogleOAuthCallbackPath(
  redirectUri = process.env.GOOGLE_REDIRECT_URI,
): string {
  if (!redirectUri) return GOOGLE_OAUTH_CALLBACK_PATH;

  let pathname: string;
  try {
    pathname = new URL(redirectUri).pathname;
  } catch {
    return GOOGLE_OAUTH_CALLBACK_PATH;
  }

  return SUPPORTED_CALLBACK_PATHS.has(pathname)
    ? pathname
    : GOOGLE_OAUTH_CALLBACK_PATH;
}
