import { createClient } from "@/lib/supabase/client";

/**
 * Creates a Supabase query builder scoped to the `plugin_data` schema for the browser.
 * Use this in "use client" components.
 *
 * Usage:
 *   const pluginDb = createPluginClient();
 *   const { data } = await pluginDb.from('dv_sd_memberships').select('*');
 */
export function createPluginClient() {
  const supabase = createClient();
  return supabase.schema("plugin_data");
}

/**
 * Creates both a standard Supabase client (public schema) and a
 * plugin_data-scoped builder for the browser.
 */
export function createDualClient() {
  const supabase = createClient();
  const pluginDb = supabase.schema("plugin_data");
  return { supabase, pluginDb };
}
