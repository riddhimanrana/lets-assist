import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Create a fresh client instance each time to properly read updated cookies
  // The @supabase/ssr package handles session management and caching internally
  // This ensures components get the latest auth state after login/logout
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
