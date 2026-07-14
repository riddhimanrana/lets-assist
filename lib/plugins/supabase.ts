import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Service-only plugin_data client for reviewed host/plugin backends.
 *
 * `plugin_data` remains in PostgREST's schema list so the service role can use
 * the typed Supabase builder. Browser roles have neither schema usage nor
 * relation grants, and every externally reachable plugin entrypoint must
 * authorize before constructing this client.
 */
export function createPluginAdminClient() {
  return getAdminClient().schema("plugin_data");
}
