export type ProjectManagementAccessInput = {
  creatorId: string | null;
  userId: string;
  organizationRole?: string | null;
  canBeManagedByStaff?: boolean | null;
};

/**
 * Canonical project-management policy shared by pages, Server Actions, and
 * proxy route guards.
 */
export function canManageProjectAccess(
  input: ProjectManagementAccessInput,
): boolean {
  if (input.creatorId === input.userId) return true;
  if (input.organizationRole === "admin") return true;

  return (
    input.organizationRole === "staff" && input.canBeManagedByStaff === true
  );
}

export const ACTIVE_ORGANIZATION_MEMBER_STATUS = "active";

export type OrganizationMembershipRow = {
  role?: string | null;
  status?: string | null;
} | null;

/**
 * The role a membership row currently confers, or null when it confers none.
 *
 * `organization_members.status` is nullable with an `active` default, and the
 * platform's transactional RPCs read it as `COALESCE(status, 'active')`. This
 * mirrors that exactly, so a legacy row without a status is still active while
 * every other value — `invited`, `inactive`, anything future — confers nothing.
 * Returning null instead of a boolean keeps the single policy decision inside
 * canManageProjectAccess rather than duplicating it per call site.
 */
export function activeOrganizationRole(
  membership: OrganizationMembershipRow | undefined,
): string | null {
  if (!membership) return null;

  const status = membership.status ?? ACTIVE_ORGANIZATION_MEMBER_STATUS;
  if (status !== ACTIVE_ORGANIZATION_MEMBER_STATUS) return null;

  return membership.role ?? null;
}
