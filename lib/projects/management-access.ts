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
 * Only an explicitly active membership confers anything: `invited`, `inactive`,
 * anything future, and an absent or null status all fail closed. The database
 * side of this policy — public.reject_project_signup and
 * app_private.can_moderate_project_signup — compares `status` for equality for
 * the same reason. Returning null instead of a boolean keeps the single policy
 * decision inside canManageProjectAccess rather than duplicating it per call
 * site.
 */
export function activeOrganizationRole(
  membership: OrganizationMembershipRow | undefined,
): string | null {
  if (!membership) return null;
  if (membership.status !== ACTIVE_ORGANIZATION_MEMBER_STATUS) return null;

  return membership.role ?? null;
}
