export function availableMemberRoleChanges(input: {
  actorRole: string;
  actorUserId: string;
  memberUserId?: string;
  memberRole: string;
}) {
  if (input.actorRole !== "admin" || input.actorUserId === input.memberUserId) {
    return [];
  }
  return (["staff", "member"] as const).filter(
    (role) => role !== input.memberRole,
  );
}
