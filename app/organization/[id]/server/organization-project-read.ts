import type { SupabaseClient } from "@supabase/supabase-js";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";

/** Discovery excludes unlisted projects even when the viewer can open their links. */
export function readOrganizationProjects(
  client: SupabaseClient,
  organizationId: string,
  isMember: boolean,
) {
  return client
    .from("projects")
    .select(PROJECT_CLIENT_SELECT)
    .eq("organization_id", organizationId)
    .in("visibility", isMember ? ["public", "organization_only"] : ["public"])
    .eq("workflow_status", "published")
    .order("created_at", { ascending: false });
}
