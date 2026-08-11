import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  deriveOrganizationSetupChecklist,
  type OrganizationSetupChecklist,
} from "@/lib/organization/setup-checklist";

interface LoadOptions {
  organizationId: string;
  organizationSlug: string;
  /** From `organization_public_read_model`, which the page already loaded. */
  logoUrl: string | null;
  description: string | null;
  type: string | null;
  memberCount: number;
  projectCount: number;
}

/**
 * Build the setup checklist for an organization admin.
 *
 * Everything except the dismissal timestamp is passed in from data the
 * organization page already loaded, so this adds exactly one narrow read, and
 * only for admins. The caller is responsible for establishing that the viewer
 * is an admin — the checklist is a convenience surface, not an authorization
 * boundary, and it exposes nothing a member could not already see.
 */
export async function loadOrganizationSetupChecklist(
  options: LoadOptions,
): Promise<OrganizationSetupChecklist | null> {
  const supabase = await createClient();

  const [organizationResult, entitlementResult, installResult] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("setup_checklist_dismissed_at")
        .eq("id", options.organizationId)
        .maybeSingle<{ setup_checklist_dismissed_at: string | null }>(),
      supabase
        .from("organization_plugin_entitlements")
        .select("plugin_key")
        .eq("organization_id", options.organizationId)
        .limit(1),
      supabase
        .from("organization_plugin_installs")
        .select("plugin_key")
        .eq("organization_id", options.organizationId)
        .eq("enabled", true)
        .limit(1),
    ]);

  if (organizationResult.error) {
    // A checklist is not worth failing the organization page over.
    console.error(
      "Failed to load setup checklist state:",
      organizationResult.error.message,
    );
    return null;
  }

  const hasEnabledPlugin = (installResult.data?.length ?? 0) > 0;
  // An organization with no entitlement and nothing installed has no plugin to
  // set up, so the step is omitted rather than left permanently incomplete.
  // Entitlement errors are treated as "none": the plugin tables are missing in
  // some environments, and a checklist must not surface that as a failure.
  const hasPluginAvailable =
    hasEnabledPlugin || (entitlementResult.data?.length ?? 0) > 0;

  return deriveOrganizationSetupChecklist({
    organizationSlug: options.organizationSlug,
    hasLogo: Boolean(options.logoUrl),
    hasDescription: Boolean(options.description?.trim()),
    hasType: Boolean(options.type),
    memberCount: options.memberCount,
    projectCount: options.projectCount,
    hasPluginAvailable,
    hasEnabledPlugin,
    dismissedAt: organizationResult.data?.setup_checklist_dismissed_at ?? null,
  });
}
