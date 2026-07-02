/**
 * Plugin Data Supabase Client
 *
 * Legacy Plugin Data Supabase Client
 *
 * Architecture:
 *   - plugin_data is no longer exposed through the normal Supabase Data API
 *   - new plugin code must use host server actions, route handlers, narrow
 *     RPCs, public read models, or internal service-role/Postgres helpers
 *   - this file remains only as an explicit fail-closed legacy escape hatch
 *     while disabled plugins such as DV Speech & Debate are redesigned
 *
 * Usage:
 *   import { createPluginClient } from '@/lib/plugins/supabase';
 *
 *   const pluginDb = await createPluginClient();
 *   const { data } = await pluginDb.from('dv_sd_memberships').select('*');
 *
 * For public schema tables (organizations, organization_members, etc.),
 * continue using the standard createClient() from '@/lib/supabase/server'.
 */

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

function assertLegacyPluginDataApiEnabled() {
  if (process.env.LETS_ASSIST_ENABLE_LEGACY_PLUGIN_DATA_API !== "true") {
    throw new Error(
      "Direct plugin_data Supabase schema access is disabled. Use a server-only plugin backend, RPC, route handler, or read model instead.",
    );
  }
}

/**
 * Legacy helper for disabled/private plugins that have not completed the
 * server-only data cutover. Requires an explicit local/legacy env flag.
 */
export async function createPluginClient() {
  assertLegacyPluginDataApiEnabled();
  const supabase = await createClient();
  return supabase.schema("plugin_data");
}

/**
 * Creates both a standard Supabase client (public schema) and a
 * plugin_data-scoped builder. Use this when you need to query both schemas.
 *
 * Usage:
 *   const { supabase, pluginDb } = await createDualClient();
 *   const { data: org } = await supabase.from('organizations').select('*');
 *   const { data: members } = await pluginDb.from('dv_sd_memberships').select('*');
 */
export async function createDualClient() {
  assertLegacyPluginDataApiEnabled();
  const supabase = await createClient();
  const pluginDb = supabase.schema("plugin_data");
  return { supabase, pluginDb };
}

/**
 * Server-only plugin_data helper for reviewed host backends that must access
 * private plugin tables without exposing plugin_data through the browser/Data API.
 */
export function createPluginAdminClient() {
  return getAdminClient().schema("plugin_data");
}
