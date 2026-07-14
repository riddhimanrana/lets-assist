export function shouldRedirectMemberToPluginRoot({
  userRole,
  publicPage,
  hasEmbeddedOrganizationTabs,
}: {
  userRole: string | null;
  publicPage: "core" | "plugin" | "private" | null;
  hasEmbeddedOrganizationTabs: boolean;
}): boolean {
  return userRole === "member"
    && publicPage === "plugin"
    && !hasEmbeddedOrganizationTabs;
}
