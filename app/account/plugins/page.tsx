import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  DEFAULT_PLUGIN_DISPLAY_PREFERENCES,
  loadPluginDisplayPreferences,
} from "@/lib/plugins/plugin-display-preferences";
import { listPlatformPluginSources } from "@/lib/plugins/resolve-platform-surfaces";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

import { PluginContentSettings } from "./PluginContentSettings";

export const metadata: Metadata = {
  title: "Plugin Content",
  description:
    "Choose whether plugin content from your organizations appears on your home page and dashboard",
};

export default async function PluginContentPage() {
  const { user } = await getAuthUser();
  if (!user) redirect("/login?redirect=/account/plugins");

  const supabase = await createClient();
  const [preferences, sources] = await Promise.all([
    loadPluginDisplayPreferences(supabase, user.id).catch(
      () => DEFAULT_PLUGIN_DISPLAY_PREFERENCES,
    ),
    listPlatformPluginSources(user.id),
  ]);

  return (
    <PluginContentSettings
      showPluginContent={preferences.showPluginContent}
      hiddenPluginKeys={preferences.hiddenPluginKeys}
      sources={sources}
    />
  );
}
