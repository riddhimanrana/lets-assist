import { createBrowserClient } from "@supabase/ssr";
import { createMockSupabaseClient } from "./mock";

const shouldUseMock = () =>
  process.env.E2E_TEST_MODE === "true" ||
  process.env.FORCE_MOCK_SUPABASE === "true" ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("127.0.0.1:54321/mock");

// Singleton instance for the browser client
let clientInstance: ReturnType<typeof createBrowserClient> | ReturnType<typeof createMockSupabaseClient> | null = null;

export function createClient() {
  if (shouldUseMock()) {
    return createMockSupabaseClient();
  }

  // If we already have an instance, return it to prevent "session flapping"
  // This ensures we don't have multiple clients fighting for storage or state
  if (clientInstance) {
    return clientInstance;
  }

  // Create a new instance if one doesn't exist
  clientInstance = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'lets-assist-auth', // Explicit key to prevent conflicts
      }
    }
  );

  return clientInstance;
}
