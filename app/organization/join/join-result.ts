export function joinedOrganizationPath(result: {
  success?: boolean;
  error?: string;
  organizationUsername?: string;
}): string | null {
  if (
    !result.organizationUsername ||
    (!result.success &&
      result.error !== "You are already a member of this organization")
  )
    return null;
  return `/organization/${encodeURIComponent(result.organizationUsername)}`;
}
