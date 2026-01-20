import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createMockSupabaseClient } from "./mock";

const shouldUseMock = () =>
  process.env.E2E_TEST_MODE === "true" ||
  process.env.FORCE_MOCK_SUPABASE === "true" ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("127.0.0.1:54321/mock");

let cachedServiceRoleClient: SupabaseClient | null = null;

export function getServiceRoleClient() {
  if (shouldUseMock()) {
    return createMockSupabaseClient() as unknown as SupabaseClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  if (!cachedServiceRoleClient) {
    cachedServiceRoleClient = createSupabaseClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return cachedServiceRoleClient;
}
