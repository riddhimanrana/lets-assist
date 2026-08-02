"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MembersTab from "@/app/organization/[id]/MembersTab";
import ProjectsTab from "@/app/organization/[id]/ProjectsTab";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Folders,
  Calendar,
  Clock3,
  CalendarClock,
  CheckCircle2,
  Building2,
  Globe,
  MapPin,
  ShieldCheck,
  LogOut,
  BarChart3,
  Check,
  ChevronDown,
  Frown
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose, DialogFooter } from "@/components/ui/dialog";
import { useRouter, useSearchParams } from "next/navigation";
import { leaveOrganization } from "@/app/organization/actions";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { getProjectStatus } from "@/utils/project";
import ReportsTab from "@/app/organization/[id]/ReportsTab";
import { formatOrganizationWebsiteDisplay } from "@/lib/organization/website";
import { cn } from "@/lib/utils";
import {
  buildNavigationDestinationGroups,
  findActiveNavigationDestination,
  isNavigationValueActive,
  type OrganizationNavigationDestination,
} from "./organization-navigation-destinations";
import type { Organization, Project, OrganizationTabBehavior, ResolvedOrganizationPluginSurface, OrganizationNavigationBehavior } from "@/types";

type OrganizationMember = {
  id: string;
  user_id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
  profiles?: {
    id?: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | Array<{
    id?: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  }> | null;
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
  demoMemberHours?: Record<string, { totalHours: number; eventCount: number; lastEventDate?: string }>;
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

function LeaveOrganizationDialog({
  organization,
  userRole
}: {
  organization: Organization;
  userRole: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const router = useRouter();

  const handleLeave = async () => {
    setIsLeaving(true);
    try {
      const result = await leaveOrganization(organization.id);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Successfully left the organization");
      router.push("/organization");
    } catch (error) {
      console.error("Error leaving organization:", error);
      toast.error("Failed to leave organization");
    } finally {
      setIsLeaving(false);
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            className="w-full sm:w-auto text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Leave Organization
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Organization</DialogTitle>
          <DialogDescription>
            Are you sure you want to leave this organization? You will lose access to all organization resources.
            {userRole === "admin" && (
              <div className="mt-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                As an admin, you cannot leave if you are the last admin. Please promote another member to admin first.
              </div>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isLeaving}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleLeave}
            disabled={isLeaving}
          >
            {isLeaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Leaving…
              </>
            ) : (
              "Leave Organization"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
      searchParams.get("tab") || pluginNavigationOverrides.defaultTab || "overview",
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
  const organizationPath = organizationSlug ?? organization.username ?? organization.id;
  const buildPluginHref = (pluginKey: string, routePath?: string) =>
    `/organization/${organizationPath}/plugins/${pluginKey}${routePath ? `/${routePath}` : ""}`;
  const coreTabReplacements = pluginNavigationOverrides.coreTabReplacements ?? {};
  const visiblePluginRouteTabs = pluginRouteTabs.filter((tab) =>
    hasRouteAccess(tab.minimumRole),
  );
  const primaryPluginTabs = pluginTabs.filter((tab) => !tab.navigationSection || tab.navigationSection === "primary");
  const morePluginTabs = pluginTabs.filter((tab) => tab.navigationSection === "more");
  const activePluginParentValue = pluginTabs.find((tab) => tab.value === activeTab)?.parentValue;
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
  const isCoreReplaced = (tabKey: "overview" | "members" | "projects" | "reports") =>
    Boolean(coreTabReplacements[tabKey] && routeBackedTabs.has(tabKey));
  const canViewReports =
    !pluginNavigationOverrides.hideReportsTab &&
    (userRole === "admin" || userRole === "staff" || Boolean(demoReportsContent));
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
    canViewReports && (!coreTabReplacements.reports || routeBackedTabs.has("reports"));

  /**
   * Phone navigation collapses into a single full-section switcher only for
   * organizations that opt into the compact workspace chrome. Generic
   * organizations keep the horizontal category strip plus utility menu at every
   * width.
   */
  const usesFullSectionMobileNav = Boolean(pluginNavigationOverrides.compactHeader);
  const sectionGroupLabel = pluginNavigationOverrides.sectionMenuLabel ?? "Workspace";
  const utilityGroupLabel = pluginNavigationOverrides.utilityMenuGroupLabel ?? "Administration";
  const workspaceCandidateDestinations: OrganizationNavigationDestination[] = [
    ...(showOverviewTab
      ? [{
          value: "overview",
          label: getCoreLabel("overview", "Overview"),
          icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
          href: routeBackedTabs.get("overview"),
        }]
      : []),
    ...(showMembersTab
      ? [{
          value: "members",
          label: getCoreLabel("members", pluginNavigationOverrides.membersTabLabel || "Members"),
          icon: <Users className="h-4 w-4 shrink-0" />,
          href: routeBackedTabs.get("members"),
        }]
      : []),
    ...(showProjectsTab
      ? [{
          value: "projects",
          label: getCoreLabel("projects", pluginNavigationOverrides.projectsTabLabel || "Projects"),
          icon: <Folders className="h-4 w-4 shrink-0" />,
          href: routeBackedTabs.get("projects"),
        }]
      : []),
    ...(showReportsTab
      ? [{
          value: "reports",
          label: getCoreLabel("reports", "Reports"),
          icon: <BarChart3 className="h-4 w-4 shrink-0" />,
          href: routeBackedTabs.get("reports"),
        }]
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
  const utilityCandidateDestinations: OrganizationNavigationDestination[] = morePluginTabs.map((tab) => ({
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
      ? resolveOrganizationTabAlias(requestedTab, pluginNavigationOverrides.tabAliases)
      : null;
    const validTabs = [
      ...(showOverviewTab ? ["overview"] : []),
      ...(showMembersTab ? ["members"] : []),
      ...(showProjectsTab ? ["projects"] : []),
      ...(showReportsTab ? ["reports"] : []),
      ...pluginTabs.map(t => t.value),
      ...visiblePluginRouteTabs.map((t) => t.value),
    ];
    const configuredDefault = pluginNavigationOverrides.defaultTab;
    const fallbackTab = configuredDefault && validTabs.includes(configuredDefault)
      ? configuredDefault
      : validTabs[0] ?? "overview";
    const nextTab = tab && validTabs.includes(tab) ? tab : fallbackTab;

    setActiveTab((current) => current === nextTab ? current : nextTab);

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
    params.set("tab", resolveOrganizationTabAlias(value, pluginNavigationOverrides.tabAliases));
    return `?${params.toString()}`;
  };

  const renderSectionSwitcherItem = (destination: OrganizationNavigationDestination) => {
    const isActive = destination.value === activeDestination?.value;

    return (
      <DropdownMenuItem
        key={`section-${destination.value}`}
        render={<Link href={destination.href ?? getTabHref(destination.value)} />}
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
  // but better to just use them directly if projects are static
  const upcomingProjects = projects.filter(p => getProjectStatus(p) === "upcoming").length;
  const completedProjects = projects.filter(p => getProjectStatus(p) === "completed").length;
  const cancelledProjects = projects.filter(p => getProjectStatus(p) === "cancelled").length;
  const totalHours = reportSummary?.totalHours ?? 0;

  const quickStats = [
    {
      label: "Members",
      value: members.length.toLocaleString(),
      helper: "Organization members",
      icon: Users,
      iconColor: "var(--info)",
      borderGradient: "180deg, color-mix(in srgb, var(--info) 80%, transparent) 0%, color-mix(in srgb, var(--info) 40%, transparent) 100%",
    },
    {
      label: "Total Hours",
      value: `${totalHours.toFixed(1)}h`,
      helper: "Verified, pending, and certified",
      icon: Clock3,
      iconColor: "var(--chart-8)",
      borderGradient: "180deg, color-mix(in srgb, var(--chart-8) 80%, transparent) 0%, color-mix(in srgb, var(--chart-8) 40%, transparent) 100%",
    },
    {
      label: "Total Projects",
      value: projects.length.toLocaleString(),
      helper: "Last 6 months of activity",
      icon: Folders,
      iconColor: "var(--chart-2)",
      borderGradient: "180deg, color-mix(in srgb, var(--chart-2) 80%, transparent) 0%, color-mix(in srgb, var(--chart-2) 40%, transparent) 100%",
    },
    {
      label: "Upcoming Projects",
      value: upcomingProjects.toLocaleString(),
      helper: "Scheduled next",
      icon: CalendarClock,
      iconColor: "var(--chart-6)",
      borderGradient: "180deg, color-mix(in srgb, var(--chart-6) 80%, transparent) 0%, color-mix(in srgb, var(--chart-6) 40%, transparent) 100%",
    },
    {
      label: "Completed Projects",
      value: completedProjects.toLocaleString(),
      helper: "Finished initiatives",
      icon: CheckCircle2,
      iconColor: "var(--success)",
      borderGradient: "180deg, color-mix(in srgb, var(--success) 80%, transparent) 0%, color-mix(in srgb, var(--success) 40%, transparent) 100%",
    },
    {
      label: "Cancelled Projects",
      value: cancelledProjects.toLocaleString(),
      helper: "Paused or cancelled",
      icon: Frown,
      iconColor: "var(--destructive)",
      borderGradient: "180deg, color-mix(in srgb, var(--destructive) 80%, transparent) 0%, color-mix(in srgb, var(--destructive) 40%, transparent) 100%",
    },
  ] as const;

  return (
    <Tabs
      defaultValue="overview"
      value={activeTab}
      onValueChange={handleTabChange}
      className="w-full"
    >
      <div className={cn("flex min-w-0 items-center gap-2", pluginNavigationOverrides.compactHeader ? "mb-2" : "mb-5")}>
      {usesFullSectionMobileNav && switcherDestinations.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button
              variant="outline"
              size="sm"
              // Disclosure trigger, not a navigation item: Base UI supplies the
              // expanded/controls semantics and aria-current stays on the
              // selected menu item.
              aria-label={`${activeDestinationLabel} — change section`}
              data-testid="organization-section-switcher"
              className="w-full min-w-0 justify-between sm:hidden"
            >
              <span className="flex min-w-0 items-center gap-2">
                {activeDestination?.icon}
                <span className="truncate">{activeDestinationLabel}</span>
              </span>
              <ChevronDown data-icon="inline-end" />
            </Button>
          } />
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{sectionGroupLabel}</DropdownMenuLabel>
              {workspaceDestinations.map(renderSectionSwitcherItem)}
            </DropdownMenuGroup>
            {utilityDestinations.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{utilityGroupLabel}</DropdownMenuLabel>
                  {utilityDestinations.map(renderSectionSwitcherItem)}
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <TabsList className={cn(
        "flex h-auto min-w-0 w-full sm:w-fit max-w-full items-center justify-start overflow-x-auto bg-muted p-1 text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
        usesFullSectionMobileNav && "hidden sm:flex",
      )}>
        {showOverviewTab && (
          <TabsTrigger value="overview" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span className="truncate">{getCoreLabel("overview", "Overview")}</span>
          </TabsTrigger>
        )}
        {showMembersTab && (
          <TabsTrigger value="members" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
            <Users className="h-4 w-4 shrink-0" />
            <span className="truncate">{getCoreLabel("members", pluginNavigationOverrides.membersTabLabel || "Members")}</span>
          </TabsTrigger>
        )}
        {showProjectsTab && (
          <TabsTrigger value="projects" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
            <Folders className="h-4 w-4 shrink-0" />
            <span className="truncate">{getCoreLabel("projects", pluginNavigationOverrides.projectsTabLabel || "Projects")}</span>
          </TabsTrigger>
        )}
        {showReportsTab && (
          <TabsTrigger value="reports" className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
            <BarChart3 className="h-4 w-4 shrink-0" />
            <span className="truncate">{getCoreLabel("reports", "Reports")}</span>
          </TabsTrigger>
        )}
        {primaryPluginTabs.map((pt) => {
          return (
            <TabsTrigger
              key={pt.value}
              value={pt.value}
              aria-current={activePluginParentValue === pt.value ? "page" : undefined}
              className={cn(
                "min-w-max flex-none shrink-0 gap-2 px-3",
                activePluginParentValue === pt.value && "bg-background text-foreground shadow-sm",
              )}
            >
              {pt.icon}
              <span className="truncate">{pt.label}</span>
            </TabsTrigger>
          );
        })}
        {visiblePluginRouteTabs.map((pt) => {
          return (
            <TabsTrigger key={pt.value} value={pt.value} className="flex-1 sm:flex-none min-w-0 gap-2 px-3">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="truncate">{pt.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>

        {morePluginTabs.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button
                variant={activeMoreTab ? "secondary" : "outline"}
                size="sm"
                className={cn("shrink-0", usesFullSectionMobileNav && "hidden sm:flex")}
              >
                <span>{pluginNavigationOverrides.utilityMenuLabel ?? "More"}</span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            } />
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{pluginNavigationOverrides.utilityMenuLabel ?? "More"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {morePluginTabs.map((pt) => {
                  const isActive = isNavigationValueActive(
                    pt.value,
                    activeTab,
                    activePluginParentValue,
                  );

                  return (
                    <DropdownMenuItem
                      key={pt.value}
                      render={<Link href={getTabHref(pt.value)} />}
                      aria-current={isActive ? "page" : undefined}
                      className="justify-between"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {pt.icon}
                        <span className="truncate">{pt.label}</span>
                      </span>
                      {isActive ? <Check aria-hidden="true" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {!pluginNavigationOverrides.hideOverviewTab && !isCoreReplaced("overview") && (
        <TabsContent value="overview" className="space-y-6">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 items-stretch">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-xl! font-bold tracking-tight">About</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="min-w-0">
                <h4 className="text-xs font-medium text-muted-foreground mb-1">Description</h4>
                <div className="relative">
                  <p className="leading-relaxed wrap-break-word">
                    {organization.description || "No description provided."}
                  </p>
                </div>
              </div>
              <div className="space-y-3 mt-3">
                <div className="flex gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-medium">Organization Type</h4>
                    <p className="text-muted-foreground capitalize truncate">
                      {organization.type}
                    </p>
                  </div>
                </div>
                {organization.website && (
                  <div className="flex gap-2 min-w-0">
                    <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-medium">Website</h4>
                      <Link
                        href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate block"
                      >
                        {formatOrganizationWebsiteDisplay(organization.website)}
                      </Link>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 min-w-0">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-medium">Created</h4>
                    <p className="text-muted-foreground truncate">
                      {organizationCreatedLabel}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          {/* Recent Projects Card */}
          {projects.length > 0 ? (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-xl! font-bold tracking-tight">Recent Projects</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="space-y-2">
                  {projects.slice(0, 4).map((project) => (
                    <Link
                      href={`/projects/${project.id}`}
                      key={project.id}
                      className="block p-2.5 rounded-md border hover:bg-muted/70 transition-colors overflow-hidden"
                    >
                      <div className="flex justify-between items-center gap-2 min-w-0">
                        <span className="font-medium truncate flex-1 text-sm">{project.title}</span>
                        <ProjectStatusBadge status={getProjectStatus(project)} className="text-[10px] h-5 shrink-0" />
                      </div>
                      {project.location && (
                        <div className="flex items-center text-xs text-muted-foreground mt-1 min-w-0">
                          <MapPin className="h-3 w-3 mr-1 shrink-0" />
                          <span className="truncate">{project.location}</span>
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="hidden h-full overflow-hidden lg:flex lg:flex-col">
              <CardHeader>
                <CardTitle className="text-xl! font-bold tracking-tight">Recent Projects</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center">
                  <Frown className="h-8 w-8 text-muted-foreground" />
                </div>

                <div className="mt-4 space-y-2">
                  <h3 className="text-lg font-semibold">None yet</h3>
                  <CardDescription className="max-w-xs">
                    No projects have been added to this organization yet.
                  </CardDescription>
                </div>

                {/* <div className="mt-6 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                  <Folders className="h-3.5 w-3.5" />
                  Waiting for the first project
                </div> */}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Quick Stats — full width so all 5 cards have room */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xl! font-bold tracking-tight">Quick Stats</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              {quickStats.map((stat) => (
                <div
                  key={stat.label}
                  className="relative overflow-hidden rounded-lg border bg-muted/20 p-3 transition-colors hover:border-primary/40 hover:bg-muted/40 sm:p-4"
                >
                  <div
                    style={{ background: `linear-gradient(${stat.borderGradient})` }}
                    className="absolute inset-x-0 top-0 h-1"
                  />
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground leading-tight">
                      {stat.label}
                    </p>
                    <stat.icon
                      style={{ color: stat.iconColor }}
                      className="h-4 w-4 shrink-0"
                    />
                  </div>
                  <p className="mt-2 text-2xl sm:text-3xl font-semibold leading-none tracking-tight">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stat.helper}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {pluginOverviewExtensions.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-xl! font-bold tracking-tight">
                Plugin Extensions
              </CardTitle>
              <CardDescription>
                Organization-specific experience modules contributed by installed plugins.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pluginOverviewExtensions.map((surface) => (
                <div key={surface.pluginKey}>{surface.node}</div>
              ))}
            </CardContent>
          </Card>
        )}

        {userRole && (
          <Card className="overflow-hidden w-full max-w-140 sm:max-w-none">
            {userRole === "admin" ? (
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl! font-bold tracking-tight">Admin Tools</CardTitle>
                    <CardDescription className="text-xs">
                      You have admin privileges for this organization.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            ) : userRole === "staff" ? (
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                    <Folders className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl! font-bold tracking-tight">Staff Actions</CardTitle>
                    <CardDescription className="text-xs">
                      You can manage projects for this organization.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            ) : (
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl! font-bold tracking-tight">Member Actions</CardTitle>
                    <CardDescription className="text-xs">
                      Manage your membership in this organization.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            )}
            <CardContent className="text-sm">
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                {userRole === "admin" ? (
                  <>
                    <Link href={`/organization/${organization.username}/settings`}>
                      <Button variant="outline" className="w-full sm:w-auto cursor-pointer hover:bg-muted">
                        Organization Settings
                      </Button>
                    </Link>
                    <Dialog>
                      <DialogTrigger
                        render={
                          <Button
                            variant="outline"
                            className="w-full sm:w-auto cursor-pointer hover:bg-muted"
                          >
                            Apply for Verification
                          </Button>
                        }
                      />
                      <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                          <DialogTitle className="text-2xl font-bold text-center pb-2">
                            Organization Verification
                          </DialogTitle>
                          <DialogDescription className="text-center text-base">
                            Get your organization verified to build trust with volunteers and partners
                          </DialogDescription>
                        </DialogHeader>

                        <div className="mt-4 space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                              <div className="bg-primary/10 p-2 rounded-full">
                                <Globe className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-medium text-sm">Official Email Verification</h3>
                                <p className="text-xs text-muted-foreground">Send email from your domain to <span className="text-primary">support@lets-assist.com</span></p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                              <div className="bg-primary/10 p-2 rounded-full">
                                <Folders className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-medium text-sm">Portfolio Evidence</h3>
                                <p className="text-xs text-muted-foreground">Submit documentation of previous projects</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                              <div className="bg-primary/10 p-2 rounded-full">
                                <Calendar className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-medium text-sm">Activity Records</h3>
                                <p className="text-xs text-muted-foreground">Provide proof of volunteer hours and initiatives</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                              <div className="bg-primary/10 p-2 rounded-full">
                                <ShieldCheck className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-medium text-sm">Legal Documentation</h3>
                                <p className="text-xs text-muted-foreground">Submit registration certificates or credentials</p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-10 flex justify-center">
                            <div className="space-y-6 max-w-sm mt-6">
                              <div className="flex items-center gap-4">
                                <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                                  <span className="text-primary font-semibold">1</span>
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-medium">Send Email</p>
                                  <p className="text-xs text-muted-foreground">Submit verification materials to <Link href="mailto:support@lets-assist.com" className="text-primary hover:underline">support@lets-assist.com</Link></p>
                                </div>
                              </div>

                              <div className="flex items-center gap-4">
                                <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                                  <span className="text-primary font-semibold">2</span>
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-medium">Review Process</p>
                                  <p className="text-xs text-muted-foreground">We&apos;ll contact you shortly</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-4">
                                <div className="bg-primary/10 p-3 rounded-full h-10 w-10 flex items-center justify-center shrink-0">
                                  <span className="text-primary font-semibold">3</span>
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-medium">Get Verified</p>
                                  <p className="text-xs text-muted-foreground">Receive verified badge</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <DialogClose
                          render={<Button className="ml-auto">Close</Button>}
                        />
                      </DialogContent>
	                    </Dialog>
	                    {demoAdminToolsContent}
	                  </>
                ) : userRole === "staff" ? (
                  <>
                    <Link href={`/projects/create?org=${organization.id}`}>
                      <Button variant="outline" className="w-full sm:w-auto cursor-pointer hover:bg-muted">
                        <Folders className="h-4 w-4 mr-2" />
                        Create Project
                      </Button>
                    </Link>
                    <LeaveOrganizationDialog
                      organization={organization}
                      userRole={userRole}
                    />
                  </>
                ) : (
                  <>
                    <LeaveOrganizationDialog
                      organization={organization}
                      userRole={userRole}
                    />
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>
      )}

      {canViewMembers && !pluginNavigationOverrides.hideMembersTab && !isCoreReplaced("members") && (
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

      {!pluginNavigationOverrides.hideProjectsTab && !isCoreReplaced("projects") && (
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
