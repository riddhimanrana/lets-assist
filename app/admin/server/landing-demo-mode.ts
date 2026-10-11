"use server";

import "server-only";

import { revalidatePath, updateTag } from "next/cache";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  LANDING_DEMO_CACHE_TAG,
  readLandingDemoMode,
} from "@/lib/home/landing-demo-mode";

import { checkSuperAdmin } from "./auth";

export async function getLandingDemoModeForAdmin() {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { enabled: null, error: "Super admin access required." };
  return readLandingDemoMode();
}

/** Only a freshly authenticated, MFA-checked super admin can change the global mode. */
export async function setLandingDemoMode(
  enabled: boolean,
  expected: boolean,
): Promise<{ error?: string }> {
  if (typeof enabled !== "boolean" || typeof expected !== "boolean") {
    return { error: "Choose a valid landing page mode." };
  }
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) return { error: "Super admin access required." };

  try {
    const { data, error } = await getAdminClient().rpc(
      "set_landing_demo_mode",
      {
        p_enabled: enabled,
        p_expected: expected,
        p_actor_id: userId,
      },
    );
    if (error || data !== true) {
      return {
        error: "Landing page mode was not saved. Reload and try again.",
      };
    }
    updateTag(LANDING_DEMO_CACHE_TAG);
    revalidatePath("/");
    revalidatePath("/admin");
    return {};
  } catch {
    return { error: "Landing page mode was not saved. Reload and try again." };
  }
}
