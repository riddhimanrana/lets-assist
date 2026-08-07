import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether plugin-contributed content appears on the core platform surfaces
 * (`/home` feed, `/dashboard` cards).
 *
 * The preference is opt-out: a user with no stored row sees everything they
 * are entitled to. `hiddenPluginKeys` therefore lists only the plugins the
 * user has switched off individually — an absent key always means "shown".
 */
export const PLUGIN_DISPLAY_PREFERENCES_TABLE =
  "user_plugin_display_preferences";

/** Guard rail matching the table's cardinality CHECK. */
export const MAX_HIDDEN_PLUGIN_KEYS = 200;

export interface PluginDisplayPreferences {
  showPluginContent: boolean;
  hiddenPluginKeys: string[];
}

export const DEFAULT_PLUGIN_DISPLAY_PREFERENCES: PluginDisplayPreferences = {
  showPluginContent: true,
  hiddenPluginKeys: [],
};

export type PluginDisplayPreferencesClient = Pick<SupabaseClient, "from">;
export type PluginDisplayPreferencesWriteClient = Pick<SupabaseClient, "from">;

type PreferenceRow = {
  show_plugin_content?: unknown;
  hidden_plugin_keys?: unknown;
};

function sanitizeHiddenKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed) keys.add(trimmed);
  }
  return [...keys].slice(0, MAX_HIDDEN_PLUGIN_KEYS);
}

/**
 * Reads the viewer's preference.
 *
 * No row means the defaults, so a person who never opened the setting keeps
 * seeing plugin content. A failed read hides plugin content instead: an
 * explicit opt-out must not be undone by a transient database problem, and
 * the platform surfaces already degrade to "no plugin content" whenever the
 * plugin path is unhealthy.
 */
export async function loadPluginDisplayPreferences(
  supabase: PluginDisplayPreferencesClient,
  userId: string,
): Promise<PluginDisplayPreferences> {
  if (!userId) return { showPluginContent: false, hiddenPluginKeys: [] };

  const { data, error } = (await supabase
    .from(PLUGIN_DISPLAY_PREFERENCES_TABLE)
    .select("show_plugin_content, hidden_plugin_keys")
    .eq("user_id", userId)) as {
    data: PreferenceRow[] | null;
    error: unknown;
  };

  if (error) {
    console.warn(
      "[plugin-display-preferences] Failed to read preferences; hiding plugin content:",
      error,
    );
    return { showPluginContent: false, hiddenPluginKeys: [] };
  }

  const row = data?.[0];
  if (!row) return { ...DEFAULT_PLUGIN_DISPLAY_PREFERENCES };

  return {
    showPluginContent: row.show_plugin_content !== false,
    hiddenPluginKeys: sanitizeHiddenKeys(row.hidden_plugin_keys),
  };
}

/**
 * Writes the viewer's preference, creating the row on first change.
 *
 * Kept beside the read so every statement against this table lives in one
 * module with a literal table name — which is also what lets the repository's
 * direct-write scanner resolve the target.
 */
export async function savePluginDisplayPreferences(
  supabase: PluginDisplayPreferencesWriteClient,
  userId: string,
  values: { showPluginContent?: boolean; hiddenPluginKeys?: string[] },
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from(PLUGIN_DISPLAY_PREFERENCES_TABLE)
    .upsert(
      {
        user_id: userId,
        ...(values.showPluginContent === undefined
          ? {}
          : { show_plugin_content: values.showPluginContent }),
        ...(values.hiddenPluginKeys === undefined
          ? {}
          : {
              hidden_plugin_keys: sanitizeHiddenKeys(values.hiddenPluginKeys),
            }),
      },
      { onConflict: "user_id" },
    );

  return { error: error ?? null };
}

/**
 * The stored opt-out list after one plugin is switched on or off.
 *
 * Keys for plugins the person can no longer reach are dropped, so an opt-out
 * for an uninstalled plugin cannot sit in the bounded list forever and quietly
 * re-hide that plugin if their organization installs it again years later.
 */
export function nextHiddenPluginKeys(input: {
  current: string[];
  pluginKey: string;
  visible: boolean;
  reachableKeys: string[];
}): string[] {
  const reachable = new Set(input.reachableKeys);
  const hidden = new Set(sanitizeHiddenKeys(input.current));

  if (input.visible) hidden.delete(input.pluginKey);
  else hidden.add(input.pluginKey);

  return [...hidden]
    .filter((key) => reachable.has(key))
    .slice(0, MAX_HIDDEN_PLUGIN_KEYS);
}

export function isPluginHidden(
  preferences: PluginDisplayPreferences,
  pluginKey: string,
): boolean {
  if (!preferences.showPluginContent) return true;
  return preferences.hiddenPluginKeys.includes(pluginKey);
}
