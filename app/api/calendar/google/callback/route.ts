/**
 * Compatibility mount for the Google OAuth callback.
 *
 * The canonical route is `/api/google/oauth/callback`. This path stays live
 * because the redirect URI is registered per environment in the Google Cloud
 * console, and an environment whose registration still points here must keep
 * working until that registration is updated. It runs the same handler, and
 * the attempt cookie is scoped to whichever path `GOOGLE_REDIRECT_URI` names.
 */

export { GET } from "@/app/api/google/oauth/callback/route";
