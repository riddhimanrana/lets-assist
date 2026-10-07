import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_DB_OPTIONS } from "./retry-policy";

export function getAdminClient(options?: { timeoutMs?: number }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Supabase URL and Secret Key must be defined for Admin Client.",
    );
  }

  // Create a new client every time or cache it if desired.
  // For admin operations, caching is usually fine but let's keep it simple.
  return createClient(supabaseUrl, secretKey, {
    db: SUPABASE_DB_OPTIONS,
    ...(options?.timeoutMs
      ? {
          global: {
            fetch: Object.assign(
              (input: RequestInfo | URL, init?: RequestInit) =>
                fetch(input, {
                  ...init,
                  signal: AbortSignal.any([
                    ...(init?.signal ? [init.signal] : []),
                    AbortSignal.timeout(options.timeoutMs!),
                  ]),
                }),
              { preconnect: fetch.preconnect },
            ),
          },
        }
      : {}),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
