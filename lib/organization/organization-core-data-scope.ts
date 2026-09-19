import type { OrganizationNavigationBehavior } from "@/types";

export function getOrganizationCoreDataScope(input: {
  canViewMembers: boolean;
  navigation: OrganizationNavigationBehavior;
}) {
  const showsOverview = input.navigation.hideOverviewTab !== true;
  return {
    memberRows:
      input.canViewMembers &&
      (showsOverview ||
        input.navigation.hideMembersTab !== true ||
        input.navigation.hideMemberCount !== true),
    projects: showsOverview || input.navigation.hideProjectsTab !== true,
  };
}
