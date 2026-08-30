"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  BarChart3,
  Check,
  ChevronDown,
  Folders,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  OrganizationNavigationBehavior,
  OrganizationTabBehavior,
} from "@/types";
import {
  isNavigationValueActive,
  type OrganizationNavigationDestination,
} from "./organization-navigation-destinations";

type CoreTab = "overview" | "members" | "projects" | "reports";

type Props = {
  usesFullSectionMobileNav: boolean;
  switcherDestinations: OrganizationNavigationDestination[];
  workspaceDestinations: OrganizationNavigationDestination[];
  utilityDestinations: OrganizationNavigationDestination[];
  activeDestination?: OrganizationNavigationDestination;
  activeDestinationLabel: string;
  sectionGroupLabel: string;
  utilityGroupLabel: string;
  renderSectionSwitcherItem: (
    destination: OrganizationNavigationDestination,
  ) => ReactNode;
  showOverviewTab: boolean;
  showMembersTab: boolean;
  showProjectsTab: boolean;
  showReportsTab: boolean;
  getCoreLabel: (tab: CoreTab, fallback: string) => string;
  pluginNavigationOverrides: OrganizationNavigationBehavior;
  primaryPluginTabs: OrganizationTabBehavior[];
  visiblePluginRouteTabs: Array<{ value: string; label: string }>;
  activePluginParentValue?: string;
  morePluginTabs: OrganizationTabBehavior[];
  hasActiveMoreTab: boolean;
  activeTab: string;
  getTabHref: (value: string) => string;
  fullDocumentTabNavigation: boolean;
};

export function OrganizationTabsNavigation(props: Props) {
  const {
    usesFullSectionMobileNav,
    switcherDestinations,
    workspaceDestinations,
    utilityDestinations,
    activeDestination,
    activeDestinationLabel,
    sectionGroupLabel,
    utilityGroupLabel,
    renderSectionSwitcherItem,
    showOverviewTab,
    showMembersTab,
    showProjectsTab,
    showReportsTab,
    getCoreLabel,
    pluginNavigationOverrides,
    primaryPluginTabs,
    visiblePluginRouteTabs,
    activePluginParentValue,
    morePluginTabs,
    hasActiveMoreTab,
    activeTab,
    getTabHref,
    fullDocumentTabNavigation,
  } = props;

  const activeMoreTab = hasActiveMoreTab;
  const renderNavigationAnchor = (href: string) =>
    fullDocumentTabNavigation ? <a href={href} /> : <Link href={href} />;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        pluginNavigationOverrides.compactHeader ? "mb-2" : "mb-5",
      )}
    >
      {usesFullSectionMobileNav && switcherDestinations.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
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
            }
          />
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
      <TabsList
        className={cn(
          "flex h-auto min-w-0 w-full sm:w-fit max-w-full items-center justify-start overflow-x-auto bg-muted p-1 text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          usesFullSectionMobileNav && "hidden sm:flex",
        )}
      >
        {showOverviewTab && (
          <TabsTrigger
            value="overview"
            className="flex-1 sm:flex-none min-w-0 gap-2 px-3"
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {getCoreLabel("overview", "Overview")}
            </span>
          </TabsTrigger>
        )}
        {showMembersTab && (
          <TabsTrigger
            value="members"
            className="flex-1 sm:flex-none min-w-0 gap-2 px-3"
          >
            <Users className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {getCoreLabel(
                "members",
                pluginNavigationOverrides.membersTabLabel || "Members",
              )}
            </span>
          </TabsTrigger>
        )}
        {showProjectsTab && (
          <TabsTrigger
            value="projects"
            className="flex-1 sm:flex-none min-w-0 gap-2 px-3"
          >
            <Folders className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {getCoreLabel(
                "projects",
                pluginNavigationOverrides.projectsTabLabel || "Projects",
              )}
            </span>
          </TabsTrigger>
        )}
        {showReportsTab && (
          <TabsTrigger
            value="reports"
            className="flex-1 sm:flex-none min-w-0 gap-2 px-3"
          >
            <BarChart3 className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {getCoreLabel("reports", "Reports")}
            </span>
          </TabsTrigger>
        )}
        {primaryPluginTabs.map((pt) => {
          return (
            <TabsTrigger
              key={pt.value}
              value={pt.value}
              aria-current={
                activePluginParentValue === pt.value ? "page" : undefined
              }
              className={cn(
                "min-w-max flex-none shrink-0 gap-2 px-3",
                activePluginParentValue === pt.value &&
                  "bg-background text-foreground shadow-sm",
              )}
            >
              {pt.icon}
              <span className="truncate">{pt.label}</span>
            </TabsTrigger>
          );
        })}
        {visiblePluginRouteTabs.map((pt) => {
          return (
            <TabsTrigger
              key={pt.value}
              value={pt.value}
              className="flex-1 sm:flex-none min-w-0 gap-2 px-3"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="truncate">{pt.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>

      {morePluginTabs.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={activeMoreTab ? "secondary" : "outline"}
                size="sm"
                className={cn(
                  "shrink-0",
                  usesFullSectionMobileNav && "hidden sm:flex",
                )}
              >
                <span>
                  {pluginNavigationOverrides.utilityMenuLabel ?? "More"}
                </span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {pluginNavigationOverrides.utilityMenuLabel ?? "More"}
              </DropdownMenuLabel>
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
                    render={renderNavigationAnchor(getTabHref(pt.value))}
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
  );
}
