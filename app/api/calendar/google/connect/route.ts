/**
 * Compatibility mount for starting a Google OAuth connection.
 *
 * The canonical route is `/api/google/oauth/connect`. Older clients and any
 * bookmarked links still reach this path, so it runs the same handler rather
 * than breaking mid-flow.
 */

export { GET } from "@/app/api/google/oauth/connect/route";
