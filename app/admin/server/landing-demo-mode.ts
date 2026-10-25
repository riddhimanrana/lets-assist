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
): Promise<{ error?: string; refreshPending?: true }> {
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
  } catch {
    return { error: "Landing page mode was not saved. Reload and try again." };
  }

  // The database has confirmed persistence. A refresh failure cannot undo it
  // or truthfully be returned as a failed save. Try every refresh independently.
  let refreshPending = false;
  for (const refresh of [
    () => updateTag(LANDING_DEMO_CACHE_TAG),
    () => revalidatePath("/"),
    () => revalidatePath("/admin"),
  ]) {
    try {
      refresh();
    } catch {
      refreshPending = true;
    }
  }
  return refreshPending ? { refreshPending: true } : {};
}
