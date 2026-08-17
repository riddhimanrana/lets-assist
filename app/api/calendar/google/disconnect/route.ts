/**
 * Compatibility mount for ending a Google connection.
 *
 * The canonical route is `/api/google/oauth/disconnect`. Older clients and any
 * in-flight page still reach this path, so it runs the same handler rather
 * than breaking mid-flow.
 */

export { POST } from "@/app/api/google/oauth/disconnect/route";
