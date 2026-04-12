/**
 * Plugin Data Supabase Client
 *
 * Provides a Supabase query builder scoped to the `plugin_data` schema.
 * Use this for all plugin table queries instead of the default client.
 *
 * Architecture:
 *   - plugin_data schema is exposed via PostgREST (config.toml + Dashboard)
 *   - supabase.schema('plugin_data') returns a builder that queries plugin_data.*
 *   - RLS policies on plugin_data tables use private.* SECURITY DEFINER helpers
 *   - The default client (no .schema()) still queries public.*
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

/**
 * Creates a Supabase query builder scoped to the `plugin_data` schema.
 * Returns the schema-scoped builder (NOT the full client).
 *
 * Note: The returned object only supports `.from()` — it does NOT have
 * `.auth`, `.storage`, `.rpc()`, etc. For those, use `createClient()` directly.
 */
export async function createPluginClient() {
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
  const supabase = await createClient();
  const pluginDb = supabase.schema("plugin_data");
  return { supabase, pluginDb };
}
