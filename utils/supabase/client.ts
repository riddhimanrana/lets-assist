import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Singleton client to ensure consistent session state across the app
let client: SupabaseClient | null = null;

export function createClient() {
  // Always return the same client instance for consistency
  // This prevents multiple auth state listeners and reduces API calls
  if (client) {
    return client;
  }

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Disable auto-refresh in client - let server handle it via proxy.ts
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Reduce storage polling to prevent excessive checks
        storageKey: 'sb-auth-token',
      },
    }
  );

  return client;
}
