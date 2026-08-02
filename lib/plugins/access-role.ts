import type {
  OrganizationPluginAccessRole,
  OrganizationPluginSurfaceAccessLevel,
} from "@/types/plugin";

const ORGANIZATION_PLUGIN_ROLE_ORDER: Record<
  OrganizationPluginAccessRole,
  number
> = {
  member: 1,
  staff: 2,
  admin: 3,
};

export function toOrganizationPluginAccessRole(
  value: string | null | undefined,
): OrganizationPluginAccessRole | null {
  return value === "admin" || value === "staff" || value === "member"
    ? value
    : null;
}

export function hasOrganizationPluginRoleAccess(
  userRole: OrganizationPluginAccessRole,
  minimumAccess: OrganizationPluginSurfaceAccessLevel | undefined,
): boolean {
  if (!minimumAccess || minimumAccess === "public") {
    return true;
  }

  return (
    ORGANIZATION_PLUGIN_ROLE_ORDER[userRole] >=
    ORGANIZATION_PLUGIN_ROLE_ORDER[minimumAccess]
  );
}
