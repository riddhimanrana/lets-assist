import type { SupabaseClient } from "@supabase/supabase-js";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";

// Troop 941 explicitly opted into member discovery of its existing unlisted
// projects. Use the stable, public organization ID, not a claim from the URL or
// a mutable username. This does not change project visibility or link access.
const TROOP_941_ORGANIZATION_ID = "26bc1fa3-7f83-403c-bde1-2737bb71ca79";

/**
 * Admins and staff manage every published project in their own organization,
 * so their organization page lists its unlisted projects too. Nonmembers and
 * ordinary members retain the link-only discovery contract.
 */
const MANAGING_ROLES = new Set(["admin", "staff"]);

export function readOrganizationProjects(
  client: SupabaseClient,
  organizationId: string,
  viewerRole: string | null,
) {
  const isMember = Boolean(viewerRole);
  const isManager = viewerRole !== null && MANAGING_ROLES.has(viewerRole);
  const showTroopUnlisted =
    isMember && !isManager && organizationId === TROOP_941_ORGANIZATION_ID;
  const query = client
    .from("projects")
    .select(PROJECT_CLIENT_SELECT)
    .eq("organization_id", organizationId)
    .eq("workflow_status", "published");

  if (isManager) {
    query.in("visibility", ["public", "organization_only", "unlisted"]);
  } else if (showTroopUnlisted) {
    // Preserve existing listed results. Only the additional unlisted branch
    // excludes cancelled records and explicitly named test fixtures.
    query.or(
      "visibility.in.(public,organization_only),and(visibility.eq.unlisted,status.neq.cancelled,title.not.ilike.TEST:*,title.not.ilike.[TEST]*)",
    );
  } else {
    query.in(
      "visibility",
      isMember ? ["public", "organization_only"] : ["public"],
    );
  }
  return query.order("created_at", { ascending: false });
}
