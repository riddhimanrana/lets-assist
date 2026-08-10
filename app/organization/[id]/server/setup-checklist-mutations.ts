"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { isOrganizationAdminForSettings } from "../settings/server/plugin-shared";

/**
 * Dismiss or restore the organization setup checklist.
 *
 * Reuses the same admin predicate the plugin settings actions use, so the
 * checklist cannot become a second, looser definition of "can administer this
 * organization". Staff are excluded, matching every other organization-level
 * setting.
 */
export async function setOrganizationSetupChecklistDismissed(
  organizationId: string,
  dismissed: boolean,
): Promise<{ success: true } | { error: string }> {
  const { user } = await getAuthUser();

  if (!user) {
    return { error: "You must be logged in to change this." };
  }

  const isAdmin = await isOrganizationAdminForSettings(organizationId, user.id);
  if (!isAdmin) {
    return { error: "Only organization admins can change this." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      setup_checklist_dismissed_at: dismissed ? new Date().toISOString() : null,
    })
    .eq("id", organizationId);

  if (error) {
    console.error("Failed to update setup checklist dismissal:", error.message);
    return { error: "Could not update the checklist." };
  }

  revalidatePath(`/organization/${organizationId}`);
  return { success: true };
}
