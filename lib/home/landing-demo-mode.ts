import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { unstable_cache } from "next/cache";

export const LANDING_DEMO_CACHE_TAG = "landing-demo-mode";

/** Public pages consume only the mode; private audit fields never reach clients. */
export async function readLandingDemoMode(): Promise<{
  enabled: boolean | null;
  error?: string;
}> {
  try {
    const { data, error } = await getAdminClient({ timeoutMs: 2500 }).rpc(
      "get_landing_demo_mode",
    );
    if (error || typeof data !== "boolean") {
      return { enabled: null, error: "Unable to load landing page mode." };
    }
    return { enabled: data };
  } catch {
    return { enabled: null, error: "Unable to load landing page mode." };
  }
}

// The cache contains only a public display boolean, bound to the backend.
// Admin reads bypass it. A successful save immediately expires the tag.
export const readPublicLandingDemoMode = unstable_cache(
  readLandingDemoMode,
  [
    "landing-demo-mode-v1",
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "unconfigured",
  ],
  { tags: [LANDING_DEMO_CACHE_TAG], revalidate: 30 },
);
