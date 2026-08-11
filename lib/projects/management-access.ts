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
