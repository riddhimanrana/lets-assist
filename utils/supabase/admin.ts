
import { createClient } from "@supabase/supabase-js";

export const createAdminClient = () => {
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
