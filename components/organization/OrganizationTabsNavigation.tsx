"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";

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
  pluginNavigationOverrides: OrganizationNavigationBehavior;
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
    pluginNavigationOverrides,
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

  // A generic organization gets page-level line tabs straight on the page. A
  // compact plugin workspace keeps its segmented switch on the workspace
  // sheet. The controller derives the flag from `compactHeader`.
  const usesLineTabs = !usesFullSectionMobileNav;

  const tabTriggers = (
    <>
      {/*
        One trigger per destination, from the same deduplicated list that
        feeds the phone switcher, so the two can never disagree.
      */}
      {workspaceDestinations.map((destination) => {
        const ownsActiveChild = activePluginParentValue === destination.value;

        return (
          <TabsTrigger
            key={destination.value}
            value={destination.value}
            aria-current={ownsActiveChild ? "page" : undefined}
            className={cn(
              "flex-none gap-2 px-3",
              // The focus ring is inset because the line strip scrolls
              // sideways and would clip an outer ring.
              usesLineTabs &&
                "h-10 shrink-0 rounded-none focus-visible:ring-inset group-data-[orientation=horizontal]/tabs:after:bottom-0",
              // A child route keeps its parent tab marked the same way the
              // active tab is: underlined on a line strip, raised on a
              // segmented one.
              ownsActiveChild &&
                (usesLineTabs
                  ? "text-foreground dark:text-foreground after:opacity-100"
                  : "bg-background text-foreground dark:border-input dark:bg-input/30 shadow-sm"),
            )}
          >
            {destination.icon ? (
              <span className="hidden sm:contents">{destination.icon}</span>
            ) : null}
            {destination.label}
          </TabsTrigger>
        );
      })}
    </>
  );

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        // The hairline belongs to the row, so the utility menu beside a line
        // strip shares it.
        usesLineTabs && "border-b",
        usesLineTabs ? "mb-6" : "mb-3",
      )}
    >
      {usesFullSectionMobileNav && switcherDestinations.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
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
      {usesLineTabs ? (
        <TabsList
          variant="line"
          className="min-w-0 flex-1 gap-0 p-0 group-data-horizontal/tabs:h-10"
        >
          {tabTriggers}
        </TabsList>
      ) : (
        <TabsList
          className={cn(
            "w-full min-w-0 sm:w-fit",
            usesFullSectionMobileNav && "hidden sm:flex",
          )}
        >
          {tabTriggers}
        </TabsList>
      )}

      {morePluginTabs.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={
                  activeMoreTab
                    ? "secondary"
                    : usesLineTabs
                      ? "ghost"
                      : "outline"
                }
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
