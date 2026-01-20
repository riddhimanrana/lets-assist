
import { createClient } from "@supabase/supabase-js";
import { createMockSupabaseClient } from "./mock";

const shouldUseMock = () =>
  process.env.E2E_TEST_MODE === "true" ||
  process.env.FORCE_MOCK_SUPABASE === "true" ||
  (process.env.SUPABASE_URL ?? "").includes("127.0.0.1:54321/mock");

export const createAdminClient = () => {
  if (shouldUseMock()) {
    return createMockSupabaseClient();
  }

  const adminUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!adminUrl) throw new Error("SUPABASE_URL is not set");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(adminUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
