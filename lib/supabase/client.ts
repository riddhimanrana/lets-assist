import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_DB_OPTIONS } from "./retry-policy";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { db: SUPABASE_DB_OPTIONS },
  );
}
