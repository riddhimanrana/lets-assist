import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

export const DEV_PREVIEW_SOURCE_COOKIE = "la_dev_preview_source";
export const DEV_PREVIEW_SOURCE_STORAGE_KEY = "la-dev-preview-source";

export type DevPreviewSource = "local" | "remote";

export function createRemoteReadonlyClient(): SupabaseClient | null {
  // Safety guard: never allow remote preview mode in production.
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  const url = process.env.NEXT_PUBLIC_REMOTE_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_REMOTE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_REMOTE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
