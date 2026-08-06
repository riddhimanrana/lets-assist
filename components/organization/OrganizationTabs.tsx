"use client";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import MembersTab from "@/app/organization/[id]/MembersTab";
import ProjectsTab from "@/app/organization/[id]/ProjectsTab";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Folders,
  ShieldCheck,
  BarChart3,
  Check,
} from "lucide-react";
import Link from "next/link";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useRouter, useSearchParams } from "next/navigation";
import ReportsTab from "@/app/organization/[id]/ReportsTab";
import {
  buildNavigationDestinationGroups,
  findActiveNavigationDestination,
  isNavigationValueActive,
  type OrganizationNavigationDestination,
} from "./organization-navigation-destinations";
import type {
  Organization,
  Project,
  OrganizationTabBehavior,
  ResolvedOrganizationPluginSurface,
  OrganizationNavigationBehavior,
} from "@/types";
import { OrganizationOverviewTab } from "./OrganizationOverviewTab";
import { OrganizationTabsNavigation } from "./OrganizationTabsNavigation";

type OrganizationMember = {
  id: string;
  user_id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
  profiles?:
    | {
        id?: string;
        username?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
      }
    | Array<{
        id?: string;
        username?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
      }>
    | null;
};

type OrganizationWithWebsite = Organization & {
  website?: string | null;
  created_at?: string | null;
};

export type OrganizationPluginRouteTabLink = {
  value: string;
  label: string;
  href: string;
  minimumRole?: "public" | "member" | "staff" | "admin";
};

interface OrganizationTabsProps {
  organization: OrganizationWithWebsite;
  members: OrganizationMember[];
  projects: Project[];
  userRole: string | null;
  currentUserId: string | undefined;
  reportSummary?: {
    totalHours: number;
  } | null;
  organizationSlug?: string;
  organizationCreatedLabel: string;
  canViewMembers?: boolean;
  pluginOverviewExtensions?: ResolvedOrganizationPluginSurface[];
  pluginTabs?: OrganizationTabBehavior[];
  pluginRouteTabs?: OrganizationPluginRouteTabLink[];
  pluginNavigationOverrides?: OrganizationNavigationBehavior;
  demoReportsContent?: ReactNode;
  demoAdminToolsContent?: ReactNode;
  demoMemberHours?: Record<
    string,
    { totalHours: number; eventCount: number; lastEventDate?: string }
  >;
  demoMemberDetails?: Record<
    string,
    {
      events: Array<{
        id: string;
        projectTitle: string;
        eventDate: string;
        hours: number;
        isCertified: boolean;
        organizationName: string;
      }>;
      totalHours: number;
    }
  >;
}

function resolveOrganizationTabAlias(
  value: string,
  aliases: Readonly<Record<string, string>> | undefined,
) {
  let resolvedValue = value;
  const visited = new Set<string>();

  while (aliases?.[resolvedValue] && !visited.has(resolvedValue)) {
    visited.add(resolvedValue);
    resolvedValue = aliases[resolvedValue];
  }

  return resolvedValue;
}

export default function OrganizationTabs({
  organization,
  members,
  projects,
  userRole,
  currentUserId,
  reportSummary,
  organizationSlug,
  organizationCreatedLabel,
  canViewMembers = true,
  pluginOverviewExtensions = [],
  pluginTabs = [],
  pluginRouteTabs = [],
  pluginNavigationOverrides = {},
  demoReportsContent,
  demoAdminToolsContent,
  demoMemberHours,
  demoMemberDetails,
}: OrganizationTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(
    resolveOrganizationTabAlias(
      searchParams.get("tab") ||
        pluginNavigationOverrides.defaultTab ||
        "overview",
      pluginNavigationOverrides.tabAliases,
    ),
  );
  const rolePriority = { public: 0, member: 1, staff: 2, admin: 3 } as const;
  const viewerPriority =
    userRole === "admin" || userRole === "staff" || userRole === "member"
      ? rolePriority[userRole]
      : 0;
  const hasRouteAccess = (
    minimumRole: OrganizationPluginRouteTabLink["minimumRole"] = "member",
  ) => viewerPriority >= rolePriority[minimumRole];
  const organizationPath =
    organizationSlug ?? organization.username ?? organization.id;
  const buildPluginHref = (pluginKey: string, routePath?: string) =>
    `/organization/${organizationPath}/plugins/${pluginKey}${routePath ? `/${routePath}` : ""}`;
  const coreTabReplacements =
    pluginNavigationOverrides.coreTabReplacements ?? {};
  const visiblePluginRouteTabs = pluginRouteTabs.filter((tab) =>
    hasRouteAccess(tab.minimumRole),
  );
  const primaryPluginTabs = pluginTabs.filter(
    (tab) => !tab.navigationSection || tab.navigationSection === "primary",
  );
  const morePluginTabs = pluginTabs.filter(
    (tab) => tab.navigationSection === "more",
  );
  const activePluginParentValue = pluginTabs.find(
    (tab) => tab.value === activeTab,
  )?.parentValue;
  /**
   * The utility menu reads as selected both for a directly active entry and for
   * the entry that owns the active child tab.
   */
  const activeMoreTab = morePluginTabs.find((tab) =>
    isNavigationValueActive(tab.value, activeTab, activePluginParentValue),
  );
  const routeBackedTabs = new Map<string, string>();
  for (const tab of visiblePluginRouteTabs) {
    routeBackedTabs.set(tab.value, tab.href);
  }
  for (const [tabKey, replacement] of Object.entries(coreTabReplacements)) {
    if (replacement && hasRouteAccess(replacement.minimumRole)) {
      routeBackedTabs.set(
        tabKey,
        buildPluginHref(replacement.pluginKey, replacement.routePath),
      );
    }
  }
  const getCoreLabel = (
    tabKey: "overview" | "members" | "projects" | "reports",
    fallback: string,
  ) => coreTabReplacements[tabKey]?.label ?? fallback;
  const isCoreReplaced = (
    tabKey: "overview" | "members" | "projects" | "reports",
  ) => Boolean(coreTabReplacements[tabKey] && routeBackedTabs.has(tabKey));
  const canViewReports =
    !pluginNavigationOverrides.hideReportsTab &&
    (userRole === "admin" ||
      userRole === "staff" ||
      Boolean(demoReportsContent));
  const showOverviewTab =
    !pluginNavigationOverrides.hideOverviewTab &&
    (!coreTabReplacements.overview || routeBackedTabs.has("overview"));
  const showMembersTab =
    canViewMembers &&
    !pluginNavigationOverrides.hideMembersTab &&
    (!coreTabReplacements.members || routeBackedTabs.has("members"));
  const showProjectsTab =
    !pluginNavigationOverrides.hideProjectsTab &&
    (!coreTabReplacements.projects || routeBackedTabs.has("projects"));
  const showReportsTab =
    canViewReports &&
    (!coreTabReplacements.reports || routeBackedTabs.has("reports"));

  /**
   * Phone navigation collapses into a single full-section switcher only for
   * organizations that opt into the compact workspace chrome. Generic
   * organizations keep the horizontal category strip plus utility menu at every
   * width.
   */
  const usesFullSectionMobileNav = Boolean(
    pluginNavigationOverrides.compactHeader,
  );
  const sectionGroupLabel =
    pluginNavigationOverrides.sectionMenuLabel ?? "Workspace";
  const utilityGroupLabel =
    pluginNavigationOverrides.utilityMenuGroupLabel ?? "Administration";
  const workspaceCandidateDestinations: OrganizationNavigationDestination[] = [
    ...(showOverviewTab
      ? [
          {
            value: "overview",
            label: getCoreLabel("overview", "Overview"),
            icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
            href: routeBackedTabs.get("overview"),
          },
        ]
      : []),
    ...(showMembersTab
      ? [
          {
            value: "members",
            label: getCoreLabel(
              "members",
              pluginNavigationOverrides.membersTabLabel || "Members",
            ),
            icon: <Users className="h-4 w-4 shrink-0" />,
            href: routeBackedTabs.get("members"),
          },
        ]
      : []),
    ...(showProjectsTab
      ? [
          {
            value: "projects",
            label: getCoreLabel(
              "projects",
              pluginNavigationOverrides.projectsTabLabel || "Projects",
            ),
            icon: <Folders className="h-4 w-4 shrink-0" />,
            href: routeBackedTabs.get("projects"),
          },
        ]
      : []),
    ...(showReportsTab
      ? [
          {
            value: "reports",
            label: getCoreLabel("reports", "Reports"),
            icon: <BarChart3 className="h-4 w-4 shrink-0" />,
            href: routeBackedTabs.get("reports"),
          },
        ]
      : []),
    ...primaryPluginTabs.map((tab) => ({
      value: tab.value,
      label: tab.label,
      icon: tab.icon,
    })),
    ...visiblePluginRouteTabs.map((tab) => ({
      value: tab.value,
      label: tab.label,
      icon: <ShieldCheck className="h-4 w-4 shrink-0" />,
      href: tab.href,
    })),
  ];
  const utilityCandidateDestinations: OrganizationNavigationDestination[] =
    morePluginTabs.map((tab) => ({
      value: tab.value,
      label: tab.label,
      icon: tab.icon,
    }));
  /**
   * Overlapping inputs (a core replacement that is also a plugin route tab, a
   * primary tab repeated under the utility menu, …) must collapse to one entry
   * so the switcher never renders duplicate values or React keys.
   */
  const { workspaceDestinations, utilityDestinations, switcherDestinations } =
    buildNavigationDestinationGroups(
      workspaceCandidateDestinations,
      utilityCandidateDestinations,
    );
  const activeDestination = findActiveNavigationDestination(
    switcherDestinations,
    activeTab,
    activePluginParentValue,
  );
  const activeDestinationLabel = activeDestination?.label ?? sectionGroupLabel;

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    const tab = requestedTab
      ? resolveOrganizationTabAlias(
          requestedTab,
          pluginNavigationOverrides.tabAliases,
        )
      : null;
    const validTabs = [
      ...(showOverviewTab ? ["overview"] : []),
      ...(showMembersTab ? ["members"] : []),
      ...(showProjectsTab ? ["projects"] : []),
      ...(showReportsTab ? ["reports"] : []),
      ...pluginTabs.map((t) => t.value),
      ...visiblePluginRouteTabs.map((t) => t.value),
    ];
    const configuredDefault = pluginNavigationOverrides.defaultTab;
    const fallbackTab =
      configuredDefault && validTabs.includes(configuredDefault)
        ? configuredDefault
        : (validTabs[0] ?? "overview");
    const nextTab = tab && validTabs.includes(tab) ? tab : fallbackTab;

    setActiveTab((current) => (current === nextTab ? current : nextTab));

    if (requestedTab && requestedTab !== nextTab) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", nextTab);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [
    pluginNavigationOverrides.defaultTab,
    pluginNavigationOverrides.tabAliases,
    pluginTabs,
    router,
    searchParams,
    showMembersTab,
    showOverviewTab,
    showProjectsTab,
    showReportsTab,
    visiblePluginRouteTabs,
  ]);

  const handleTabChange = (value: string) => {
    const canonicalValue = resolveOrganizationTabAlias(
      value,
      pluginNavigationOverrides.tabAliases,
    );
    const routeHref = routeBackedTabs.get(canonicalValue);
    if (routeHref) {
      router.push(routeHref);
      return;
    }

    setActiveTab(canonicalValue);
    const params = new URLSearchParams(searchParams.toString());
    for (const key of pluginNavigationOverrides.transientQueryParams ?? []) {
      params.delete(key);
    }
    params.set("tab", canonicalValue);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const getTabHref = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of pluginNavigationOverrides.transientQueryParams ?? []) {
      params.delete(key);
    }
    params.set(
      "tab",
      resolveOrganizationTabAlias(value, pluginNavigationOverrides.tabAliases),
    );
    return `?${params.toString()}`;
  };

  const renderSectionSwitcherItem = (
    destination: OrganizationNavigationDestination,
  ) => {
    const isActive = destination.value === activeDestination?.value;

    return (
      <DropdownMenuItem
        key={`section-${destination.value}`}
        render={
          <Link href={destination.href ?? getTabHref(destination.value)} />
        }
        aria-current={isActive ? "page" : undefined}
        className="justify-between"
      >
        <span className="flex min-w-0 items-center gap-2">
          {destination.icon}
          <span className="truncate">{destination.label}</span>
        </span>
        {isActive ? <Check aria-hidden="true" /> : null}
      </DropdownMenuItem>
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const docEl = document.documentElement;
    let raf: number | null = null;

    const updateGutter = () => {
      if (activeTab !== "reports") {
        docEl.style.removeProperty("scrollbar-gutter");
        return;
      }

      const needsScroll = docEl.scrollHeight - docEl.clientHeight > 1;
      if (needsScroll) {
        docEl.style.scrollbarGutter = "stable";
      } else {
        docEl.style.removeProperty("scrollbar-gutter");
      }
    };

    raf = window.requestAnimationFrame(updateGutter);
    window.addEventListener("resize", updateGutter);

    return () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
      docEl.style.removeProperty("scrollbar-gutter");
      window.removeEventListener("resize", updateGutter);
    };
  }, [activeTab]);

  // Validate input data
  if (!Array.isArray(members)) {
    console.error("OrganizationTabs: members prop is not an array");
    return <div className="text-destructive">Error: Invalid members data</div>;
  }

  if (!Array.isArray(projects)) {
    console.error("OrganizationTabs: projects prop is not an array");
    return <div className="text-destructive">Error: Invalid projects data</div>;
  }

  // Calculate stats - using a stable value during hydration if needed

  return (
    <Tabs
      defaultValue="overview"
      value={activeTab}
      onValueChange={handleTabChange}
      className="w-full"
    >
      <OrganizationTabsNavigation
        usesFullSectionMobileNav={usesFullSectionMobileNav}
        switcherDestinations={switcherDestinations}
        workspaceDestinations={workspaceDestinations}
        utilityDestinations={utilityDestinations}
        activeDestination={activeDestination}
        activeDestinationLabel={activeDestinationLabel}
        sectionGroupLabel={sectionGroupLabel}
        utilityGroupLabel={utilityGroupLabel}
        renderSectionSwitcherItem={renderSectionSwitcherItem}
        showOverviewTab={showOverviewTab}
        showMembersTab={showMembersTab}
        showProjectsTab={showProjectsTab}
        showReportsTab={showReportsTab}
        getCoreLabel={getCoreLabel}
        pluginNavigationOverrides={pluginNavigationOverrides}
        primaryPluginTabs={primaryPluginTabs}
        visiblePluginRouteTabs={visiblePluginRouteTabs}
        activePluginParentValue={activePluginParentValue}
        morePluginTabs={morePluginTabs}
        hasActiveMoreTab={Boolean(activeMoreTab)}
        activeTab={activeTab}
        getTabHref={getTabHref}
      />

      {!pluginNavigationOverrides.hideOverviewTab &&
        !isCoreReplaced("overview") && (
          <OrganizationOverviewTab
            organization={organization}
            organizationCreatedLabel={organizationCreatedLabel}
            projects={projects}
            memberCount={members.length}
            totalHours={reportSummary?.totalHours ?? 0}
            pluginOverviewExtensions={pluginOverviewExtensions}
            userRole={userRole}
            demoAdminToolsContent={demoAdminToolsContent}
          />
        )}

      {canViewMembers &&
        !pluginNavigationOverrides.hideMembersTab &&
        !isCoreReplaced("members") && (
          <TabsContent value="members">
            <MembersTab
              members={members}
              userRole={userRole}
              organizationId={organization.id}
              currentUserId={currentUserId}
              canViewMembers={canViewMembers}
              demoMemberHours={demoMemberHours}
              demoMemberDetails={demoMemberDetails}
            />
          </TabsContent>
        )}

      {!pluginNavigationOverrides.hideProjectsTab &&
        !isCoreReplaced("projects") && (
          <TabsContent value="projects">
            <ProjectsTab
              projects={projects}
              organizationId={organization.id}
              userRole={userRole}
            />
          </TabsContent>
        )}

      {canViewReports && !isCoreReplaced("reports") && (
        <TabsContent value="reports">
          {demoReportsContent ?? (
            <ReportsTab
              organizationId={organization.id}
              organizationName={organization.name}
              userRole={userRole}
              organizationSlug={organizationSlug}
            />
          )}
        </TabsContent>
      )}

      {pluginTabs.map((pt) => (
        <TabsContent key={pt.value} value={pt.value}>
          {pt.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
