import "server-only";

import { resolveOrganizationPluginBehaviorHook } from "@/lib/plugins/resolve-plugin-behaviors";
import { resolveOrganizationPlugins } from "@/lib/plugins/resolve-org-plugins";
import type { OrganizationPluginAccessRole } from "@/types";

export async function loadOrganizationPluginNavigation(input: {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  viewerRole: OrganizationPluginAccessRole | null;
  viewerUserId?: string;
  userId: string | null;
  userEmail: string | null;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (!input.viewerRole) return { tabs: [], overrides: [], plugins: [] };

  const context = {
    organizationId: input.organizationId,
    organizationSlug: input.organizationSlug,
    organizationName: input.organizationName,
    viewerRole: input.viewerRole,
    viewerUserId: input.viewerUserId,
    target: { userId: input.userId, userEmail: input.userEmail },
    useAdminClient: true,
  };
  // Each resolver still reads current access. Only their scheduling is shared.
  const [tabs, overrides, plugins] = await Promise.all([
    resolveOrganizationPluginBehaviorHook({
      ...context,
      hook: "organization.tabs",
      hookInput: { searchParams: input.searchParams },
    }),
    resolveOrganizationPluginBehaviorHook({
      ...context,
      hook: "organization.navigation.overrides",
    }),
    resolveOrganizationPlugins({
      organizationId: input.organizationId,
      userRole: input.viewerRole,
      viewerUserId: input.viewerUserId,
    }),
  ]);
  return { tabs, overrides, plugins };
}
