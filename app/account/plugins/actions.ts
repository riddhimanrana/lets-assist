"use server";

import { revalidatePath } from "next/cache";

import {
  loadPluginDisplayPreferences,
  nextHiddenPluginKeys,
  savePluginDisplayPreferences,
} from "@/lib/plugins/plugin-display-preferences";
import { listPlatformPluginSources } from "@/lib/plugins/resolve-platform-surfaces";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export type PluginDisplayActionResult = { success: true } | { error: string };

const GENERIC_ERROR = "We couldn't save that. Try again.";

/** Both surfaces read the preference, so both must be refreshed after a write. */
function revalidatePluginSurfaces() {
  revalidatePath("/home");
  revalidatePath("/dashboard");
  revalidatePath("/account/plugins");
}

async function writePreferences(
  userId: string,
  values: { showPluginContent?: boolean; hiddenPluginKeys?: string[] },
): Promise<PluginDisplayActionResult> {
  const supabase = await createClient();

  // Row-level security scopes this to the signed-in user; the upsert creates
  // the row on first change so no signup backfill is needed.
  const { error } = await savePluginDisplayPreferences(
    supabase,
    userId,
    values,
  );

  if (error) {
    console.error("[account/plugins] Failed to save preferences:", error);
    return { error: GENERIC_ERROR };
  }

  revalidatePluginSurfaces();
  return { success: true };
}

/** The platform-wide switch: off hides every plugin on every core surface. */
export async function setPluginContentVisibility(
  showPluginContent: boolean,
): Promise<PluginDisplayActionResult> {
  if (typeof showPluginContent !== "boolean") {
    return { error: GENERIC_ERROR };
  }

  const { user } = await getAuthUser();
  if (!user) return { error: "Sign in to change this setting." };

  return writePreferences(user.id, { showPluginContent });
}

/**
 * A single plugin's override. The key is checked against the plugins this
 * person could actually see content from, so the stored list can never
 * accumulate keys from plugins they have nothing to do with.
 */
export async function setPluginSourceVisibility(
  pluginKey: string,
  visible: boolean,
): Promise<PluginDisplayActionResult> {
  if (typeof pluginKey !== "string" || typeof visible !== "boolean") {
    return { error: GENERIC_ERROR };
  }

  const { user } = await getAuthUser();
  if (!user) return { error: "Sign in to change this setting." };

  const sources = await listPlatformPluginSources(user.id);
  if (!sources.some((source) => source.pluginKey === pluginKey)) {
    return { error: "That plugin isn't available to you." };
  }

  const supabase = await createClient();
  const preferences = await loadPluginDisplayPreferences(supabase, user.id);

  const hiddenPluginKeys = nextHiddenPluginKeys({
    current: preferences.hiddenPluginKeys,
    pluginKey,
    visible,
    reachableKeys: sources.map((source) => source.pluginKey),
  });

  return writePreferences(user.id, { hiddenPluginKeys });
}
