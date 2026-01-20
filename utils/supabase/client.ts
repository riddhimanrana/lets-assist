import { createBrowserClient } from "@supabase/ssr";
import { createMockSupabaseClient } from "./mock";

const shouldUseMock = () =>
  process.env.E2E_TEST_MODE === "true" ||
  process.env.FORCE_MOCK_SUPABASE === "true" ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("127.0.0.1:54321/mock");

export function createClient() {
  if (shouldUseMock()) {
    return createMockSupabaseClient();
  }

  // Create a fresh client instance each time to properly read updated cookies
  // The @supabase/ssr package handles session management and caching internally
  // This ensures components get the latest auth state after login/logout
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
